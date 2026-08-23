'use client';

import { useState } from 'react';
import { ArrowLeft, Search, SlidersHorizontal } from 'lucide-react';
import type { Conversation, ConversationStatus, Priority } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import type { CannedResponse } from '@/core/domain/settings';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/cn';
import { ChatPanel } from './chat-panel';
import type { InboxCatalog } from './conversation-toolbar';
import { InboxFiltersMenu } from './inbox-filters';
import { ContextPanel } from './context-panel';
import { ConversationListItem } from './conversation-list-item';
import {
  activeFilterCount,
  useInbox,
  type SortKey,
  type StatusTab,
} from '../hooks/use-inbox';

interface InboxWorkspaceProps {
  readonly conversations: readonly Conversation[];
  readonly currentUserId: string;
  readonly currentUserName: string;
  readonly sendMessage: (input: {
    conversationId: string;
    text: string;
    isPrivate: boolean;
  }) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly changeStatus: (input: {
    conversationId: string;
    status: ConversationStatus;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly markAsRead: (input: { conversationId: string }) => Promise<{ ok: boolean }>;
  readonly assign: (input: {
    conversationId: string;
    assigneeId: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly changePriority: (input: {
    conversationId: string;
    priority: Priority;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly setLabels: (input: {
    conversationId: string;
    labelIds: readonly string[];
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly sendTemplate: (input: {
    conversationId: string;
    templateId: string;
    values: readonly string[];
  }) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly sendMedia: (
    form: FormData,
  ) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly setContactLabels: (input: {
    conversationId: string;
    contactId: string;
    labelIds: readonly string[];
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly catalog: InboxCatalog;
  readonly cannedResponses: readonly CannedResponse[];
  readonly initialSelectedId?: string;
}

/**
 * `espera` existia no dominio desde o comeco e nao tinha aba: conversas nesse
 * estado sumiam de todas as abas de status, porque nenhuma as aceitava.
 */
const STATUS_TABS = [
  { id: 'todas', label: 'Todas' },
  { id: 'aberta', label: 'Abertas' },
  { id: 'pendente', label: 'Pendentes' },
  { id: 'espera', label: 'Em espera' },
  { id: 'resolvida', label: 'Resolvidas' },
] as const;

const SORT_OPTIONS = [
  { id: 'recentes', label: 'Recentes' },
  { id: 'antigas', label: 'Antigas' },
  { id: 'prioridade', label: 'Prioridade' },
] as const;

/** Qual das três colunas ocupa a tela no celular. */
type MobilePane = 'lista' | 'conversa' | 'contexto';

/**
 * Orquestrador das 3 colunas de /conversas (a rail vem do layout).
 *
 * A partir de `lg` as três aparecem juntas. Abaixo disso viram uma pilha
 * navegável — lista → conversa → detalhes — porque três painéis de 340px não
 * cabem em 390px de largura, e encolher todos deixaria os três ilegíveis.
 * A troca é só de visibilidade: o estado da caixa continua o mesmo, então
 * voltar não recarrega nem perde posição.
 */
export function InboxWorkspace(props: InboxWorkspaceProps) {
  const [pane, setPane] = useState<MobilePane>(props.initialSelectedId ? 'conversa' : 'lista');

  const inbox = useInbox({
    initialConversations: props.conversations,
    currentUserId: props.currentUserId,
    currentUserName: props.currentUserName,
    sendMessage: props.sendMessage,
    changeStatus: props.changeStatus,
    markAsRead: props.markAsRead,
    assign: props.assign,
    changePriority: props.changePriority,
    setLabels: props.setLabels,
    sendTemplate: props.sendTemplate,
    sendMedia: props.sendMedia,
    setContactLabels: props.setContactLabels,
    initialSelectedId: props.initialSelectedId,
  });

  const hasNarrowing =
    activeFilterCount(inbox.filters) > 0 ||
    inbox.search.trim().length > 0 ||
    inbox.statusTab !== 'todas';

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* ---------- Lista ---------- */}
      <section
        className={cn(
          'flex min-w-0 flex-col border-r border-line bg-surface',
          'w-full lg:w-[340px] lg:shrink-0',
          pane !== 'lista' && 'hidden lg:flex',
        )}
      >
        <div className="shrink-0 border-b border-line px-3 py-3">
          <div className="relative mb-2.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim" />
            <input
              type="search"
              value={inbox.search}
              onChange={(event) => inbox.setSearch(event.target.value)}
              placeholder="Buscar conversas"
              aria-label="Buscar conversas"
              className="h-9 w-full rounded-control border border-line bg-surface-2 pr-3 pl-8 text-body text-ink outline-none placeholder:text-dim focus:border-brand"
            />
          </div>

          <SegmentedControl
            ariaLabel="Filtro de atribuição"
            size="sm"
            className="w-full"
            value={inbox.scope}
            onChange={inbox.setScope}
            options={[
              { id: 'minhas', label: 'Minhas', count: inbox.counts.minhas },
              { id: 'nao_atribuidas', label: 'Não atrib.', count: inbox.counts.nao_atribuidas },
              { id: 'todas', label: 'Todas', count: inbox.counts.todas },
            ]}
          />

          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
            <SegmentedControl
              ariaLabel="Filtro de status"
              size="sm"
              value={inbox.statusTab}
              onChange={(value) => inbox.setStatusTab(value as StatusTab)}
              options={STATUS_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
            />
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <InboxFiltersMenu
              filters={inbox.filters}
              labels={props.catalog.labels}
              onChange={inbox.setFilters}
            />
            <label className="flex items-center gap-1 text-meta text-dim">
              <SlidersHorizontal className="size-3" />
              <span className="sr-only">Ordenar por</span>
              <select
                value={inbox.sort}
                onChange={(event) => inbox.setSort(event.target.value as SortKey)}
                className="rounded-control border border-line bg-surface px-1.5 py-1 text-meta text-ink outline-none focus:border-brand"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            </span>
          </div>
        </div>

        {inbox.conversations.length > 0 ? (
          <ul className="flex-1 overflow-y-auto">
            {inbox.conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                selected={inbox.selected?.id === conversation.id}
                onSelect={(id) => {
                  inbox.select(id);
                  setPane('conversa');
                }}
              />
            ))}
          </ul>
        ) : (
          <div className="flex-1 p-4">
            {/* Distinguir vazio de escondido-pelo-filtro evita o susto de achar
                que a fila zerou quando ha um recorte ativo. */}
            <EmptyState
              title={hasNarrowing ? 'Nenhuma conversa neste recorte' : 'Tudo limpo por aqui!'}
              description={
                hasNarrowing
                  ? 'Ajuste os filtros, a busca ou a aba de status para ver outras conversas.'
                  : 'Nenhuma mensagem aguardando atendimento na sua fila.'
              }
              action={
                hasNarrowing ? (
                  <button
                    type="button"
                    onClick={() => {
                      inbox.setFilters({});
                      inbox.setSearch('');
                      inbox.setStatusTab('todas');
                    }}
                    className="text-meta font-semibold text-brand hover:underline"
                  >
                    Limpar filtros
                  </button>
                ) : null
              }
            />
          </div>
        )}
      </section>

      {inbox.selected ? (
        <>
          {/* ---------- Conversa ---------- */}
          <div
            className={cn(
              'min-w-0 flex-1 flex-col',
              pane === 'conversa' ? 'flex' : 'hidden lg:flex',
            )}
          >
            {inbox.error ? (
              <p role="alert" className="bg-red-soft px-4 py-2 text-meta text-red-text">
                {inbox.error}
              </p>
            ) : null}
            <ChatPanel
              conversation={inbox.selected}
              pending={inbox.pending}
              currentUserId={props.currentUserId}
              catalog={props.catalog}
              cannedResponses={props.cannedResponses}
              onSend={inbox.send}
              onSendMedia={inbox.sendMedia}
              onSendTemplate={inbox.sendTemplate}
              onChangeStatus={inbox.changeStatus}
              onAssign={inbox.assign}
              onChangePriority={inbox.changePriority}
              onSetLabels={inbox.setLabels}
              onBack={() => setPane('lista')}
              onOpenContext={() => setPane('contexto')}
            />
          </div>

          {/* ---------- Contexto ---------- */}
          <div
            className={cn(
              'min-w-0 flex-col',
              pane === 'contexto' ? 'flex flex-1' : 'hidden xl:flex',
            )}
          >
            <button
              type="button"
              onClick={() => setPane('conversa')}
              className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2.5 text-body font-semibold text-muted transition-colors hover:text-ink xl:hidden"
            >
              <ArrowLeft className="size-4" />
              Voltar para a conversa
            </button>
            <ContextPanel
              conversation={inbox.selected}
              labels={props.catalog.labels}
              onSetConversationLabels={inbox.setLabels}
              onSetContactLabels={inbox.setContactLabels}
            />
          </div>
        </>
      ) : (
        <div className="hidden flex-1 items-center justify-center bg-chat p-8 lg:flex">
          <EmptyState
            title="Selecione uma conversa ao lado"
            description="Escolha um atendimento na lista para começar a responder."
          />
        </div>
      )}
    </div>
  );
}
