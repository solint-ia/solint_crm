'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  MessageSquare,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { Conversation, ConversationStatus, Priority } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import type { CannedResponse } from '@/core/domain/settings';
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

type MobilePane = 'lista' | 'conversa' | 'contexto';

export function InboxWorkspace(props: InboxWorkspaceProps) {
  const [pane, setPane] = useState<MobilePane>(props.initialSelectedId ? 'conversa' : 'lista');
  // Por padrão, a barra de detalhes inicia FECHADA para dar 100% de amplitude ao chat central
  const [isContextOpen, setIsContextOpen] = useState(false);

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

  const filterCount = activeFilterCount(inbox.filters);
  const hasNarrowing =
    filterCount > 0 ||
    inbox.search.trim().length > 0 ||
    inbox.statusTab !== 'todas';

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-[#080d19] text-slate-100">
      {/* ============================================================ */}
      {/* COLUNA 1: LISTA DE CONVERSAS (320px - 360px)                 */}
      {/* ============================================================ */}
      <section
        className={cn(
          'flex min-w-0 flex-col border-r border-white/[0.06] bg-[#0c1322]',
          'w-full lg:w-[340px] lg:shrink-0 xl:w-[360px]',
          pane !== 'lista' && 'hidden lg:flex',
        )}
      >
        {/* Cabeçalho da Lista: Busca e Filtros */}
        <div className="flex flex-col gap-2.5 shrink-0 border-b border-white/[0.06] p-3 bg-[#0e1626]">
          {/* Linha 1: Campo de Busca + Menu de Filtros + Ordenação */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={inbox.search}
                onChange={(event) => inbox.setSearch(event.target.value)}
                placeholder="Buscar conversas..."
                aria-label="Buscar conversas"
                className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pr-8 pl-9 text-xs text-slate-100 placeholder:text-slate-500 outline-none transition-all focus:border-blue-500/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-blue-500/15"
              />
              {inbox.search && (
                <button
                  type="button"
                  onClick={() => inbox.setSearch('')}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <InboxFiltersMenu
                filters={inbox.filters}
                labels={props.catalog.labels}
                onChange={inbox.setFilters}
              />

              <label className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.06] cursor-pointer transition-colors" title="Ordenar lista">
                <SlidersHorizontal className="size-3 text-slate-400" />
                <span className="sr-only">Ordenar</span>
                <select
                  value={inbox.sort}
                  onChange={(event) => inbox.setSort(event.target.value as SortKey)}
                  className="bg-transparent text-[11px] text-slate-300 outline-none cursor-pointer"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id} className="bg-[#0e1626] text-slate-200">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Linha 2: Abas de Escopo: Minhas / Não Atribuídas / Todas */}
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.04] p-1 border border-white/[0.04]">
            <ScopeTabButton
              label="Minhas"
              count={inbox.counts.minhas}
              active={inbox.scope === 'minhas'}
              onClick={() => inbox.setScope('minhas')}
            />
            <ScopeTabButton
              label="Não atrib."
              count={inbox.counts.nao_atribuidas}
              active={inbox.scope === 'nao_atribuidas'}
              onClick={() => inbox.setScope('nao_atribuidas')}
            />
            <ScopeTabButton
              label="Todas"
              count={inbox.counts.todas}
              active={inbox.scope === 'todas'}
              onClick={() => inbox.setScope('todas')}
            />
          </div>

          {/* Linha 3: Filtros de Status (Pílulas com 100% de largura e sem sobreposição) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-0.5 pb-0.5">
            {STATUS_TABS.map((tab) => {
              const active = inbox.statusTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => inbox.setStatusTab(tab.id as StatusTab)}
                  className={cn(
                    'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
                    active
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-xs'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 border border-transparent',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista Rolável de Conversas */}
        {inbox.conversations.length > 0 ? (
          <ul className="flex-1 overflow-y-auto divide-y divide-white/[0.02]">
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
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="flex flex-col items-center gap-2 max-w-xs">
              <div className="flex size-10 items-center justify-center rounded-xl bg-white/[0.04] text-slate-400 border border-white/[0.06]">
                <MessageSquare className="size-5" />
              </div>
              <h4 className="text-sm font-semibold text-slate-200">
                {hasNarrowing ? 'Nenhuma conversa neste filtro' : 'Tudo limpo por aqui!'}
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                {hasNarrowing
                  ? 'Ajuste os filtros, a busca ou a aba de status para ver outros atendimentos.'
                  : 'Nenhuma mensagem aguardando atendimento na sua fila neste momento.'}
              </p>
              {hasNarrowing && (
                <button
                  type="button"
                  onClick={() => {
                    inbox.setFilters({});
                    inbox.setSearch('');
                    inbox.setStatusTab('todas');
                  }}
                  className="mt-2 text-xs font-semibold text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Limpar todos os filtros
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* COLUNA 2: ÁREA PRINCIPAL DA CONVERSA                         */}
      {/* ============================================================ */}
      {inbox.selected ? (
        <>
          <div
            className={cn(
              'min-w-0 flex-1 flex-col h-full overflow-hidden transition-all duration-200',
              pane === 'conversa' ? 'flex' : 'hidden lg:flex',
            )}
          >
            {inbox.error && (
              <p role="alert" className="bg-red-950/70 border-b border-red-800/40 px-4 py-2 text-xs text-red-300">
                {inbox.error}
              </p>
            )}

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
              isContextOpen={isContextOpen}
              onToggleContext={() => {
                setIsContextOpen((prev) => !prev);
                if (pane === 'conversa' && window.innerWidth < 1024) {
                  setPane('contexto');
                }
              }}
            />
          </div>

          {/* ============================================================ */}
          {/* COLUNA 3: DETALHES DO CONTATO (RETRÁTIL / DRAWER)            */}
          {/* ============================================================ */}
          {/* Desktop & Notebook: Painel Retrátil deslizante */}
          {isContextOpen && (
            <div className="hidden lg:flex shrink-0 animate-in slide-in-from-right duration-200">
              <ContextPanel
                conversation={inbox.selected}
                labels={props.catalog.labels}
                onSetConversationLabels={inbox.setLabels}
                onSetContactLabels={inbox.setContactLabels}
                onClose={() => setIsContextOpen(false)}
              />
            </div>
          )}

          {/* Mobile: Painel de Contexto em tela inteira / Drawer */}
          {pane === 'contexto' && (
            <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden lg:hidden">
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d1424] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setPane('conversa')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  <ArrowLeft className="size-4" />
                  <span>Voltar para a conversa</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <ContextPanel
                  conversation={inbox.selected}
                  labels={props.catalog.labels}
                  onSetConversationLabels={inbox.setLabels}
                  onSetContactLabels={inbox.setContactLabels}
                  onClose={() => setPane('conversa')}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        /* Estado Vazio: Nenhuma Conversa Selecionada */
        <div className="hidden flex-1 items-center justify-center bg-[#090e1a] p-8 lg:flex">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-slate-400 shadow-sm">
              <MessageSquare className="size-7 text-blue-400/80" />
            </div>
            <h3 className="text-base font-bold text-slate-100 font-display">
              Selecione uma conversa ao lado
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Escolha um atendimento na lista à esquerda para visualizar o histórico de mensagens e começar a responder.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeTabButton({
  label,
  count,
  active,
  onClick,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
        active
          ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-bold',
          active ? 'bg-white/20 text-white' : 'bg-white/[0.08] text-slate-300',
        )}
      >
        {count}
      </span>
    </button>
  );
}
