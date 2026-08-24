import type { Channel } from './channel';
import type { Contact } from './contact';
import type { Label } from './label';
import type { Message, TimelineItem } from './message';
import type { Id, IsoDateTime } from './shared';

export const CONVERSATION_STATUSES = ['aberta', 'pendente', 'resolvida', 'espera'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const PRIORITIES = ['baixa', 'media', 'alta', 'urgente'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Protocol {
  readonly code: string;
  readonly date: string;
  readonly status: 'Resolvido' | 'Pendente' | 'Em andamento';
}

export interface Conversation {
  readonly id: Id;
  readonly accountId: Id;
  readonly contact: Contact;
  readonly channel: Channel;
  readonly inboxId: Id;
  readonly queue: string;
  readonly status: ConversationStatus;
  readonly statusLabel: string;
  readonly priority: Priority;
  readonly assigneeId?: Id;
  readonly assigneeName?: string;
  readonly unreadCount: number;
  readonly lastMessagePreview: string;
  /** Rotulo de exibicao (ex.: "14:32"). Nunca use para ordenar — use lastActivityAt. */
  readonly lastMessageAt: string;
  /** Instante real da última atividade — unica fonte de ordenacao cronologica. */
  readonly lastActivityAt?: IsoDateTime;
  readonly labels: readonly Label[];
  readonly protocols: readonly Protocol[];
  readonly timeline: readonly TimelineItem[];
  readonly slaDeadlineAt?: IsoDateTime;
  readonly slaLabel?: string;
  readonly slaBreached?: boolean;
  readonly isTyping?: boolean;
  /** Outro agente está com a conversa aberta (prevenção de colisão). */
  readonly collisionAgent?: string;
  /** Última mensagem recebida do contato — base da janela HSM de 24h. */
  readonly lastInboundAt?: IsoDateTime;
  readonly channelOffline?: boolean;
  /**
   * Identificador da thread no provedor do canal (JID do WhatsApp, por exemplo).
   * E o destino canonico de envio: sem ele, responder um grupo ou um contato
   * enderecado por LID quebraria.
   */
  readonly channelThreadId?: string;
}

/** Ordenacao cronologica confiavel: cai para 0 quando a conversa não tem atividade. */
export const activityTimeOf = (conversation: Pick<Conversation, 'lastActivityAt'>): number =>
  conversation.lastActivityAt ? Date.parse(conversation.lastActivityAt) : 0;

export const HSM_WINDOW_HOURS = 24;

/**
 * Regra WhatsApp: fora da janela de 24h desde a última mensagem do contato,
 * só é permitido enviar template HSM aprovado.
 */
export const isHsmWindowOpen = (
  conversation: Pick<Conversation, 'channel' | 'lastInboundAt'>,
  now: Date = new Date(),
): boolean => {
  if (conversation.channel !== 'whatsapp') return true;
  if (!conversation.lastInboundAt) return true;
  const elapsedMs = now.getTime() - new Date(conversation.lastInboundAt).getTime();
  return elapsedMs < HSM_WINDOW_HOURS * 60 * 60 * 1000;
};

/** Filtro rápido da lista de conversas. */
export type InboxScope = 'minhas' | 'nao_atribuidas' | 'todas';

export interface ConversationFilter {
  readonly scope: InboxScope;
  readonly status?: ConversationStatus | 'todas';
  readonly search?: string;
  readonly channel?: Channel;
  readonly priority?: Priority;
  readonly labelId?: Id;
  readonly sort?: 'recentes' | 'antigas' | 'prioridade';
}

export const PRIORITY_WEIGHT: Readonly<Record<Priority, number>> = {
  urgente: 4,
  alta: 3,
  media: 2,
  baixa: 1,
};

/** Regras de visibilidade da lista, isoladas do componente (SRP + testabilidade). */
export const matchesScope = (
  conversation: Pick<Conversation, 'assigneeId'>,
  scope: InboxScope,
  currentUserId: Id,
): boolean => {
  if (scope === 'minhas') return conversation.assigneeId === currentUserId;
  if (scope === 'nao_atribuidas') return !conversation.assigneeId;
  return true;
};

export const lastMessageOf = (conversation: Conversation): Message | undefined => {
  for (let index = conversation.timeline.length - 1; index >= 0; index -= 1) {
    const item = conversation.timeline[index];
    if (item && item.kind === 'message') return item.message;
  }
  return undefined;
};
