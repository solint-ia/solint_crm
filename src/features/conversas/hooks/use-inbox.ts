'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type {
  Conversation,
  ConversationStatus,
  InboxScope,
  Priority,
} from '@/core/domain/conversation';
import type { Channel } from '@/core/domain/channel';
import { activityTimeOf, matchesScope, PRIORITY_WEIGHT } from '@/core/domain/conversation';
import type { Label } from '@/core/domain/label';
import type { Message, MessageReaction } from '@/core/domain/message';
import { previewOfMessage } from '@/core/domain/message';
import { horaLabel } from '@/lib/datetime';
import type { ComposerMode } from '../components/composer';
import { useConversationEvents } from '@/features/realtime/conversation-events';

export type StatusTab = ConversationStatus | 'todas';
export type SortKey = 'recentes' | 'antigas' | 'prioridade';

interface UseInboxParams {
  readonly initialConversations: readonly Conversation[];
  readonly currentUserId: string;
  readonly currentUserName: string;
  readonly sendMessage: (input: {
    conversationId: string;
    text: string;
    isPrivate: boolean;
    replyToId?: string;
  }) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly deleteMessage?: (input: {
    conversationId: string;
    messageId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** `emoji` vazio retira a reação — é a mesma chamada, como no WhatsApp. */
  readonly reactToMessage?: (input: {
    conversationId: string;
    messageId: string;
    emoji: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly changeStatus: (input: {
    conversationId: string;
    status: ConversationStatus;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly markAsRead?: (input: { conversationId: string }) => Promise<{ ok: boolean }>;
  readonly assign?: (input: {
    conversationId: string;
    assigneeId: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly changePriority?: (input: {
    conversationId: string;
    priority: Priority;
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly setLabels?: (input: {
    conversationId: string;
    labelIds: readonly string[];
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly sendTemplate?: (input: {
    conversationId: string;
    templateId: string;
    values: readonly string[];
  }) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly sendMedia?: (
    form: FormData,
  ) => Promise<{ ok: boolean; error?: string; message?: Message }>;
  readonly setContactLabels?: (input: {
    conversationId: string;
    contactId: string;
    labelIds: readonly string[];
  }) => Promise<{ ok: boolean; error?: string }>;
  readonly moveInbox?: (input: {
    conversationId: string;
    inboxId: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Conversa aberta ao carregar — vem da URL em /conversas/[id]. */
  readonly initialSelectedId?: string;
  readonly initialInboxId?: string;
  readonly initialScope?: InboxScope;
  readonly initialUnread?: boolean;
}

/** Recortes combináveis da lista. `undefined` significa "não filtrar por isto". */
export interface InboxFilters {
  readonly channel?: Channel;
  readonly priority?: Priority;
  readonly labelId?: string;
  readonly unreadOnly?: boolean;
  readonly slaBreached?: boolean;
  readonly inboxId?: string;
}

export const activeFilterCount = (filters: InboxFilters): number =>
  Object.entries(filters).filter(
    ([key, value]) => key !== 'inboxId' && value !== undefined && value !== false,
  ).length;

/** Substitui a conversa e a recoloca no topo — atividade nova vem primeiro. */
const upsertConversation = (
  current: readonly Conversation[],
  conversation: Conversation,
): readonly Conversation[] => [conversation, ...current.filter((c) => c.id !== conversation.id)];

/**
 * Validade de um "digitando" sem confirmação.
 *
 * O WhatsApp avisa quando o contato para de escrever, mas esse aviso é a parte
 * que se perde: o app fechado no meio da frase, a conexão que cai, o evento que
 * não atravessa. Sem prazo, os três pontinhos ficariam pulsando para sempre
 * anunciando uma resposta que ninguém está escrevendo — e o indicador que
 * mente é pior que o indicador que não existe.
 *
 * Dez segundos é a ordem de grandeza que o próprio WhatsApp usa: quem continua
 * digitando gera um aviso novo bem antes disso, e a marca se renova sozinha.
 */
const TYPING_TTL_MS = 10_000;

/**
 * Estado da caixa de entrada.
 * A filtragem reutiliza as regras do dominio, sem duplicar logica na UI.
 */
export function useInbox({
  initialConversations,
  currentUserId,
  currentUserName,
  sendMessage,
  deleteMessage,
  reactToMessage,
  changeStatus,
  markAsRead,
  assign,
  changePriority,
  setLabels,
  sendTemplate,
  sendMedia,
  setContactLabels,
  moveInbox,
  initialSelectedId,
  initialInboxId,
  initialScope,
  initialUnread,
}: UseInboxParams) {
  const [conversations, setConversations] = useState<readonly Conversation[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedId ?? initialConversations[0]?.id,
  );
  const [scope, setScope] = useState<InboxScope>(initialScope ?? 'todas');
  const [statusTab, setStatusTab] = useState<StatusTab>('todas');
  const [sort, setSort] = useState<SortKey>('recentes');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<InboxFilters>(() => ({
    ...(initialInboxId ? { inboxId: initialInboxId } : {}),
    ...(initialUnread ? { unreadOnly: true } : {}),
  }));
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  /**
   * A conversa pedida pela URL passa a valer também depois da montagem.
   *
   * `useState` lê o valor inicial uma vez e nunca mais. Enquanto a caixa de
   * entrada continua montada — e ela continua, porque a navegação entre
   * `/conversas/a` e `/conversas/b` não troca o segmento de rota — clicar numa
   * notificação trocava a URL e não trocava nada na tela: `selectedId` ficava
   * preso na conversa em que a página abriu.
   */
  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);

  useEffect(() => {
    if (initialInboxId !== undefined) {
      setFilters((prev) => ({ ...prev, inboxId: initialInboxId || undefined }));
    }
  }, [initialInboxId]);

  /**
   * Abrir uma conversa de outra caixa desfaz o filtro de caixa.
   *
   * Com duas caixas conectadas e o filtro em "Caixa 2", uma conversa da
   * principal simplesmente não estava na lista — e o `selected` caía na
   * primeira visível, que era da Caixa 2. A notificação levava a uma conversa
   * qualquer, de outro número, sem nenhum aviso de que o destino tinha sido
   * trocado.
   *
   * Quem clicou numa notificação escolheu aquela conversa; o filtro é uma
   * preferência de navegação, e entre os dois quem cede é o filtro. Só dispara
   * quando a conversa selecionada muda, para não desfazer um filtro que a
   * pessoa acabou de aplicar à mão.
   */
  useEffect(() => {
    if (!selectedId) return;
    const alvo = conversations.find((conversation) => conversation.id === selectedId);
    if (!alvo) return;
    setFilters((prev) =>
      prev.inboxId && prev.inboxId !== alvo.inboxId ? { ...prev, inboxId: undefined } : prev,
    );
    // `conversations` de fora das dependências de propósito: o alvo só precisa
    // ser reavaliado quando a escolha muda, não a cada mensagem que chega e
    // reescreve a lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (initialScope !== undefined) {
      setScope(initialScope);
    }
  }, [initialScope]);

  useEffect(() => {
    if (initialUnread !== undefined) {
      setFilters((prev) => ({ ...prev, unreadOnly: initialUnread || undefined }));
    }
  }, [initialUnread]);

  /**
   * "Digitando" vive só na tela, com prazo de validade.
   *
   * Não vem do banco e não vai para ele: é um estado de segundos. O relógio por
   * conversa é o que garante que ele suma sozinho quando o aviso de parada não
   * chega — ver `TYPING_TTL_MS`.
   */
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const markTyping = useCallback((conversationId: string, isTyping: boolean) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, isTyping } : conversation,
      ),
    );

    const timers = typingTimers.current;
    const running = timers.get(conversationId);
    if (running) clearTimeout(running);
    timers.delete(conversationId);
    if (!isTyping) return;

    timers.set(
      conversationId,
      setTimeout(() => {
        timers.delete(conversationId);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, isTyping: false }
              : conversation,
          ),
        );
      }, TYPING_TTL_MS),
    );
  }, []);

  useEffect(() => {
    const timers = typingTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Tempo real vem do barramento compartilhado do workspace (uma unica conexao SSE).
  useConversationEvents((payload) => {
    // Presença não mexe na timeline nem na ordem da lista: é um estado à parte,
    // com relógio próprio, e tratá-lo como os demais eventos faria cada tecla
    // do contato reordenar a caixa de entrada.
    if (payload.type === 'typing') {
      markTyping(payload.conversationId, payload.isTyping === true);
      return;
    }

    // O servidor envia a conversa completa: substituir e sempre mais seguro
    // que remendar a timeline no cliente — preservando mensagens otimistas em voo.
    const incoming = payload.conversation as Conversation | undefined;
    if (incoming) {
      setConversations((current) => {
        const existing = current.find((c) => c.id === incoming.id);
        if (!existing) {
          return upsertConversation(current, incoming);
        }
        const incomingMsgIds = new Set(
          incoming.timeline
            .filter((item) => item.kind === 'message')
            .map((item) => (item.kind === 'message' ? item.message.id : '')),
        );
        const localOptimistic = existing.timeline.filter(
          (item) =>
            item.kind === 'message' &&
            item.message.id.startsWith('local-') &&
            !incomingMsgIds.has(item.message.id),
        );
        return upsertConversation(current, {
          ...incoming,
          timeline: [...incoming.timeline, ...localOptimistic],
        });
      });
      return;
    }

    const message = payload.message as Message | undefined;
    if (!message) return;

    setConversations((current) => {
      const existing = current.find((c) => c.id === payload.conversationId);
      if (!existing) return current;

      const known = existing.timeline.some(
        (item) => item.kind === 'message' && item.message.id === message.id,
      );

      if (payload.type === 'message_updated' || known) {
        return current.map((conversation) =>
          conversation.id === payload.conversationId
            ? {
                ...conversation,
                timeline: conversation.timeline.map((item) =>
                  item.kind === 'message' && item.message.id === message.id
                    ? { kind: 'message' as const, message }
                    : item,
                ),
              }
            : conversation,
        );
      }

      // Se houver mensagem local otimista com mesmo conteúdo, substitui ela (evita bolha duplicada)
      const timelineWithoutLocal =
        message.author === 'agent'
          ? existing.timeline.filter(
              (item) =>
                !(
                  item.kind === 'message' &&
                  item.message.id.startsWith('local-') &&
                  JSON.stringify(item.message.content) === JSON.stringify(message.content)
                ),
            )
          : existing.timeline;

      return upsertConversation(current, {
        ...existing,
        timeline: [...timelineWithoutLocal, { kind: 'message', message }],
        lastMessagePreview: previewOfMessage(message),
        lastMessageAt: message.time,
        lastActivityAt: new Date().toISOString(),
        isTyping: false,
        unreadCount: message.author === 'contact' ? existing.unreadCount + 1 : existing.unreadCount,
      });
    });
  });


  /**
   * As conversas da caixa selecionada — o universo de tudo nesta tela.
   *
   * A caixa deixou de ser mais um filtro entre outros e virou o recorte de
   * onde a pessoa está. "Todas" passou a significar "todas **desta** caixa", e
   * é daqui que as contagens das abas saem: antes elas somavam a conta inteira,
   * então a aba dizia "Todas (174)" e a lista mostrava três — os outros 171
   * eram de outras caixas, e nada na tela explicava a diferença.
   *
   * Sem caixa escolhida (conta com uma só, ou enquanto a primeira não foi
   * selecionada) o universo é tudo o que a pessoa alcança, como sempre foi.
   */
  const naCaixa = useMemo(
    () =>
      filters.inboxId
        ? conversations.filter((conversation) => conversation.inboxId === filters.inboxId)
        : conversations,
    [conversations, filters.inboxId],
  );

  const visibleConversations = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = naCaixa.filter((conversation) => {
      if (!matchesScope(conversation, scope, currentUserId)) return false;
      if (statusTab !== 'todas' && conversation.status !== statusTab) return false;

      // Filtros combinam por E: cada um estreita o que o anterior deixou passar.
      if (filters.channel && conversation.channel !== filters.channel) return false;
      if (filters.priority && conversation.priority !== filters.priority) return false;
      if (filters.labelId && !conversation.labels.some((l) => l.id === filters.labelId)) {
        return false;
      }
      if (filters.unreadOnly && conversation.unreadCount === 0) return false;
      if (filters.slaBreached && !conversation.slaBreached) return false;

      if (!term) return true;
      return (
        conversation.contact.name.toLowerCase().includes(term) ||
        conversation.lastMessagePreview.toLowerCase().includes(term) ||
        conversation.contact.phone.includes(term)
      );
    });

    if (sort === 'prioridade') {
      return [...filtered].sort(
        (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority],
      );
    }
    // `lastMessageAt` e apenas um rotulo ("14:32"): ordenar por ele misturaria dias.
    if (sort === 'antigas') {
      return [...filtered].sort((a, b) => activityTimeOf(a) - activityTimeOf(b));
    }
    return [...filtered].sort((a, b) => activityTimeOf(b) - activityTimeOf(a));
  }, [naCaixa, scope, statusTab, search, sort, filters, currentUserId]);

  /**
   * A conversa aberta.
   *
   * A queda para `visibleConversations[0]` existe para o caso legítimo de não
   * haver escolha nenhuma — primeira carga, ou a conversa selecionada tendo
   * sido fechada e sumido da aba. Mas ela era aplicada **também** quando havia
   * escolha e ela apenas não passava pelo filtro, e aí trocava a conversa
   * pedida por outra, de outro contato e outra caixa, sem dizer nada.
   *
   * A busca em `conversations` cobre a janela entre a troca de `selectedId` e o
   * efeito acima soltar o filtro: por um render a conversa certa ainda não está
   * na lista visível, e é justamente nesse render que a substituição acontecia.
   */
  const selected = useMemo(() => {
    if (selectedId) {
      const naLista = visibleConversations.find((conversation) => conversation.id === selectedId);
      if (naLista) return naLista;

      const foraDoFiltro = conversations.find((conversation) => conversation.id === selectedId);
      if (foraDoFiltro) return foraDoFiltro;
    }
    return visibleConversations[0];
  }, [visibleConversations, conversations, selectedId]);

  const counts = useMemo(
    () => ({
      minhas: naCaixa.filter((c) => matchesScope(c, 'minhas', currentUserId)).length,
      nao_atribuidas: naCaixa.filter((c) => matchesScope(c, 'nao_atribuidas', currentUserId)).length,
      todas: naCaixa.length,
      naoLidas: naCaixa.filter((c) => c.unreadCount > 0).length,
    }),
    [naCaixa, currentUserId],
  );

  /**
   * Não lidas por caixa, para os selos da lista de canais.
   *
   * Sai de `conversations` e não de `naCaixa` de propósito: o selo de uma caixa
   * precisa continuar visível enquanto a pessoa está noutra — é justamente o
   * aviso de que há algo esperando do outro lado.
   */
  const unreadByInbox = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const conversation of conversations) {
      if (conversation.unreadCount === 0) continue;
      mapa.set(conversation.inboxId, (mapa.get(conversation.inboxId) ?? 0) + 1);
    }
    return mapa;
  }, [conversations]);

  // Abrir a conversa confirma a leitura e subscreve a presença no WhatsApp
  const readSignalled = useRef(new Set<string>());
  const subscribedConversations = useRef(new Set<string>());
  useEffect(() => {
    if (!selected || !markAsRead) return;
    const id = selected.id;

    if (selected.unreadCount > 0 && !readSignalled.current.has(id)) {
      readSignalled.current.add(id);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? { ...conversation, unreadCount: 0 } : conversation,
        ),
      );
      void markAsRead({ conversationId: id }).finally(() => {
        readSignalled.current.delete(id);
      });
    } else if (!subscribedConversations.current.has(id)) {
      subscribedConversations.current.add(id);
      void markAsRead({ conversationId: id });
    }
  }, [selected, markAsRead]);

  const appendLocalMessage = useCallback(
    (conversationId: string, text: string, mode: ComposerMode, replyToId?: string) => {
      const isPrivate = mode === 'nota';
      const message: Message = {
        id: `local-${Date.now()}`,
        conversationId,
        author: 'agent',
        authorName: currentUserName,
        origin: 'crm',
        ...(replyToId ? { replyToId } : {}),
        content: { type: 'text', text },
        time: horaLabel(new Date()),
        // A mensagem otimista já nasce com o instante real: assim a hora na tela
        // não muda quando a versão do servidor chegar e substituí-la.
        createdAt: new Date().toISOString(),
        isPrivate,
        deliveryStatus: isPrivate ? undefined : 'enviando',
      };

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                timeline: [...conversation.timeline, { kind: 'message', message }],
                lastMessagePreview: isPrivate ? conversation.lastMessagePreview : text,
                lastMessageAt: message.time,
                isTyping: false,
              }
            : conversation,
        ),
      );

      return message.id;
    },
    [currentUserName],
  );

  /** Remove a bolha otimista quando o envio falha antes de virar mensagem real. */
  const dropLocalMessage = useCallback((conversationId: string, localId: string) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              timeline: conversation.timeline.filter(
                (item) => item.kind !== 'message' || item.message.id !== localId,
              ),
            }
          : conversation,
      ),
    );
  }, []);

  /**
   * Troca a bolha otimista pela mensagem que o servidor gravou.
   *
   * A troca é por **id**, no lugar em que a bolha já está. A alternativa que
   * existia — deixar a bolha e esperar o evento de tempo real removê-la
   * comparando o conteúdo — quebrava assim que o servidor mudasse o texto, e
   * ele passou a mudar: a assinatura entra na gravação, então o conteúdo
   * devolvido não é mais igual ao que foi digitado, e a comparação deixava as
   * duas bolhas na tela.
   */
  const commitLocalMessage = useCallback(
    (conversationId: string, localId: string, saved: Message) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                timeline: conversation.timeline.map((item) =>
                  item.kind === 'message' && item.message.id === localId
                    ? { kind: 'message' as const, message: saved }
                    : item,
                ),
                lastMessagePreview: saved.isPrivate
                  ? conversation.lastMessagePreview
                  : previewOfMessage(saved),
              }
            : conversation,
        ),
      );
    },
    [],
  );

  const handleSend = useCallback(
    (text: string, mode: ComposerMode, replyToId?: string) => {
      if (!selected) return;
      setError(undefined);
      const conversationId = selected.id;
      const localId = appendLocalMessage(conversationId, text, mode, replyToId);

      startTransition(async () => {
        const result = await sendMessage({
          conversationId,
          text,
          isPrivate: mode === 'nota',
          ...(replyToId ? { replyToId } : {}),
        });
        if (!result.ok) setError(result.error);
        // Sem mensagem persistida o envio não chegou ao dominio: não deixe uma
        // bolha fantasma sugerindo que a mensagem existe.
        if (result.message) commitLocalMessage(conversationId, localId, result.message);
        else dropLocalMessage(conversationId, localId);
      });
    },
    [selected, appendLocalMessage, commitLocalMessage, dropLocalMessage, sendMessage],
  );

  /**
   * Apaga a mensagem — sem atualização otimista, de propósito.
   *
   * Apagar depende do WhatsApp aceitar, e ele pode recusar (número fora do ar,
   * mensagem antiga demais). Riscar a bolha antes da confirmação mostraria como
   * removido algo que continua no aparelho do contato — que é exatamente o erro
   * que esta função existe para não cometer. A confirmação chega pelo evento de
   * tempo real, com a conversa já no estado novo.
   */
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!selected || !deleteMessage) return;
      setError(undefined);
      const conversationId = selected.id;
      startTransition(async () => {
        const result = await deleteMessage({ conversationId, messageId });
        if (!result.ok) setError(result.error);
      });
    },
    [selected, deleteMessage],
  );

  /**
   * Reagir, com a reação já na tela.
   *
   * Ao contrário de apagar — que espera o WhatsApp confirmar, porque mostrar
   * como removido algo que continua no aparelho do contato seria mentir —,
   * reagir pode ser otimista: o pior caso é um emoji que aparece e some, e a
   * espera de um ida-e-volta até o servidor do WhatsApp num gesto que se faz
   * em sequência (o operador reage a três mensagens seguidas) é o que faria a
   * função parecer quebrada.
   *
   * O evento de tempo real chega em seguida com o estado gravado e substitui
   * este palpite — inclusive quando ele estava errado.
   */
  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      if (!selected || !reactToMessage) return;
      setError(undefined);
      const conversationId = selected.id;

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                timeline: conversation.timeline.map((item) => {
                  if (item.kind !== 'message' || item.message.id !== messageId) return item;
                  const outros = (item.message.reactions ?? []).filter(
                    (reaction) => reaction.by !== 'agent',
                  );
                  const minha: MessageReaction[] = emoji
                    ? [
                        {
                          emoji,
                          by: 'agent',
                          actorId: 'me',
                          at: new Date().toISOString(),
                          authorName: currentUserName,
                        },
                      ]
                    : [];
                  return {
                    kind: 'message' as const,
                    message: { ...item.message, reactions: [...outros, ...minha] },
                  };
                }),
              }
            : conversation,
        ),
      );

      startTransition(async () => {
        const result = await reactToMessage({ conversationId, messageId, emoji });
        if (!result.ok) setError(result.error);
      });
    },
    [selected, reactToMessage, currentUserName],
  );

  const handleChangeStatus = useCallback(
    (status: ConversationStatus) => {
      if (!selected) return;
      setError(undefined);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selected.id ? { ...conversation, status } : conversation,
        ),
      );

      startTransition(async () => {
        const result = await changeStatus({ conversationId: selected.id, status });
        if (!result.ok) setError(result.error);
      });
    },
    [selected, changeStatus],
  );

  /**
   * Atualização otimista com reversão.
   *
   * O servidor devolve a conversa inteira pelo barramento SSE, então o estado
   * local aqui é só a ponte até o evento chegar. Se a ação falha, o instantâneo
   * anterior volta — deixar a tela mostrando uma transferência que não
   * aconteceu é pior que a espera de meio segundo.
   */
  const optimistic = useCallback(
    (
      conversationId: string,
      patch: Partial<Conversation>,
      run: () => Promise<{ ok: boolean; error?: string }>,
    ) => {
      setError(undefined);
      let snapshot: Conversation | undefined;

      setConversations((current) => {
        snapshot = current.find((conversation) => conversation.id === conversationId);
        return current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, ...patch } : conversation,
        );
      });

      startTransition(async () => {
        const result = await run();
        if (!result.ok) {
          setError(result.error);
          if (snapshot) {
            const previous = snapshot;
            setConversations((current) =>
              current.map((conversation) =>
                conversation.id === conversationId ? previous : conversation,
              ),
            );
          }
        }
      });
    },
    [],
  );

  const handleAssign = useCallback(
    (assignee: { id: string; name: string } | null) => {
      if (!selected || !assign) return;
      const id = selected.id;
      optimistic(id, { assigneeId: assignee?.id, assigneeName: assignee?.name }, () =>
        assign({ conversationId: id, assigneeId: assignee?.id ?? null }),
      );
    },
    [selected, assign, optimistic],
  );

  const handleChangePriority = useCallback(
    (priority: Priority) => {
      if (!selected || !changePriority) return;
      const id = selected.id;
      optimistic(id, { priority }, () => changePriority({ conversationId: id, priority }));
    },
    [selected, changePriority, optimistic],
  );

  const handleSetLabels = useCallback(
    (labels: readonly Label[]) => {
      if (!selected || !setLabels) return;
      const id = selected.id;
      optimistic(id, { labels }, () =>
        setLabels({ conversationId: id, labelIds: labels.map((label) => label.id) }),
      );
    },
    [selected, setLabels, optimistic],
  );

  const handleSetContactLabels = useCallback(
    (labels: readonly Label[]) => {
      if (!selected || !setContactLabels) return;
      const id = selected.id;
      const contactId = selected.contact.id;
      optimistic(id, { contact: { ...selected.contact, labels } }, () =>
        setContactLabels({
          conversationId: id,
          contactId,
          labelIds: labels.map((label) => label.id),
        }),
      );
    },
    [selected, setContactLabels, optimistic],
  );

  /**
   * Move a conversa de caixa.
   *
   * Sem atualização otimista de propósito: a mudança pode **desatribuir** o
   * responsável — o servidor decide isso conferindo se ele alcança a caixa de
   * destino —, e adivinhar esse resultado na tela mostraria um estado que pode
   * não se confirmar. O evento de tempo real traz a conversa já resolvida.
   */
  const handleMoveInbox = useCallback(
    (inboxId: string) => {
      if (!selected || !moveInbox) return;
      setError(undefined);
      const conversationId = selected.id;
      startTransition(async () => {
        const result = await moveInbox({ conversationId, inboxId });
        if (!result.ok) setError(result.error);
      });
    },
    [selected, moveInbox],
  );

  const handleSendTemplate = useCallback(
    (templateId: string, values: readonly string[]) => {
      if (!selected || !sendTemplate) return;
      setError(undefined);
      const conversationId = selected.id;
      startTransition(async () => {
        const result = await sendTemplate({ conversationId, templateId, values });
        if (!result.ok) setError(result.error);
      });
    },
    [selected, sendTemplate],
  );

  /**
   * Anexo. Sem bolha otimista de propósito: o arquivo pode levar segundos para
   * subir, e uma bolha que aparece antes do upload terminar sugere um envio que
   * ainda pode falhar. Quem mostra o progresso é o composer.
   */
  const handleSendMedia = useCallback(
    async (form: FormData): Promise<{ ok: boolean; error?: string }> => {
      if (!selected || !sendMedia) return { ok: false, error: 'Nenhuma conversa selecionada.' };
      setError(undefined);
      form.set('conversationId', selected.id);
      const result = await sendMedia(form);
      if (!result.ok) setError(result.error);
      return { ok: result.ok, ...(result.error ? { error: result.error } : {}) };
    },
    [selected, sendMedia],
  );

  return {
    conversations: visibleConversations,
    selected,
    counts,
    unreadByInbox,
    scope,
    statusTab,
    sort,
    search,
    error,
    pending,
    setScope,
    setStatusTab,
    setSort,
    setSearch,
    filters,
    setFilters,
    select: setSelectedId,
    send: handleSend,
    deleteMessage: handleDeleteMessage,
    reactToMessage: handleReact,
    changeStatus: handleChangeStatus,
    assign: handleAssign,
    changePriority: handleChangePriority,
    setLabels: handleSetLabels,
    setContactLabels: handleSetContactLabels,
    sendTemplate: handleSendTemplate,
    moveInbox: handleMoveInbox,
    sendMedia: handleSendMedia,
  };
}
