import type {
  AgentFlowBlock,
  AiAgent,
  AiAgentLog,
  KnowledgeDocument,
  TransferRule,
} from '@/core/domain/ai-agent';
import type {
  Automation,
  AutomationAction,
  AutomationCondition,
  AutomationConditionLogic,
} from '@/core/domain/automation';
import { AUTOMATION_CONDITION_LOGICS } from '@/core/domain/automation';
import { normalizeAutoReply, normalizeBusinessHours } from '@/core/domain/business-hours';
import type { Channel } from '@/core/domain/channel';
import type {
  Contact,
  ContactPartner,
  CustomField,
  TimelineEvent,
} from '@/core/domain/contact';
import type {
  Conversation,
  ConversationStatus,
  Priority,
  Protocol,
} from '@/core/domain/conversation';
import type { KnowledgeArticle, KnowledgeCategory } from '@/core/domain/knowledge';
import type { Label, Tone } from '@/core/domain/label';
import type { Message, MessageContent, MessageReaction, TimelineItem } from '@/core/domain/message';
import type { AppNotification, NotificationKind } from '@/core/domain/notification';
import type { Deal, DealSource, Pipeline } from '@/core/domain/pipeline';
import type { ChannelConnection } from '@/core/domain/settings';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type User,
} from '@/core/domain/user';
import { readJson } from '@/infrastructure/db/prisma';
import { dataCurtaLabel, inicioDoDia } from '@/lib/datetime';
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
  ...(row.extraPhones.length > 0 ? { extraPhones: row.extraPhones } : {}),
  channel: row.channel as Channel,
  avatarTone: row.avatarTone,
  labels: row.labels.map(labelRow),
  customFields: readJson<readonly CustomField[]>(row.customFields, []),
  ...(row.email ? { email: row.email } : {}),
  ...(row.company ? { company: row.company } : {}),
  ...(row.cnpj ? { cnpj: row.cnpj } : {}),
  ...(row.companyAddress ? { companyAddress: row.companyAddress } : {}),
  ...(row.companyPhone ? { companyPhone: row.companyPhone } : {}),
  ...(row.partnerPhone ? { partnerPhone: row.partnerPhone } : {}),
  ...(row.classification ? { classification: row.classification } : {}),
  ...(() => {
    // Lista vazia é o mesmo que ausente para quem consome: o campo só existe
    // para contatos da importação B2B, e entregar `[]` faria toda tela ter de
    // distinguir "sem sócios" de "não se aplica".
    const socios = readJson<readonly ContactPartner[]>(row.partners, []);
    return socios.length > 0 ? { partners: socios } : {};
  })(),
  ...(row.origin ? { origin: row.origin as Contact['origin'] } : {}),
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
  // O instante real vai junto para a tela formatar a hora no fuso de exibição.
  // Sem ele a bolha só teria o rótulo gravado, que nasceu em UTC no servidor.
  createdAt: row.createdAt.toISOString(),
  isPrivate: row.isPrivate,
  ...(row.authorName ? { authorName: row.authorName } : {}),
  ...(row.deliveryStatus
    ? { deliveryStatus: row.deliveryStatus as Message['deliveryStatus'] }
    : {}),
  ...(row.replyToId ? { replyToId: row.replyToId } : {}),
  ...(row.deletedAt ? { deletedAt: row.deletedAt.toISOString() } : {}),
  ...(row.externalId ? { externalId: row.externalId } : {}),
  ...(row.origin ? { origin: row.origin as Message['origin'] } : {}),
  // Lista vazia não vira propriedade: `reactions: []` em toda mensagem
  // engordaria o payload de uma timeline inteira para dizer "nenhuma".
  ...(() => {
    const reactions = readJson<readonly MessageReaction[]>(row.reactions, []);
    return reactions.length > 0 ? { reactions } : {};
  })(),
  ...(row.senderJid ? { senderJid: row.senderJid } : {}),
  // Mesma economia das reações: lista vazia não vira propriedade.
  ...(() => {
    const mentions = readJson<readonly string[]>(row.mentions, []);
    return mentions.length > 0 ? { mentions } : {};
  })(),
});

const DAY_MS = 86_400_000;

/**
 * Rótulo do divisor de dia.
 *
 * A versão em memória trazia os divisores prontos no seed. Agora eles são
 * derivados de `createdAt`, que é o instante real — o campo `time` é só um
 * rótulo ("14:32") e não sabe de que dia é.
 *
 * O corte do dia sai de `inicioDoDia`, que respeita o fuso de exibição. Com o
 * corte em UTC, tudo que fosse enviado depois das 21h em Brasília já contava
 * como o dia seguinte e a conversa da noite aparecia sob "Hoje" na manhã
 * seguinte.
 */
const dayLabel = (date: Date, today: number): string => {
  const diff = Math.round((today - inicioDoDia(date)) / DAY_MS);
  if (diff <= 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return dataCurtaLabel(date);
};

/** `createdAt` ja faz parte do modelo: e dele que saem os divisores de dia. */
type MessageRow = DbMessage;

/** Monta a timeline intercalando divisores de dia entre as mensagens. */
export const buildTimeline = (
  rows: readonly MessageRow[],
  now: Date = new Date(),
): readonly TimelineItem[] => {
  const today = inicioDoDia(now);
  const items: TimelineItem[] = [];
  let currentDay: number | undefined;

  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const row of sorted) {
    const day = inicioDoDia(row.createdAt);
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
  // As mensagens chegam da mais nova para a mais antiga (ver CONVERSATION_INCLUDE).
  timeline: buildTimeline([...row.messages].reverse()),
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

/**
 * Teto de mensagens carregadas por conversa.
 *
 * Sem teto, `messages` trazia a timeline inteira — e não só na tela da conversa.
 * A lista da caixa de entrada (`list`) usa o mesmo `include`, então abrir a
 * caixa arrastava todas as mensagens de todas as conversas. Pior: o WhatsApp
 * chama `loadConversation` a cada mensagem nova e a **cada recibo de entrega**
 * (dois por mensagem: entregue e lido), e o resultado inteiro ainda viaja pelo
 * SSE até o navegador. Uma conversa antiga tornava cada tique duplo caro.
 */
export const CONVERSATION_TIMELINE_LIMIT = 200;

/**
 * `desc` + `take` traz as N mensagens **mais recentes**; a ordem cronológica é
 * restaurada em `conversationRow`. Com `asc` o `take` traria as N mais antigas,
 * que é exatamente o oposto do que a tela precisa mostrar.
 */
export const CONVERSATION_INCLUDE = {
  contact: { include: { labels: true } },
  labels: true,
  messages: { orderBy: { createdAt: 'desc' }, take: CONVERSATION_TIMELINE_LIMIT },
} as const;

/**
 * A pessoa mais o vínculo viram o `User` do domínio.
 *
 * São dois parâmetros e não um porque papel, equipes e disponibilidade
 * pertencem ao vínculo, não à pessoa: o mesmo `DbUser` produz um administrador
 * numa conta e um agente em outra. O domínio continua vendo um objeto só — é a
 * fronteira fazendo o trabalho dela.
 */
export const userRow = (
  row: DbUser,
  membership: DbMembership,
  /**
   * Nomes das equipes da pessoa nesta conta.
   *
   * Vem de fora porque a relação agora mora em `TeamMember`, e este arquivo é
   * de mapeamento puro — não consulta banco. Quem já carregou o vínculo passa a
   * lista; quem não precisa dela omite e recebe vazio, que é o comportamento
   * honesto para "não perguntei".
   */
  teams: readonly string[] = [],
): User => ({
  id: row.id,
  accountId: membership.accountId,
  name: row.name,
  email: row.email,
  roleSlug: membership.roleSlug,
  avatarTone: row.avatarTone,
  ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
  availability: membership.availability as User['availability'],
  teams,
  signatureEnabled: row.signatureEnabled,
  // A coluna é nula para quem existia antes dela, e um campo novo acrescentado
  // aqui não pode chegar como `undefined` na tela. O padrão preenche as duas
  // lacunas de uma vez.
  notifications: {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...readJson<Partial<NotificationPreferences>>(row.notificationPrefs, {}),
  },
  twoFactorEnabled: row.twoFactorEnabled,
  ...(row.signature ? { signature: row.signature } : {}),
  ...(row.lastActiveAt ? { lastActiveAt: row.lastActiveAt } : {}),
});

type PipelineWithStages = Prisma.PipelineGetPayload<{
  include: { stages: true; inbox: { select: { name: true } } };
}>;

export const pipelineRow = (row: PipelineWithStages): Pipeline => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  ...(row.inboxId ? { inboxId: row.inboxId } : {}),
  ...(row.inbox?.name ? { inboxName: row.inbox.name } : {}),
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
      conversionWeight: stage.conversionWeight,
      ...(stage.labelId ? { labelId: stage.labelId } : {}),
    })),
});

/**
 * O card com as tarefas juntas, quando a consulta as trouxe.
 *
 * As tarefas moram em tabela própria (`Task`), então só existem aqui se quem
 * consultou pediu o `include`. Sem esta variante o mapeador teria de escolher
 * entre exigir o join sempre — caro nas listagens do quadro, que não mostram
 * checklist — ou nunca trazer as tarefas, que foi o que aconteceu: a tabela
 * existia e a tela mantinha a lista só na memória do navegador.
 */
type DbDealWithTasks = DbDeal & {
  readonly tasks?: readonly {
    id: string;
    title: string;
    completed: boolean;
    dueDate: Date | null;
  }[];
};

export const dealRow = (row: DbDealWithTasks): Deal => ({
  id: row.id,
  accountId: row.accountId,
  pipelineId: row.pipelineId,
  stageId: row.stageId,
  contactName: row.contactName,
  amountInCents: row.amountInCents,
  ownerName: row.ownerName,
  priority: row.priority as Priority,
  createdAt: row.createdAt.toISOString(),
  enteredStageAt: row.enteredStageAt,
  stageAgeLabel: row.stageAgeLabel,
  nextAction: row.nextAction,
  history: readJson<Deal['history']>(row.history, []),
  ...(row.contactId ? { contactId: row.contactId } : {}),
  ...(row.company ? { company: row.company } : {}),
  ...(row.title ? { title: row.title } : {}),
  ...(row.source ? { source: row.source as DealSource } : {}),
  ...(row.conversationId ? { conversationId: row.conversationId } : {}),
  ...(row.tasks
    ? {
        tasks: row.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          completed: task.completed,
          ...(task.dueDate ? { dueDate: task.dueDate.toISOString() } : {}),
        })),
      }
    : {}),
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
  conditionLogic: (AUTOMATION_CONDITION_LOGICS as readonly string[]).includes(row.conditionLogic)
    ? (row.conditionLogic as AutomationConditionLogic)
    : 'e',
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
  // Normaliza a forma, não só a ausência: uma caixa gravada por versão antiga
  // do cadastro trazia `schedule` no lugar de `days`, passava pelo `readJson`
  // por ser um objeto válido, e derrubava a tela de Configurações inteira.
  businessHours: normalizeBusinessHours(row.businessHours),
  // `readJson` devolvia o objeto guardado inteiro, e o cadastro gravava
  // `{ enabled, message }`. A caixa chegava na tela sem `text` e o salvamento
  // era recusado inteiro — ver `normalizeAutoReply`.
  awayMessage: normalizeAutoReply(row.awayMessage),
  greeting: normalizeAutoReply(row.greeting),
  closingMessage: normalizeAutoReply(row.closingMessage),
  waitingMessage: normalizeAutoReply(row.waitingMessage),
  waitingMessageDelayMinutes: row.waitingMessageDelayMinutes || 5,
  csatEnabled: row.csatEnabled,
  ...(row.csatQuestion ? { csatQuestion: row.csatQuestion } : {}),
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
