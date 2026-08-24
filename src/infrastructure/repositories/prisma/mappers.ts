import type {
  AgentFlowBlock,
  AiAgent,
  AiAgentLog,
  KnowledgeDocument,
  TransferRule,
} from '@/core/domain/ai-agent';
import type { Automation, AutomationAction, AutomationCondition } from '@/core/domain/automation';
import type { AutoReply, BusinessHours } from '@/core/domain/business-hours';
import type { Channel } from '@/core/domain/channel';
import type { Contact, CustomField, TimelineEvent } from '@/core/domain/contact';
import type {
  Conversation,
  ConversationStatus,
  Priority,
  Protocol,
} from '@/core/domain/conversation';
import type { KnowledgeArticle, KnowledgeCategory } from '@/core/domain/knowledge';
import type { Label, Tone } from '@/core/domain/label';
import type { Message, MessageContent, TimelineItem } from '@/core/domain/message';
import type { AppNotification, NotificationKind } from '@/core/domain/notification';
import type { Deal, Pipeline } from '@/core/domain/pipeline';
import type { ChannelConnection } from '@/core/domain/settings';
import type { User } from '@/core/domain/user';
import { readJson } from '@/infrastructure/db/prisma';
import type {
  AiAgent as DbAiAgent,
  Automation as DbAutomation,
  Inbox as DbInbox,
  Deal as DbDeal,
  KnowledgeArticle as DbArticle,
  KnowledgeCategory as DbCategory,
  Label as DbLabel,
  Membership as DbMembership,
  Message as DbMessage,
  Notification as DbNotification,
  Prisma,
  User as DbUser,
} from '@/generated/prisma';

/**
 * Tradução entre linha do banco e objeto de domínio.
 *
 * Fica num arquivo só de propósito: é aqui que mora todo o conhecimento sobre
 * o formato das colunas `Json` e sobre os campos opcionais. Se este mapa
 * estiver certo, nenhum repositório precisa saber que existe um banco.
 *
 * **Os tipos de entrada vêm do cliente gerado (`DbLabel`, `DbMessage`…), não
 * escritos à mão.** Antes eram literais, e o custo apareceu na migração para
 * Postgres: `content: string` continuou compilando depois de a coluna virar
 * `Json`, e só o comportamento denunciaria. Com o tipo gerado, mudar o esquema
 * quebra a compilação exatamente onde precisa ser lido de outro jeito.
 *
 * Uma regra vale para todos: **coluna nula não vira propriedade `undefined`**.
 * O projeto usa `exactOptionalPropertyTypes`, então `{ email: undefined }` não
 * é o mesmo que `{}` — e o segundo é o que o domínio espera para "não tem".
 */

export const labelRow = (row: DbLabel): Label => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  tone: row.tone as Tone,
  ...(row.description ? { description: row.description } : {}),
  ...(row.usageCount === null ? {} : { usageCount: row.usageCount }),
});

type ContactWithLabels = Prisma.ContactGetPayload<{ include: { labels: true } }>;

export const contactRow = (row: ContactWithLabels): Contact => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  phone: row.phone,
  channel: row.channel as Channel,
  avatarTone: row.avatarTone,
  labels: row.labels.map(labelRow),
  customFields: readJson<readonly CustomField[]>(row.customFields, []),
  ...(row.email ? { email: row.email } : {}),
  ...(row.company ? { company: row.company } : {}),
  ...(row.location ? { location: row.location } : {}),
  ...(row.timezone ? { timezone: row.timezone } : {}),
  ...(row.ownerName ? { ownerName: row.ownerName } : {}),
  ...(row.lastContactAt ? { lastContactAt: row.lastContactAt } : {}),
  ...(row.lastContactLabel ? { lastContactLabel: row.lastContactLabel } : {}),
  ...(row.notes ? { notes: row.notes } : {}),
  ...(row.timeline ? { timeline: readJson<readonly TimelineEvent[]>(row.timeline, []) } : {}),
  ...(row.kind ? { kind: row.kind as Contact['kind'] } : {}),
  ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
  ...(row.participantCount === null ? {} : { participantCount: row.participantCount }),
});

export const messageRow = (row: DbMessage): Message => ({
  id: row.id,
  conversationId: row.conversationId,
  author: row.author as Message['author'],
  content: readJson<MessageContent>(row.content, { type: 'text', text: '' }),
  time: row.time,
  isPrivate: row.isPrivate,
  ...(row.authorName ? { authorName: row.authorName } : {}),
  ...(row.deliveryStatus
    ? { deliveryStatus: row.deliveryStatus as Message['deliveryStatus'] }
    : {}),
  ...(row.replyToId ? { replyToId: row.replyToId } : {}),
  ...(row.externalId ? { externalId: row.externalId } : {}),
  ...(row.origin ? { origin: row.origin as Message['origin'] } : {}),
});

const DAY_MS = 86_400_000;

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Rótulo do divisor de dia.
 *
 * A versão em memória trazia os divisores prontos no seed. Agora eles são
 * derivados de `createdAt`, que é o instante real — o campo `time` é só um
 * rótulo ("14:32") e não sabe de que dia é.
 */
const dayLabel = (date: Date, today: number): string => {
  const diff = Math.round((today - startOfDay(date)) / DAY_MS);
  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

/** `createdAt` ja faz parte do modelo: e dele que saem os divisores de dia. */
type MessageRow = DbMessage;

/** Monta a timeline intercalando divisores de dia entre as mensagens. */
export const buildTimeline = (
  rows: readonly MessageRow[],
  now: Date = new Date(),
): readonly TimelineItem[] => {
  const today = startOfDay(now);
  const items: TimelineItem[] = [];
  let currentDay: number | undefined;

  for (const row of rows) {
    const day = startOfDay(row.createdAt);
    if (day !== currentDay) {
      currentDay = day;
      items.push({ kind: 'divider', label: dayLabel(row.createdAt, today) });
    }
    items.push({ kind: 'message', message: messageRow(row) });
  }

  return items;
};

type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: {
    contact: { include: { labels: true } };
    labels: true;
    messages: true;
  };
}>;

export const conversationRow = (row: ConversationWithRelations): Conversation => ({
  id: row.id,
  accountId: row.accountId,
  contact: contactRow(row.contact),
  channel: row.channel as Channel,
  inboxId: row.inboxId,
  queue: row.queue,
  status: row.status as ConversationStatus,
  statusLabel: row.statusLabel,
  priority: row.priority as Priority,
  unreadCount: row.unreadCount,
  lastMessagePreview: row.lastMessagePreview,
  lastMessageAt: row.lastMessageAt,
  labels: row.labels.map(labelRow),
  protocols: readJson<readonly Protocol[]>(row.protocols, []),
  timeline: buildTimeline(row.messages),
  ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
  ...(row.assigneeName ? { assigneeName: row.assigneeName } : {}),
  ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt.toISOString() } : {}),
  ...(row.slaDeadlineAt ? { slaDeadlineAt: row.slaDeadlineAt } : {}),
  ...(row.slaLabel ? { slaLabel: row.slaLabel } : {}),
  ...(row.slaBreached === null ? {} : { slaBreached: row.slaBreached }),
  ...(row.isTyping === null ? {} : { isTyping: row.isTyping }),
  ...(row.collisionAgent ? { collisionAgent: row.collisionAgent } : {}),
  ...(row.lastInboundAt ? { lastInboundAt: row.lastInboundAt } : {}),
  ...(row.channelOffline === null ? {} : { channelOffline: row.channelOffline }),
  ...(row.channelThreadId ? { channelThreadId: row.channelThreadId } : {}),
});

export const CONVERSATION_INCLUDE = {
  contact: { include: { labels: true } },
  labels: true,
  messages: { orderBy: { createdAt: 'asc' } },
} as const;

/**
 * A pessoa mais o vínculo viram o `User` do domínio.
 *
 * São dois parâmetros e não um porque papel, equipes e disponibilidade
 * pertencem ao vínculo, não à pessoa: o mesmo `DbUser` produz um administrador
 * numa conta e um agente em outra. O domínio continua vendo um objeto só — é a
 * fronteira fazendo o trabalho dela.
 */
export const userRow = (row: DbUser, membership: DbMembership): User => ({
  id: row.id,
  accountId: membership.accountId,
  name: row.name,
  email: row.email,
  roleSlug: membership.roleSlug,
  avatarTone: row.avatarTone,
  availability: membership.availability as User['availability'],
  teams: readJson<readonly string[]>(membership.teams, []),
  twoFactorEnabled: row.twoFactorEnabled,
  ...(row.signature ? { signature: row.signature } : {}),
  ...(row.lastActiveAt ? { lastActiveAt: row.lastActiveAt } : {}),
});

type PipelineWithStages = Prisma.PipelineGetPayload<{ include: { stages: true } }>;

export const pipelineRow = (row: PipelineWithStages): Pipeline => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  stages: [...row.stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      isWon: stage.isWon,
      isLost: stage.isLost,
    })),
});

export const dealRow = (row: DbDeal): Deal => ({
  id: row.id,
  accountId: row.accountId,
  pipelineId: row.pipelineId,
  stageId: row.stageId,
  contactName: row.contactName,
  amountInCents: row.amountInCents,
  ownerName: row.ownerName,
  priority: row.priority as Priority,
  enteredStageAt: row.enteredStageAt,
  stageAgeLabel: row.stageAgeLabel,
  nextAction: row.nextAction,
  history: readJson<Deal['history']>(row.history, []),
  ...(row.contactId ? { contactId: row.contactId } : {}),
  ...(row.company ? { company: row.company } : {}),
  ...(row.conversationId ? { conversationId: row.conversationId } : {}),
});

export const aiAgentRow = (row: DbAiAgent): AiAgent => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  scope: row.scope,
  active: row.active,
  persona: row.persona,
  systemPrompt: row.systemPrompt,
  model: row.model,
  handledCount: row.handledCount,
  transferRate: row.transferRate,
  knowledgeBase: readJson<readonly KnowledgeDocument[]>(row.knowledgeBase, []),
  transferRules: readJson<readonly TransferRule[]>(row.transferRules, []),
  flow: readJson<readonly AgentFlowBlock[]>(row.flow, []),
  logs: readJson<readonly AiAgentLog[]>(row.logs, []),
});

export const notificationRow = (row: DbNotification): AppNotification => ({
  id: row.id,
  accountId: row.accountId,
  kind: row.kind as NotificationKind,
  text: row.text,
  timeLabel: row.timeLabel,
  read: row.read,
  ...(row.href ? { href: row.href } : {}),
});

export const automationRow = (row: DbAutomation): Automation => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  trigger: row.trigger as Automation['trigger'],
  conditions: readJson<readonly AutomationCondition[]>(row.conditions, []),
  actions: readJson<readonly AutomationAction[]>(row.actions, []),
  enabled: row.enabled,
  order: row.order,
});

export const connectionRow = (row: DbInbox): ChannelConnection => ({
  id: row.id,
  name: row.name,
  channel: row.channel as Channel,
  identifier: row.identifier,
  status: row.status as ChannelConnection['status'],
  provider: row.provider,
  businessHours: readJson<BusinessHours>(row.businessHours, {
    timezone: 'America/Sao_Paulo',
    days: [],
  }),
  awayMessage: readJson<AutoReply>(row.awayMessage, { enabled: false, text: '' }),
  greeting: readJson<AutoReply>(row.greeting, { enabled: false, text: '' }),
  ...(row.webhookUrl ? { webhookUrl: row.webhookUrl } : {}),
  ...(row.teamName ? { teamName: row.teamName } : {}),
});

export const categoryRow = (row: DbCategory): KnowledgeCategory => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  description: row.description,
  order: row.order,
});

export const articleRow = (row: DbArticle): KnowledgeArticle => ({
  id: row.id,
  accountId: row.accountId,
  categoryId: row.categoryId,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  content: row.content,
  status: row.status as KnowledgeArticle['status'],
  updatedLabel: row.updatedLabel,
  authorName: row.authorName,
  views: row.views,
  helpful: row.helpful,
  notHelpful: row.notHelpful,
  tags: readJson<readonly string[]>(row.tags, []),
});
