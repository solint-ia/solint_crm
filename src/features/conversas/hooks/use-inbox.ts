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
import type { Message } from '@/core/domain/message';
import { previewOfMessage } from '@/core/domain/message';
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
  }) => Promise<{ ok: boolean; error?: string; message?: Message }>;
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
  /** Conversa aberta ao carregar — vem da URL em /conversas/[id]. */
  readonly initialSelectedId?: string;
}

/** Recortes combináveis da lista. `undefined` significa "não filtrar por isto". */
export interface InboxFilters {
  readonly channel?: Channel;
  readonly priority?: Priority;
  readonly labelId?: string;
  readonly unreadOnly?: boolean;
  readonly slaBreached?: boolean;
}

export const activeFilterCount = (filters: InboxFilters): number =>
  Object.values(filters).filter((value) => value !== undefined && value !== false).length;

/** Substitui a conversa e a recoloca no topo — atividade nova vem primeiro. */
const upsertConversation = (
  current: readonly Conversation[],
  conversation: Conversation,
): readonly Conversation[] => [conversation, ...current.filter((c) => c.id !== conversation.id)];

/**
 * Estado da caixa de entrada.
 * A filtragem reutiliza as regras do dominio, sem duplicar logica na UI.
 */
export function useInbox({
  initialConversations,
  currentUserId,
  currentUserName,
  sendMessage,
  changeStatus,
  markAsRead,
  assign,
  changePriority,
  setLabels,
  sendTemplate,
  sendMedia,
  setContactLabels,
  initialSelectedId,
}: UseInboxParams) {
  const [conversations, setConversations] = useState<readonly Conversation[]>(initialConversations);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedId ?? initialConversations[0]?.id,
  );
  const [scope, setScope] = useState<InboxScope>('todas');
  const [statusTab, setStatusTab] = useState<StatusTab>('todas');
  const [sort, setSort] = useState<SortKey>('recentes');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<InboxFilters>({});
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  // Tempo real vem do barramento compartilhado do workspace (uma unica conexao SSE).
  useConversationEvents((payload) => {
    // O servidor envia a conversa completa: substituir e sempre mais seguro
    // que remendar a timeline no cliente — e descarta a bolha otimista.
    const incoming = payload.conversation as Conversation | undefined;
    if (incoming) {
      setConversations((current) => upsertConversation(current, incoming));
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

      return upsertConversation(current, {
        ...existing,
        timeline: [...existing.timeline, { kind: 'message', message }],
        lastMessagePreview: previewOfMessage(message),
        lastMessageAt: message.time,
        lastActivityAt: new Date().toISOString(),
        unreadCount: message.author === 'contact' ? existing.unreadCount + 1 : existing.unreadCount,
      });
    });
  });

  const visibleConversations = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = conversations.filter((conversation) => {
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
  }, [conversations, scope, statusTab, search, sort, filters, currentUserId]);

  const selected = useMemo(
    () =>
      visibleConversations.find((conversation) => conversation.id === selectedId) ??
      visibleConversations[0],
    [visibleConversations, selectedId],
  );

  const counts = useMemo(
    () => ({
      minhas: conversations.filter((c) => matchesScope(c, 'minhas', currentUserId)).length,
      nao_atribuidas: conversations.filter((c) => matchesScope(c, 'nao_atribuidas', currentUserId))
        .length,
      todas: conversations.length,
    }),
    [conversations, currentUserId],
  );

  // Abrir a conversa confirma a leitura — inclusive no celular pareado.
  const readSignalled = useRef(new Set<string>());
  useEffect(() => {
    if (!selected || selected.unreadCount === 0 || !markAsRead) return;
    const id = selected.id;
    if (readSignalled.current.has(id)) return;
    readSignalled.current.add(id);

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...conversation, unreadCount: 0 } : conversation,
      ),
    );
    void markAsRead({ conversationId: id }).finally(() => {
      readSignalled.current.delete(id);
    });
  }, [selected, markAsRead]);

  const appendLocalMessage = useCallback(
    (conversationId: string, text: string, mode: ComposerMode) => {
      const isPrivate = mode === 'nota';
      const message: Message = {
        id: `local-${Date.now()}`,
        conversationId,
        author: 'agent',
        authorName: currentUserName,
        origin: 'crm',
        content: { type: 'text', text },
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
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

  const handleSend = useCallback(
    (text: string, mode: ComposerMode) => {
      if (!selected) return;
      setError(undefined);
      const conversationId = selected.id;
      const localId = appendLocalMessage(conversationId, text, mode);

      startTransition(async () => {
        const result = await sendMessage({
          conversationId,
          text,
          isPrivate: mode === 'nota',
        });
        if (!result.ok) setError(result.error);
        // Sem mensagem persistida o envio não chegou ao dominio: não deixe uma
        // bolha fantasma sugerindo que a mensagem existe.
        if (!result.message) dropLocalMessage(conversationId, localId);
      });
    },
    [selected, appendLocalMessage, dropLocalMessage, sendMessage],
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
    changeStatus: handleChangeStatus,
    assign: handleAssign,
    changePriority: handleChangePriority,
    setLabels: handleSetLabels,
    setContactLabels: handleSetContactLabels,
    sendTemplate: handleSendTemplate,
    sendMedia: handleSendMedia,
  };
}
