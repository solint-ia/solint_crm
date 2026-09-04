'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  Inbox,
  MoreVertical,
  PanelRight,
  PanelRightClose,
  PauseCircle,
  PlugZap,
  RotateCcw,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { Conversation, ConversationStatus, Priority } from '@/core/domain/conversation';
import { currentProtocol, isHsmWindowOpen } from '@/core/domain/conversation';
import type { VariableContext } from '@/core/domain/message-variables';
import { previewOfMessage, type Message } from '@/core/domain/message';
import type { ScheduledMessage } from '@/core/domain/scheduled-message';
import { isGroupContact, PhoneNumber } from '@/core/domain/contact';
import type { Label } from '@/core/domain/label';
import type { CannedResponse } from '@/core/domain/settings';
import { Avatar } from '@/components/ui/avatar';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { Menu, MenuHeader, MenuItem } from '@/components/ui/menu';
import { Modal } from '@/components/ui/modal';
import { Composer, type ComposerMode, type MediaResult } from './composer';
import {
  AiPauseButton,
  AssigneeButton,
  InboxMenu,
  LabelMenu,
  PriorityMenu,
  StatusMenu,
  type InboxCatalog,
} from './conversation-toolbar';
import { MessageBubble } from './message-bubble';
import { TemplatePicker } from './template-picker';
import { TransferModal } from './transfer-modal';
import { cn } from '@/lib/cn';
import { useDatasDaConta } from '@/components/layout/regional-provider';
import { useConversationEvents } from '@/features/realtime/conversation-events';

/** O que as ações de agendamento devolvem: a lista já no estado novo. */
export interface ScheduledResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly items?: readonly ScheduledMessage[];
}

/**
 * Folga depois da hora marcada antes de conferir se o agendamento saiu.
 *
 * Quem dispara é o varredor do worker, que acorda a cada 20 segundos
 * (`POLL_MS` em `scheduled-runner.ts`). Perguntar exatamente na hora marcada
 * quase sempre pegaria a linha ainda pendente, porque o varredor ainda não
 * passou por ela.
 */
const GRACA_DO_VARREDOR_MS = 22_000;

/**
 * Duas listas de agendamento com o mesmo conteúdo.
 *
 * Existe para preservar a identidade do array quando nada mudou. O efeito que
 * arma o relógio depende de `agendadas`; se cada recarga devolvesse um array
 * novo, ele rearmaria sozinho a cada 22 segundos para sempre — um laço que
 * ninguém pediu, girando enquanto a conversa estivesse aberta.
 */
const mesmaFila = (a: readonly ScheduledMessage[], b: readonly ScheduledMessage[]): boolean =>
  a.length === b.length &&
  a.every((item, i) => item.id === b[i]?.id && item.status === b[i]?.status);

interface ChatPanelProps {
  readonly conversation: Conversation;
  readonly pending: boolean;
  readonly currentUserId: string;
  readonly catalog: InboxCatalog;
  readonly cannedResponses: readonly CannedResponse[];
  /** Nome da empresa, para `{{empresa}}`. */
  readonly companyName: string;
  /** Nome de quem atende, para `{{agente.nome}}`. */
  readonly currentUserName: string;
  readonly onSend: (text: string, mode: ComposerMode, replyToId?: string) => void;
  readonly onDeleteMessage?: (messageId: string) => void;
  /** `emoji` vazio retira a reação de quem está atendendo. */
  readonly onReactToMessage?: (messageId: string, emoji: string) => void;
  readonly scheduleMessage?: (input: {
    conversationId: string;
    text: string;
    isPrivate: boolean;
    replyToId?: string;
    scheduledFor: string;
  }) => Promise<ScheduledResult>;
  readonly listScheduledMessages?: (input: { conversationId: string }) => Promise<ScheduledResult>;
  readonly cancelScheduledMessage?: (input: {
    conversationId: string;
    scheduledMessageId: string;
  }) => Promise<ScheduledResult>;
  readonly onSendMedia: (form: FormData) => Promise<MediaResult>;
  readonly onTyping?: (conversationId: string, isTyping: boolean) => void;
  readonly onSendTemplate: (templateId: string, values: readonly string[]) => void;
  readonly onChangeStatus: (status: ConversationStatus) => void;
  readonly onAssign: (assignee: { id: string; name: string } | null) => void;
  readonly onChangePriority: (priority: Priority) => void;
  readonly onToggleAiPause: (paused: boolean) => void;
  readonly aiPausePending: boolean;
  readonly onSetLabels: (labels: readonly Label[]) => void;
  readonly inboxes: readonly { readonly id: string; readonly name: string }[];
  readonly onMoveInbox: (inboxId: string) => void;
  readonly onBack?: () => void;
  readonly isContextOpen?: boolean;
  readonly onToggleContext?: () => void;
}

export function ChatPanel({
  conversation,
  pending,
  currentUserId,
  catalog,
  cannedResponses,
  companyName,
  currentUserName,
  onSend,
  onDeleteMessage,
  onReactToMessage,
  scheduleMessage,
  listScheduledMessages,
  cancelScheduledMessage,
  onSendMedia,
  onTyping,
  onSendTemplate,
  onChangeStatus,
  onAssign,
  onChangePriority,
  onToggleAiPause,
  aiPausePending,
  onSetLabels,
  inboxes,
  onMoveInbox,
  onBack,
  isContextOpen = false,
  onToggleContext,
}: ChatPanelProps) {
  const { agendamento, hora } = useDatasDaConta();
  const [transferOpen, setTransferOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | undefined>();
  const [pendingDelete, setPendingDelete] = useState<Message | undefined>();
  const [agendadas, setAgendadas] = useState<readonly ScheduledMessage[]>([]);
  const [agendaErro, setAgendaErro] = useState<string | undefined>();
  const [fotoAberta, setFotoAberta] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevConversationIdRef = useRef<string | null>(null);

  /**
   * Qual conversa está aberta *agora*, legível de dentro de uma promessa que
   * começou antes da troca. Escrito no render de propósito: quem lê é sempre
   * código assíncrono, que roda depois: nunca observa um valor pela metade.
   */
  const conversaAtualRef = useRef(conversation.id);
  conversaAtualRef.current = conversation.id;

  const hsmOpen = isHsmWindowOpen(conversation);
  const isGroup = isGroupContact(conversation.contact);
  const temFoto = Boolean(conversation.contact.avatarUrl);

  // Trocar de conversa fecha a foto: a que estava ampliada era do contato
  // anterior, e mantê-la aberta mostraria o rosto errado sobre a conversa nova.
  useEffect(() => {
    setFotoAberta(false);
  }, [conversation.id]);

  /**
   * Os botões de status agora ligam e desligam.
   *
   * Antes cada um só empurrava a conversa para o seu estado e ficava
   * desabilitado depois — não havia como desfazer "em espera" ou reabrir um
   * atendimento que se finalizou por engano sem passar pelo menu de status. O
   * clique repetido volta para `aberta`, que é o estado neutro de um
   * atendimento em curso.
   */
  const toggleStatus = (alvo: ConversationStatus) =>
    onChangeStatus(conversation.status === alvo ? 'aberta' : alvo);

  /**
   * O que preenche as variáveis das respostas rápidas nesta conversa.
   *
   * Montado aqui porque é o único lugar que tem as quatro peças ao mesmo
   * tempo: o contato vem da conversa, o agente e a empresa vêm da sessão, e o
   * protocolo é o atendimento em aberto — o mesmo que o painel de contexto
   * mostra ao lado.
   */
  const variableContext = useMemo<VariableContext>(
    () => ({
      clienteNome: conversation.contact.name,
      agenteNome: currentUserName,
      empresa: companyName,
      protocolo: currentProtocol(conversation.protocols)?.code ?? '',
    }),
    [conversation.contact.name, conversation.protocols, currentUserName, companyName],
  );

  /**
   * As mensagens por id, para resolver a citação sem varrer a timeline por
   * bolha. Numa conversa longa, procurar a citada dentro de cada balão seria
   * quadrático — e a timeline chega a centenas de itens.
   */
  const byId = useMemo(() => {
    const mapa = new Map<string, Message>();
    for (const item of conversation.timeline) {
      if (item.kind === 'message') mapa.set(item.message.id, item.message);
    }
    return mapa;
  }, [conversation.timeline]);

  // Trocar de conversa descarta a resposta em curso: ela era daquele
  // atendimento, e uma citação apontando para a timeline anterior não faz
  // sentido nenhum aqui.
  useEffect(() => {
    setReplyTo(undefined);
    setPendingDelete(undefined);
  }, [conversation.id]);

  /**
   * Os agendamentos desta conversa.
   *
   * Buscados à parte da conversa, e não junto com ela, porque não são parte
   * dela: não estão na timeline, não contam como atividade e mudam por conta
   * própria (o varredor dispara e a linha some daqui). Carregá-los com a
   * conversa obrigaria a recarregar a conversa inteira para atualizar uma
   * lista de duas linhas.
   *
   * A comparação com `conversaAtualRef` protege da troca rápida de conversa:
   * sem ela, a resposta da conversa anterior podia chegar depois e pintar os
   * agendamentos dela na conversa que já está aberta.
   */
  const recarregarAgendadas = useCallback(
    async (conversationId: string) => {
      if (!listScheduledMessages) return;
      const resultado = await listScheduledMessages({ conversationId });
      if (conversaAtualRef.current !== conversationId) return;
      if (!resultado.ok || !resultado.items) return;
      const chegou = resultado.items;
      setAgendadas((atual) => (mesmaFila(atual, chegou) ? atual : chegou));
    },
    [listScheduledMessages],
  );

  useEffect(() => {
    setAgendadas([]);
    setAgendaErro(undefined);
    void recarregarAgendadas(conversation.id);
  }, [conversation.id, recarregarAgendadas]);

  /**
   * O agendamento que já saiu precisa sumir daqui sozinho.
   *
   * A lista era buscada uma vez só, na troca de conversa. Quando o varredor
   * disparava, a mensagem aparecia na timeline — mas a linha continuava no
   * topo do compositor anunciando um envio futuro que já era passado, e só
   * sumia ao recarregar a página.
   *
   * São dois gatilhos porque nenhum dos dois basta sozinho. O relógio abaixo
   * sabe *quando* olhar, mas não sabe se o varredor já passou; o evento sabe
   * que passou, mas só chega se a conversa aberta for a mesma. Juntos cobrem
   * o caso normal (o evento limpa na hora) e o caso em que o envio acontece
   * com a aba em outra conversa (o relógio confere ao voltar).
   */
  useConversationEvents((payload) => {
    if (payload.type !== 'new_message') return;
    if (payload.conversationId !== conversation.id) return;
    // Sem nada pendente não há o que conferir, e toda mensagem recebida
    // dispararia uma consulta à toa.
    if (agendadas.length === 0) return;
    void recarregarAgendadas(conversation.id);
  });

  useEffect(() => {
    let proxima: number | undefined;
    for (const item of agendadas) {
      const instante = new Date(item.scheduledFor).getTime();
      if (Number.isNaN(instante)) continue;
      if (proxima === undefined || instante < proxima) proxima = instante;
    }
    if (proxima === undefined) return;

    const espera = Math.max(0, proxima - Date.now()) + GRACA_DO_VARREDOR_MS;
    const relogio = setTimeout(() => void recarregarAgendadas(conversation.id), espera);
    return () => clearTimeout(relogio);
  }, [agendadas, conversation.id, recarregarAgendadas]);

  const identity = isGroup
    ? `${conversation.contact.participantCount ?? 0} participantes`
    : PhoneNumber.format(conversation.contact.phone) || 'Sem telefone';

  // Rola para a mensagem mais recente (final da conversa) por padrão
  useEffect(() => {
    const isDifferentConversation = prevConversationIdRef.current !== conversation.id;
    prevConversationIdRef.current = conversation.id;

    const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
      messagesEndRef.current?.scrollIntoView({ behavior });
    };

    if (isDifferentConversation) {
      // Ao abrir / trocar de conversa: rolagem imediata para as mensagens mais recentes
      scrollToBottom('auto');
      const timer = setTimeout(() => scrollToBottom('auto'), 50);
      return () => clearTimeout(timer);
    } else {
      // Nova mensagem na conversa atual: rolagem suave
      scrollToBottom('smooth');
    }
  }, [conversation.id, conversation.timeline.length]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-chat h-full overflow-hidden">
      {/* ---------- Cabeçalho Fixo da Conversa ---------- */}
      <header className="@container flex h-16 shrink-0 items-center justify-between gap-2.5 sm:gap-4 border-b border-line bg-surface px-3 sm:px-4 py-2 z-10 shadow-xs">
        {/* Lado Esquerdo: Identificação do Contato e Grupo (com espaço garantido e nunca sobreposto) */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar para a lista de conversas"
              className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}

          {temFoto ? (
            <button
              type="button"
              onClick={() => setFotoAberta(true)}
              title="Ampliar foto"
              aria-label={`Ampliar foto de ${conversation.contact.name}`}
              className="shrink-0 rounded-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <Avatar
                name={conversation.contact.name}
                tone={conversation.contact.avatarTone}
                src={conversation.contact.avatarUrl}
                size="md"
              />
            </button>
          ) : (
            <div className="shrink-0">
              <Avatar
                name={conversation.contact.name}
                tone={conversation.contact.avatarTone}
                size="md"
              />
            </div>
          )}

          <button
            type="button"
            onClick={onToggleContext}
            title={isContextOpen ? 'Recolher detalhes do contato' : 'Ver detalhes do contato'}
            className="group flex items-center gap-2 text-left min-w-0 rounded-lg p-1 -m-1 transition-colors hover:bg-surface-2 overflow-hidden"
          >
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2 min-w-0">
                <h2
                  className="truncate font-display text-xs sm:text-sm font-semibold text-ink group-hover:text-brand transition-colors"
                  title={conversation.contact.name}
                >
                  {conversation.contact.name}
                </h2>
                {isGroup && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25 px-2 py-0.5 text-[10px] font-semibold">
                    <Users className="size-3 shrink-0" />
                    Grupo
                  </span>
                )}
              </div>
              <p className="truncate font-mono text-[11px] text-muted leading-tight mt-0.5">
                {identity} · {conversation.queue}
              </p>
            </div>
          </button>
        </div>

        {/* Lado Direito: Ações e Seletores com Agrupamento Inteligente */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Seletor Rápido de Status (Interativo e Compacto) */}
          <StatusMenu conversation={conversation} onChange={onChangeStatus} />

          <AiPauseButton
            conversation={conversation}
            onToggle={onToggleAiPause}
            pending={aiPausePending}
            formatHour={(iso) => hora(new Date(iso))}
          />

          {/* Grupo de Metadados Expandido em Telas Muito Largas (Container @6xl+) */}
          {!isContextOpen && (
            <div className="hidden @6xl:flex items-center gap-1 rounded-xl border border-line bg-surface-2/70 p-1 shadow-2xs">
              <PriorityMenu conversation={conversation} onChange={onChangePriority} />
              <LabelMenu
                conversation={conversation}
                labels={catalog.labels}
                onChange={onSetLabels}
              />
              {inboxes.length > 1 && (
                <InboxMenu conversation={conversation} inboxes={inboxes} onMove={onMoveInbox} />
              )}
              <span className="h-3.5 w-px bg-line/80 mx-0.5" />
              <AssigneeButton conversation={conversation} onOpen={() => setTransferOpen(true)} />
            </div>
          )}

          {/* Grupo de Metadados Compacto (Prioridade + Etiquetas) em Telas Médias-Largura (@4xl a @6xl) */}
          {!isContextOpen && (
            <div className="hidden @4xl:flex @6xl:hidden items-center gap-1 rounded-xl border border-line bg-surface-2/70 p-1 shadow-2xs">
              <PriorityMenu conversation={conversation} onChange={onChangePriority} />
              <LabelMenu
                conversation={conversation}
                labels={catalog.labels}
                onChange={onSetLabels}
              />
            </div>
          )}

          {/* Ação Principal: Finalizar / Reabrir Atendimento */}
          {conversation.status === 'resolvida' ? (
            <button
              type="button"
              onClick={() => onChangeStatus('aberta')}
              title="Reabrir este atendimento"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-600/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-300 transition-all hover:bg-emerald-500/20 active:scale-[0.98] shadow-2xs"
            >
              <RotateCcw className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">Reabrir atendimento</span>
              <span className="sm:hidden">Reabrir</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChangeStatus('resolvida')}
              title="Finalizar e resolver atendimento"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs shadow-emerald-600/25 transition-all hover:bg-emerald-500 active:scale-[0.98]"
            >
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span className="hidden sm:inline">Finalizar atendimento</span>
              <span className="sm:hidden">Finalizar</span>
            </button>
          )}

          {/* Utilitários, Menu Unificado de Ações e Painel Lateral */}
          <div className="flex items-center gap-1.5 pl-1 sm:pl-1.5 border-l border-line/60">
            {/* Menu Dropdown de Mais Ações e Opções da Conversa */}
            <Menu
              label="Mais opções da conversa"
              panelClassName="w-64"
              trigger={
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-xl border transition-colors shadow-2xs cursor-pointer',
                    'border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <MoreVertical className="size-4" />
                </span>
              }
            >
              {(close) => (
                <>
                  <MenuHeader>Atribuição & Destino</MenuHeader>
                  <MenuItem
                    onClick={() => {
                      setTransferOpen(true);
                      close();
                    }}
                  >
                    <UserCheck className="size-3.5 text-brand shrink-0" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-semibold text-xs leading-none">
                        Transferir responsável
                      </span>
                      <span className="text-[10px] text-muted leading-tight mt-0.5 truncate">
                        {conversation.assigneeName ?? 'Sem responsável'}
                      </span>
                    </div>
                  </MenuItem>

                  {inboxes.length > 1 && (
                    <div className="border-t border-line-soft">
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase text-dim tracking-wider">
                        Caixa de Entrada
                      </p>
                      {inboxes.map((inbox) => (
                        <MenuItem
                          key={inbox.id}
                          selected={inbox.id === conversation.inboxId}
                          onClick={() => {
                            if (inbox.id !== conversation.inboxId) onMoveInbox(inbox.id);
                            close();
                          }}
                        >
                          <Inbox className="size-3.5 text-dim shrink-0" />
                          <span className="truncate flex-1 text-xs">{inbox.name}</span>
                          {inbox.id === conversation.inboxId && (
                            <Check className="size-3.5 text-brand shrink-0" />
                          )}
                        </MenuItem>
                      ))}
                    </div>
                  )}

                  <MenuHeader>Status Rápido</MenuHeader>
                  <MenuItem
                    selected={conversation.status === 'espera'}
                    onClick={() => {
                      toggleStatus('espera');
                      close();
                    }}
                  >
                    <PauseCircle className="size-3.5 text-amber-500 shrink-0" />
                    <span className="text-xs">
                      {conversation.status === 'espera' ? 'Tirar da espera' : 'Colocar em espera'}
                    </span>
                  </MenuItem>

                  <MenuItem
                    selected={conversation.status === 'pendente'}
                    onClick={() => {
                      toggleStatus('pendente');
                      close();
                    }}
                  >
                    <Clock className="size-3.5 text-sky-500 shrink-0" />
                    <span className="text-xs">
                      {conversation.status === 'pendente'
                        ? 'Tirar de pendente'
                        : 'Marcar como pendente'}
                    </span>
                  </MenuItem>
                </>
              )}
            </Menu>

            {/* Botão de Alternar Barra Lateral de Detalhes */}
            {onToggleContext && (
              <button
                type="button"
                onClick={onToggleContext}
                aria-label={
                  isContextOpen ? 'Recolher detalhes do contato' : 'Abrir detalhes do contato'
                }
                title={
                  isContextOpen
                    ? 'Recolher detalhes (painel lateral)'
                    : 'Abrir detalhes (painel lateral)'
                }
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-xl border transition-all',
                  isContextOpen
                    ? 'border-brand/40 bg-brand/12 text-brand shadow-xs'
                    : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink shadow-2xs',
                )}
              >
                {isContextOpen ? (
                  <PanelRightClose className="size-4" />
                ) : (
                  <PanelRight className="size-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Alertas contextuais */}
      {conversation.channelOffline && (
        <div className="flex items-center gap-2 bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs text-red-600 dark:text-red-300">
          <PlugZap className="size-3.5 shrink-0 text-red-500" />
          <span>Canal desconectado: as mensagens não serão entregues até a reconexão.</span>
          <Link
            href="/configuracoes?secao=integracoes"
            className="ml-auto font-semibold text-red-600 dark:text-red-200 underline hover:no-underline"
          >
            Reconectar
          </Link>
        </div>
      )}

      {conversation.collisionAgent && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Eye className="size-3.5 shrink-0 text-amber-500" />
          <span>{conversation.collisionAgent} também está visualizando esta conversa.</span>
        </div>
      )}

      {/* ---------- Stream de Mensagens ---------- */}
      <div
        ref={messagesContainerRef}
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6"
      >
        {conversation.timeline.map((item) =>
          item.kind === 'divider' ? (
            <div key={`divider-${item.label}`} className="my-3 flex items-center justify-center">
              <span className="rounded-full border border-line bg-surface/80 px-3 py-0.5 text-[11px] font-medium text-muted backdrop-blur-xs">
                {item.label}
              </span>
            </div>
          ) : (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              showAuthorName={isGroup}
              mentionCandidates={catalog.members}
              currentUserId={currentUserId}
              {...(item.message.replyToId && byId.has(item.message.replyToId)
                ? { quoted: byId.get(item.message.replyToId) }
                : {})}
              onReply={setReplyTo}
              {...(onDeleteMessage ? { onDelete: setPendingDelete } : {})}
              {...(onReactToMessage
                ? { onReact: (alvo: Message, emoji: string) => onReactToMessage(alvo.id, emoji) }
                : {})}
            />
          ),
        )}

        {conversation.isTyping && <TypingBubble name={conversation.contact.name} />}

        <div ref={messagesEndRef} className="h-px shrink-0" aria-hidden="true" />
      </div>

      {/* Aviso de Janela de 24h Meta/HSM */}
      {!hsmOpen && conversation.channel === 'whatsapp' && (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
          <span>Janela de 24h do WhatsApp encerrada. Use um template aprovado para reabrir.</span>
          <button
            type="button"
            onClick={() => setTemplateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-500 transition-colors"
          >
            <FileCheck2 className="size-3.5" />
            <span>Enviar template</span>
          </button>
        </div>
      )}

      {/* ---------- Compositor de Mensagens Fixo na Base ---------- */}
      <div className="shrink-0 border-t border-line bg-surface p-3 md:p-4">
        {/* A fila de agendamentos vive **acima** do compositor, não na
            timeline: ela descreve o que ainda não aconteceu, e misturá-la às
            mensagens faria a conversa mostrar como dito algo que o cliente
            ainda não recebeu. */}
        {agendadas.length > 0 ? (
          <ul className="mb-2 flex flex-col gap-1.5">
            {agendadas.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-2 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-2"
              >
                <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-ink">
                    {item.isPrivate ? 'Nota interna agendada' : 'Envio agendado'} ·{' '}
                    <span className="font-normal text-muted">
                      {agendamento(new Date(item.scheduledFor))}
                    </span>
                  </p>
                  <p className="line-clamp-2 text-xs text-muted">{item.text}</p>
                </div>
                {cancelScheduledMessage && item.status === 'pending' ? (
                  <button
                    type="button"
                    aria-label="Cancelar agendamento"
                    title="Cancelar agendamento"
                    onClick={() => {
                      setAgendaErro(undefined);
                      void cancelScheduledMessage({
                        conversationId: conversation.id,
                        scheduledMessageId: item.id,
                      }).then((resultado) => {
                        if (resultado.items) setAgendadas(resultado.items);
                        if (!resultado.ok) setAgendaErro(resultado.error);
                      });
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/15 hover:text-red-500"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {agendaErro ? (
          <p role="alert" className="mb-2 text-xs font-medium text-red-500">
            {agendaErro}
          </p>
        ) : null}

        <Composer
          // O compositor guarda rascunho e anexo: sem saber de qual conversa
          // são, ele os levava para a próxima que fosse aberta.
          conversationId={conversation.id}
          disabledReason={
            !hsmOpen && conversation.channel === 'whatsapp'
              ? 'Janela de 24h encerrada. Envie um template para falar com o contato.'
              : undefined
          }
          {...(replyTo
            ? {
                replyTo: {
                  id: replyTo.id,
                  author:
                    replyTo.author === 'contact'
                      ? (replyTo.authorName ?? conversation.contact.name)
                      : 'você mesmo',
                  preview: previewOfMessage(replyTo),
                },
              }
            : {})}
          onCancelReply={() => setReplyTo(undefined)}
          onSend={onSend}
          onSendMedia={onSendMedia}
          onTyping={(isTyping) => onTyping?.(conversation.id, isTyping)}
          cannedResponses={cannedResponses}
          variableContext={variableContext}
          mentionCandidates={catalog.members}
          pending={pending}
          {...(scheduleMessage
            ? {
                onSchedule: async (entrada: {
                  text: string;
                  mode: ComposerMode;
                  scheduledFor: string;
                  replyToId?: string;
                }) => {
                  const resultado = await scheduleMessage({
                    conversationId: conversation.id,
                    text: entrada.text,
                    isPrivate: entrada.mode === 'nota',
                    scheduledFor: entrada.scheduledFor,
                    ...(entrada.replyToId ? { replyToId: entrada.replyToId } : {}),
                  });
                  if (resultado.items) setAgendadas(resultado.items);
                  if (resultado.ok) setReplyTo(undefined);
                  return {
                    ok: resultado.ok,
                    ...(resultado.error ? { error: resultado.error } : {}),
                  };
                },
              }
            : {})}
        />
      </div>

      {/* Modais auxiliares */}
      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        conversation={conversation}
        members={catalog.members}
        currentUserId={currentUserId}
        onAssign={onAssign}
      />

      {/* Apagar pede confirmação porque não tem volta: o texto sai daqui e sai
          do aparelho do contato, e não há lixeira nem desfazer. O balão é
          mostrado dentro do aviso para que a confirmação seja sobre *aquela*
          mensagem, não sobre uma pergunta abstrata. */}
      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(undefined)}
        title="Apagar mensagem"
        description="A mensagem some desta conversa e também do aparelho do contato. Não é possível desfazer."
        className="max-w-md"
      >
        {pendingDelete ? (
          <div className="flex flex-col gap-4 pt-1">
            <p className="line-clamp-4 rounded-xl border-l-2 border-l-line bg-surface-2 px-3 py-2 text-xs text-muted">
              {previewOfMessage(pendingDelete)}
            </p>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setPendingDelete(undefined)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteMessage?.(pendingDelete.id);
                  setPendingDelete(undefined);
                  if (replyTo?.id === pendingDelete.id) setReplyTo(undefined);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
              >
                <Trash2 className="size-3.5" />
                Apagar para todos
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <TemplatePicker
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        contactName={conversation.contact.name}
        templates={catalog.templates}
        onSend={(templateId, values) => {
          onSendTemplate(templateId, values);
          setTemplateOpen(false);
        }}
      />

      {fotoAberta && conversation.contact.avatarUrl ? (
        <ImageLightbox
          src={conversation.contact.avatarUrl}
          alt={`Foto de ${conversation.contact.name}`}
          onClose={() => setFotoAberta(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * "Digitando" como bolha, não como aviso.
 *
 * Fica alinhada à esquerda e com a mesma moldura das mensagens de quem escreve
 * porque é isso que ela é: o lugar reservado da mensagem que está sendo
 * escrita. Uma linha de texto solta acima do compositor dizia a mesma coisa e
 * lia como notificação do sistema.
 *
 * O nome vai no rótulo acessível, não no desenho — em conversa de duas pessoas
 * a posição da bolha já diz de quem é.
 */
function TypingBubble({ name }: { readonly name: string }) {
  return (
    <div className="flex w-full justify-start" aria-live="polite">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-xs border border-line bg-surface px-4 py-3 shadow-xs">
        <span className="sr-only">{name} está digitando</span>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="typing-dot size-1.5 rounded-full bg-muted"
            style={{ animationDelay: `${index * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
