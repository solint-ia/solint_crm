'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, MessageSquare, Search, X } from 'lucide-react';
import type {
  Conversation,
  ConversationStatus,
  InboxScope,
  Priority,
} from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import type { CannedResponse } from '@/core/domain/settings';
import { markConversationNotificationsAsReadAction } from '@/components/layout/notification-actions';
import { useLiveNotifications } from '@/features/realtime/live-notifications';
import { cn } from '@/lib/cn';
import { ChatPanel, type ScheduledResult } from './chat-panel';
import type { InboxCatalog } from './conversation-toolbar';
import { InboxFiltersMenu } from './inbox-filters';
import { InboxSortMenu } from './inbox-sort-menu';
import { ContextPanel } from './context-panel';
import { ConversationListItem } from './conversation-list-item';
import { InboxDisconnectedState } from './inbox-disconnected-state';
import { NotificationVolumeControl } from './notification-volume-control';

import { activeFilterCount, useInbox, type StatusTab } from '../hooks/use-inbox';

interface InboxWorkspaceProps {
  readonly conversations: readonly Conversation[];
  readonly currentUserId: string;
  readonly currentUserName: string;
  /** Nome da conta, para a variável `{{empresa}}` das respostas rápidas. */
  readonly companyName: string;
  readonly sendMessage: (input: {
    conversationId: string;
    text: string;
    isPrivate: boolean;
    replyToId?: string;
  }) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly deleteMessage: (input: {
    conversationId: string;
    messageId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** `emoji` vazio retira a reação de quem está atendendo. */
  readonly reactToMessage: (input: {
    conversationId: string;
    messageId: string;
    emoji: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly scheduleMessage: (input: {
    conversationId: string;
    text: string;
    isPrivate: boolean;
    replyToId?: string;
    scheduledFor: string;
  }) => Promise<ScheduledResult>;
  readonly listScheduledMessages: (input: { conversationId: string }) => Promise<ScheduledResult>;
  readonly cancelScheduledMessage: (input: {
    conversationId: string;
    scheduledMessageId: string;
  }) => Promise<ScheduledResult>;
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
  readonly setAiPause: (input: {
    conversationId: string;
    paused: boolean;
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
  readonly setOperatorTyping?: (input: {
    conversationId: string;
    isTyping: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Caixas que a pessoa alcança.
   *
   * Vem escopada da sessão: são as caixas das equipes dela, não todas as da
   * conta. É o que o menu de mover oferece como destino — oferecer uma caixa
   * fora do alcance seria propor uma ação que o servidor recusaria.
   */
  readonly inboxes: readonly {
    readonly id: string;
    readonly name: string;
    readonly channel: string;
    readonly status: string;
  }[];
  /** Mostra o atalho "Gerenciar canais" na coluna de canais. */
  readonly canManageInboxes: boolean;
  readonly moveInbox: (input: {
    conversationId: string;
    inboxId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly catalog: InboxCatalog;
  readonly cannedResponses: readonly CannedResponse[];
  readonly initialSelectedId?: string;
  readonly initialInboxId?: string;
  readonly initialScope?: InboxScope;
  readonly initialUnread?: boolean;
}

const STATUS_TABS = [
  { id: 'todas', label: 'Todas' },
  { id: 'aberta', label: 'Abertas' },
  { id: 'pendente', label: 'Pendentes' },
  { id: 'espera', label: 'Em espera' },
  { id: 'resolvida', label: 'Resolvidas' },
] as const;

type MobilePane = 'lista' | 'conversa' | 'contexto';

export function InboxWorkspace(props: InboxWorkspaceProps) {
  /**
   * A tela abre com as caixas que existem, conectadas ou não.
   *
   * A conexão é um estado de cada canal: o ponto verde/âmbar no seletor
   * e no dropdown da barra lateral, e o aviso na conversa aberta.
   * A parede só faz sentido quando não há canal nenhum para mostrar.
   */
  const semCanais = props.inboxes.length === 0;
  const [pane, setPane] = useState<MobilePane>(props.initialSelectedId ? 'conversa' : 'lista');
  // Por padrão, a barra de detalhes inicia FECHADA para dar 100% de amplitude ao chat central
  const [isContextOpen, setIsContextOpen] = useState(false);

  const inbox = useInbox({
    initialConversations: props.conversations,
    currentUserId: props.currentUserId,
    currentUserName: props.currentUserName,
    sendMessage: props.sendMessage,
    deleteMessage: props.deleteMessage,
    reactToMessage: props.reactToMessage,
    changeStatus: props.changeStatus,
    markAsRead: props.markAsRead,
    assign: props.assign,
    changePriority: props.changePriority,
    setAiPause: props.setAiPause,
    setLabels: props.setLabels,
    sendTemplate: props.sendTemplate,
    sendMedia: props.sendMedia,
    setContactLabels: props.setContactLabels,
    moveInbox: props.moveInbox,
    initialSelectedId: props.initialSelectedId,
    initialInboxId: props.initialInboxId,
    initialScope: props.initialScope,
    initialUnread: props.initialUnread,
  });

  /**
   * A caixa escolhida, com um padrão que nunca é "todas".
   *
   * A tela sempre fala de uma caixa. Sem esta escolha inicial ela abriria
   * misturando os números da conta. A primeira da lista é um padrão
   * arbitrário, mas estável — e a pessoa troca num clique.
   */
  const caixaAtual = inbox.filters.inboxId ?? inbox.selected?.inboxId ?? props.inboxes[0]?.id;
  const caixaObj = props.inboxes.find((i) => i.id === caixaAtual);

  useEffect(() => {
    if (!inbox.filters.inboxId && caixaAtual) {
      inbox.setFilters((atual) => ({ ...atual, inboxId: caixaAtual }));
    }
  }, [caixaAtual, inbox]);

  /**
   * Abrir a conversa apaga o aviso dela.
   *
   * Vale para os dois caminhos, e é por isso que o efeito mora aqui e não no
   * clique do sininho: quem chega pela lista de conversas viu exatamente o que
   * o aviso anunciava, e um selo que continua contando o que já foi lido deixa
   * de significar "há algo esperando".
   *
   * `setActiveConversation` faz o outro lado do mesmo trabalho: enquanto esta
   * conversa está na tela, mensagem nova dela não vira aviso nenhum.
   */
  const { markConversationRead, setActiveConversation } = useLiveNotifications();
  const conversaAbertaId = inbox.selected?.id;

  useEffect(() => {
    setActiveConversation(conversaAbertaId);

    if (conversaAbertaId) {
      markConversationRead(conversaAbertaId);
      void markConversationNotificationsAsReadAction(conversaAbertaId);
    }

    return () => setActiveConversation(undefined);
  }, [conversaAbertaId, markConversationRead, setActiveConversation]);

  const filterCount = activeFilterCount(inbox.filters);
  const hasNarrowing =
    filterCount > 0 || inbox.search.trim().length > 0 || inbox.statusTab !== 'todas';

  if (semCanais) {
    return <InboxDisconnectedState />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-app text-ink">
      {/* ============================================================ */}
      {/* COLUNA 1: LISTA DE CONVERSAS (320px - 360px)                 */}
      {/* ============================================================ */}
      <section
        className={cn(
          'flex min-w-0 flex-col border-r border-line bg-surface',
          'w-full lg:w-[340px] lg:shrink-0 xl:w-[360px]',
          pane !== 'lista' && 'hidden lg:flex',
        )}
      >
        {/* Cabeçalho da Lista: Canal, Busca e Filtros */}
        <div className="flex flex-col gap-2.5 shrink-0 border-b border-line p-3 bg-surface-2/60">
          {/* Linha 0: Canal Atual & Seletor de Canal */}
          {props.inboxes.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface px-2.5 py-1.5 shadow-2xs">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    caixaObj?.status === 'conectado'
                      ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                      : 'bg-amber-500',
                  )}
                  title={
                    caixaObj?.status === 'conectado' ? 'Canal conectado' : 'Aguardando conexão'
                  }
                />
                <span className="truncate text-xs font-bold text-ink">
                  {caixaObj?.name ?? 'Canal de atendimento'}
                </span>
              </div>

              {props.inboxes.length > 1 && (
                <select
                  value={caixaAtual}
                  onChange={(event) =>
                    inbox.setFilters((atual) => ({ ...atual, inboxId: event.target.value }))
                  }
                  aria-label="Trocar canal"
                  className="cursor-pointer rounded-lg border border-line-soft bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink outline-none transition-colors hover:border-brand/40"
                >
                  {props.inboxes.map((caixa) => (
                    <option key={caixa.id} value={caixa.id}>
                      {caixa.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Linha 1: Campo de Busca + Menu de Filtros + Ordenação */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={inbox.search}
                onChange={(event) => inbox.setSearch(event.target.value)}
                placeholder="Buscar conversas..."
                aria-label="Buscar conversas"
                className="h-9 w-full rounded-xl border border-line bg-surface pr-8 pl-9 text-xs text-ink placeholder:text-muted outline-none transition-all focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              {inbox.search && (
                <button
                  type="button"
                  onClick={() => inbox.setSearch('')}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted hover:text-ink"
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
              <InboxSortMenu sort={inbox.sort} onChange={inbox.setSort} />
              <NotificationVolumeControl />
            </div>
          </div>

          {/* Linha 2: Abas de Escopo: Minhas / Não Atribuídas / Todas */}
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface p-1 border border-line-soft">
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
                      ? 'bg-brand/15 text-brand border border-brand/30 shadow-xs font-semibold'
                      : 'text-muted hover:bg-surface-2 hover:text-ink border border-transparent',
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
          <ul className="flex-1 overflow-y-auto divide-y divide-line-soft">
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
              <div className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted border border-line-soft">
                <MessageSquare className="size-5" />
              </div>
              <h4 className="text-sm font-semibold text-ink">
                {hasNarrowing ? 'Nenhuma conversa neste filtro' : 'Tudo limpo por aqui!'}
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                {hasNarrowing
                  ? 'Ajuste os filtros, a busca ou a aba de status para ver outros atendimentos.'
                  : 'Toda conversa nova fica visível para a equipe da caixa. Quem responder primeiro assume o atendimento.'}
              </p>
              {hasNarrowing && (
                <button
                  type="button"
                  onClick={() => {
                    inbox.setFilters({});
                    inbox.setSearch('');
                    inbox.setStatusTab('todas');
                  }}
                  className="mt-2 text-xs font-semibold text-brand hover:underline"
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
              <p
                role="alert"
                className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs text-red-600 dark:text-red-300"
              >
                {inbox.error}
              </p>
            )}

            <ChatPanel
              conversation={inbox.selected}
              pending={inbox.pending}
              currentUserId={props.currentUserId}
              catalog={props.catalog}
              inboxes={props.inboxes}
              onMoveInbox={inbox.moveInbox}
              cannedResponses={props.cannedResponses}
              companyName={props.companyName}
              currentUserName={props.currentUserName}
              onSend={inbox.send}
              onDeleteMessage={inbox.deleteMessage}
              onReactToMessage={inbox.reactToMessage}
              scheduleMessage={props.scheduleMessage}
              listScheduledMessages={props.listScheduledMessages}
              cancelScheduledMessage={props.cancelScheduledMessage}
              onSendMedia={inbox.sendMedia}
              onTyping={(conversationId, isTyping) =>
                props.setOperatorTyping?.({ conversationId, isTyping })
              }
              onSendTemplate={inbox.sendTemplate}
              onChangeStatus={inbox.changeStatus}
              onAssign={inbox.assign}
              onChangePriority={inbox.changePriority}
              onToggleAiPause={inbox.toggleAiPause}
              aiPausePending={inbox.aiPausePending}
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
              <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
                <button
                  type="button"
                  onClick={() => setPane('conversa')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
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
        <div className="hidden flex-1 items-center justify-center bg-chat p-8 lg:flex">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-line bg-surface text-muted shadow-xs">
              <MessageSquare className="size-7 text-brand" />
            </div>
            <h3 className="text-base font-bold text-ink font-display">
              Selecione uma conversa ao lado
            </h3>
            <p className="text-xs text-muted leading-relaxed">
              Escolha um atendimento na lista à esquerda para visualizar o histórico de mensagens e
              começar a responder.
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
          ? 'bg-brand text-white shadow-xs shadow-brand/30 font-semibold'
          : 'text-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-bold',
          active ? 'bg-white/25 text-white' : 'bg-surface-2 text-muted border border-line-soft',
        )}
      >
        {count}
      </span>
    </button>
  );
}
