import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/infrastructure/auth/password';
import { AI_AGENTS } from '../src/infrastructure/seed/ai-agents';
import { CONTACTS } from '../src/infrastructure/seed/contacts';
import { CONVERSATIONS } from '../src/infrastructure/seed/conversations';
import { KNOWLEDGE } from '../src/infrastructure/seed/knowledge';
import { NOTIFICATIONS } from '../src/infrastructure/seed/notifications';
import { DEALS, PIPELINES } from '../src/infrastructure/seed/pipelines';
import { SETTINGS } from '../src/infrastructure/seed/settings';
import { ACCOUNTS, ACCOUNT_ID, LABELS, ROLES, USERS } from '../src/infrastructure/seed/workspace';

/**
 * Carga inicial do banco.
 *
 * É idempotente: apaga a conta de demonstração e recria tudo. Rodar duas vezes
 * dá o mesmo resultado, o que importa porque este script vai ser executado
 * muitas vezes durante o desenvolvimento.
 *
 * A senha é a mesma para os três usuários **de propósito**: o ponto de ter três
 * é poder entrar como administrador, supervisor e agente e ver o RBAC agir —
 * com um usuário só, as permissões eram código não verificável.
 */

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'solint2026';

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
});

const json = (value: unknown): string => JSON.stringify(value ?? null);

/** O `time` do seed é rótulo ("14:32"); o instante real é reconstruído a partir dele. */
const instantFor = (label: string, index: number, total: number): Date => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  const base = new Date();
  if (match) {
    base.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return base;
  }
  // Sem hora legível, distribui as mensagens na última hora preservando a ordem.
  return new Date(Date.now() - (total - index) * 60_000);
};

async function main() {
  const account = ACCOUNTS[0];
  if (!account) throw new Error('Seed sem conta.');

  console.log('· limpando a conta de demonstração');
  await prisma.account.deleteMany({ where: { id: { in: ACCOUNTS.map((a) => a.id) } } });

  console.log('· conta e papéis');
  await prisma.account.create({
    data: {
      id: account.id,
      name: account.name,
      plan: account.plan,
      document: account.document ?? null,
    },
  });

  await prisma.role.createMany({
    data: ROLES.map((role) => ({
      id: role.id,
      accountId: role.accountId,
      slug: role.slug,
      name: role.name,
      description: role.description,
      permissionsJson: json(role.permissions),
      isSystem: role.isSystem,
    })),
  });

  console.log('· usuários');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.user.createMany({
    data: USERS.map((user) => ({
      id: user.id,
      accountId: user.accountId,
      name: user.name,
      email: user.email.toLowerCase(),
      passwordHash,
      roleSlug: user.roleSlug,
      avatarTone: user.avatarTone,
      availability: user.availability,
      teamsJson: json(user.teams),
      signature: user.signature ?? null,
      twoFactorEnabled: user.twoFactorEnabled,
      lastActiveAt: user.lastActiveAt ?? null,
    })),
  });

  console.log('· etiquetas');
  await prisma.label.createMany({
    data: LABELS.map((label) => ({
      id: label.id,
      accountId: label.accountId,
      name: label.name,
      tone: label.tone,
      description: label.description ?? null,
      usageCount: label.usageCount ?? null,
    })),
  });

  console.log('· contatos');
  for (const contact of CONTACTS) {
    await prisma.contact.create({
      data: {
        id: contact.id,
        accountId: contact.accountId,
        name: contact.name,
        phone: contact.phone,
        email: contact.email ?? null,
        company: contact.company ?? null,
        channel: contact.channel,
        avatarTone: contact.avatarTone,
        location: contact.location ?? null,
        timezone: contact.timezone ?? null,
        ownerName: contact.ownerName ?? null,
        lastContactAt: contact.lastContactAt ?? null,
        lastContactLabel: contact.lastContactLabel ?? null,
        customFieldsJson: json(contact.customFields),
        notes: contact.notes ?? null,
        timelineJson: contact.timeline ? json(contact.timeline) : null,
        kind: contact.kind ?? 'pessoa',
        avatarUrl: contact.avatarUrl ?? null,
        participantCount: contact.participantCount ?? null,
        labels: { connect: contact.labels.map((label) => ({ id: label.id })) },
      },
    });
  }

  console.log('· conversas e mensagens');
  for (const conversation of CONVERSATIONS) {
    const messages = conversation.timeline.filter((item) => item.kind === 'message');

    await prisma.conversation.create({
      data: {
        id: conversation.id,
        accountId: conversation.accountId,
        contactId: conversation.contact.id,
        channel: conversation.channel,
        inboxId: conversation.inboxId,
        queue: conversation.queue,
        status: conversation.status,
        statusLabel: conversation.statusLabel,
        priority: conversation.priority,
        assigneeId: conversation.assigneeId ?? null,
        assigneeName: conversation.assigneeName ?? null,
        unreadCount: conversation.unreadCount,
        lastMessagePreview: conversation.lastMessagePreview,
        lastMessageAt: conversation.lastMessageAt,
        lastActivityAt: conversation.lastActivityAt
          ? new Date(conversation.lastActivityAt)
          : new Date(),
        protocolsJson: json(conversation.protocols),
        slaDeadlineAt: conversation.slaDeadlineAt ?? null,
        slaLabel: conversation.slaLabel ?? null,
        slaBreached: conversation.slaBreached ?? null,
        isTyping: conversation.isTyping ?? null,
        collisionAgent: conversation.collisionAgent ?? null,
        lastInboundAt: conversation.lastInboundAt ?? null,
        channelOffline: conversation.channelOffline ?? null,
        channelThreadId: conversation.channelThreadId ?? null,
        labels: { connect: conversation.labels.map((label) => ({ id: label.id })) },
        messages: {
          create: messages.map((item, index) => ({
            id: item.message.id,
            author: item.message.author,
            authorName: item.message.authorName ?? null,
            contentType: item.message.content.type,
            contentJson: json(item.message.content),
            time: item.message.time,
            createdAt: instantFor(item.message.time, index, messages.length),
            deliveryStatus: item.message.deliveryStatus ?? null,
            isPrivate: item.message.isPrivate,
            replyToId: item.message.replyToId ?? null,
            externalId: item.message.externalId ?? null,
            origin: item.message.origin ?? null,
          })),
        },
      },
    });
  }

  console.log('· funis e oportunidades');
  for (const pipeline of PIPELINES) {
    await prisma.pipeline.create({
      data: {
        id: pipeline.id,
        accountId: pipeline.accountId,
        name: pipeline.name,
        stages: {
          create: pipeline.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            order: stage.order,
            color: stage.color,
            isWon: stage.isWon,
            isLost: stage.isLost,
          })),
        },
      },
    });
  }

  await prisma.deal.createMany({
    data: DEALS.map((deal) => ({
      id: deal.id,
      accountId: deal.accountId,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      contactId: deal.contactId ?? null,
      contactName: deal.contactName,
      company: deal.company ?? null,
      amountInCents: deal.amountInCents,
      ownerName: deal.ownerName,
      priority: deal.priority,
      enteredStageAt: deal.enteredStageAt,
      stageAgeLabel: deal.stageAgeLabel,
      nextAction: deal.nextAction,
      conversationId: deal.conversationId ?? null,
      historyJson: json(deal.history),
    })),
  });

  console.log('· agentes de IA');
  await prisma.aiAgent.createMany({
    data: AI_AGENTS.map((agent) => ({
      id: agent.id,
      accountId: agent.accountId,
      name: agent.name,
      scope: agent.scope,
      active: agent.active,
      persona: agent.persona,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      handledCount: agent.handledCount,
      transferRate: agent.transferRate,
      knowledgeBaseJson: json(agent.knowledgeBase),
      transferRulesJson: json(agent.transferRules),
      flowJson: json(agent.flow),
      logsJson: json(agent.logs),
    })),
  });

  console.log('· notificações');
  await prisma.notification.createMany({
    data: NOTIFICATIONS.map((notification, index) => ({
      id: notification.id,
      accountId: notification.accountId,
      userId: null,
      kind: notification.kind,
      text: notification.text,
      timeLabel: notification.timeLabel,
      read: notification.read,
      href: notification.href ?? null,
      createdAt: new Date(Date.now() - index * 600_000),
    })),
  });

  console.log('· automações e caixas de entrada');
  await prisma.automation.createMany({
    data: SETTINGS.automations.map((automation) => ({
      id: automation.id,
      accountId: automation.accountId,
      name: automation.name,
      trigger: automation.trigger,
      conditionsJson: json(automation.conditions),
      actionsJson: json(automation.actions),
      enabled: automation.enabled,
      order: automation.order,
    })),
  });

  await prisma.channelConnection.createMany({
    data: SETTINGS.connections.map((connection) => ({
      id: connection.id,
      accountId: ACCOUNT_ID,
      name: connection.name,
      channel: connection.channel,
      identifier: connection.identifier,
      status: connection.status,
      provider: connection.provider,
      businessHoursJson: json(connection.businessHours),
      awayMessageJson: json(connection.awayMessage),
      greetingJson: json(connection.greeting),
      webhookUrl: connection.webhookUrl ?? null,
      teamName: connection.teamName ?? null,
    })),
  });

  console.log('· base de conhecimento');
  await prisma.knowledgeCategory.createMany({
    data: KNOWLEDGE.categories.map((category) => ({
      id: category.id,
      accountId: category.accountId,
      name: category.name,
      description: category.description,
      order: category.order,
    })),
  });

  await prisma.knowledgeArticle.createMany({
    data: KNOWLEDGE.articles.map((article) => ({
      id: article.id,
      accountId: article.accountId,
      categoryId: article.categoryId,
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      content: article.content,
      status: article.status,
      updatedLabel: article.updatedLabel,
      authorName: article.authorName,
      views: article.views,
      helpful: article.helpful,
      notHelpful: article.notHelpful,
      tagsJson: json(article.tags),
    })),
  });

  console.log('· configurações da conta');
  await prisma.accountSettings.create({
    data: {
      accountId: ACCOUNT_ID,
      assignmentMethod: SETTINGS.assignmentMethod,
      macrosJson: json(SETTINGS.macros),
      cannedResponsesJson: json(SETTINGS.cannedResponses),
      webhooksJson: json(SETTINGS.webhooks),
      apiTokensJson: json(SETTINGS.apiTokens),
      teamsJson: json(SETTINGS.teams),
      customAttributesJson: json(SETTINGS.customAttributes),
      billingJson: json(SETTINGS.billing),
      auditLogJson: json(SETTINGS.auditLog),
      activeSessionsJson: json(SETTINGS.activeSessions),
    },
  });

  console.log('\nPronto. Entre com qualquer um destes:');
  for (const user of USERS) {
    console.log(`   ${user.email.padEnd(30)} ${user.roleSlug.padEnd(14)} senha: ${DEMO_PASSWORD}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
