// O `tsx` nao carrega `.env` sozinho, e este script roda fora do Next.
import 'dotenv/config';

import crypto from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/infrastructure/auth/password';
import { AI_AGENTS } from '../src/infrastructure/seed/ai-agents';
import { CAMPAIGNS, SEGMENTS, TEMPLATES } from '../src/infrastructure/seed/campaigns';
import { CONTACTS } from '../src/infrastructure/seed/contacts';
import { CONVERSATIONS } from '../src/infrastructure/seed/conversations';
import { KNOWLEDGE } from '../src/infrastructure/seed/knowledge';
import { NOTIFICATIONS } from '../src/infrastructure/seed/notifications';
import { DEALS, PIPELINES } from '../src/infrastructure/seed/pipelines';
import { SETTINGS } from '../src/infrastructure/seed/settings';
import { PERMISSIONS } from '../src/core/domain/user';
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

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DIRECT_URL ou DATABASE_URL ausente. Rode `npm run db:check`.');
}

// `DIRECT_URL` (porta de sessão) e não o pooler de transação: a carga faz muitas
// escritas em sequência e não ganha nada com o pooler.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Adapta um agregado para uma coluna `Json`.
 *
 * Era `JSON.stringify` quando as colunas eram `String`. **Mantê-lo assim depois
 * da migração compilaria** — uma string também é um valor JSON válido — e
 * gravaria a *string* do JSON dentro do `jsonb`. O dado sairia errado em
 * silêncio, e só a leitura denunciaria, longe daqui.
 */
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

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

  // As pessoas têm de ser apagadas à parte. Antes elas iam na cascata da conta,
  // porque `User` tinha `accountId`; com o vínculo em `Membership`, apagar a
  // conta apaga o vínculo e **deixa a pessoa de pé** — o que é o comportamento
  // certo (ela pode atender em outra conta), e o que quebrava a idempotência
  // desta carga: o `createMany` seguinte batia no id já existente.
  await prisma.user.deleteMany({ where: { id: { in: USERS.map((u) => u.id) } } });

  console.log('· contas e papéis');
  // As DUAS contas do seed, e não só a primeira. A segunda existe para que o
  // seletor de workspace tenha para onde ir — com uma conta só, multi-tenant
  // continua sendo código que ninguém consegue verificar.
  await prisma.account.createMany({
    data: ACCOUNTS.map((row) => ({
      id: row.id,
      name: row.name,
      plan: row.plan,
      document: row.document ?? null,
    })),
  });

  const secondary = ACCOUNTS[1];

  await prisma.role.createMany({
    data: [
      ...ROLES.map((role) => ({
        id: role.id,
        accountId: role.accountId,
        slug: role.slug,
        name: role.name,
        description: role.description,
        permissions: json(role.permissions),
        isSystem: role.isSystem,
      })),
      // Papéis são por conta: o `administrador` de uma não vale na outra.
      ...(secondary
        ? [{
            id: `role-admin-${secondary.id}`,
            accountId: secondary.id,
            slug: 'administrador',
            name: 'Administrador',
            description: 'Acesso total, incluindo faturamento, integrações e segurança.',
            permissions: json(PERMISSIONS),
            isSystem: true,
          }]
        : []),
    ],
  });

  console.log('· usuários');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.user.createMany({
    data: USERS.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email.toLowerCase(),
      passwordHash,
      avatarTone: user.avatarTone,
      signature: user.signature ?? null,
      signatureEnabled: user.signatureEnabled,
      twoFactorEnabled: user.twoFactorEnabled,
      lastActiveAt: user.lastActiveAt ?? null,
    })),
  });

  // O vínculo é o que dá papel, equipe e disponibilidade — por conta.
  const first = USERS[0];
  await prisma.membership.createMany({
    data: [
      ...USERS.map((user) => ({
        userId: user.id,
        accountId: user.accountId,
        roleSlug: user.roleSlug,
        availability: user.availability,
      })),
      // O administrador também atende na segunda conta. É o que torna o seletor
      // de workspace uma coisa testável em vez de um botão com uma opção só.
      ...(secondary && first
        ? [{
            userId: first.id,
            accountId: secondary.id,
            roleSlug: 'administrador',
            availability: 'disponivel',
          }]
        : []),
    ],
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
        customFields: json(contact.customFields),
        notes: contact.notes ?? null,
        timeline: json(contact.timeline ?? []),
        kind: contact.kind ?? 'pessoa',
        avatarUrl: contact.avatarUrl ?? null,
        participantCount: contact.participantCount ?? null,
        labels: { connect: contact.labels.map((label) => ({ id: label.id })) },
      },
    });
  }

  console.log('· caixas de entrada');
  await prisma.inbox.createMany({
    data: SETTINGS.connections.map((connection) => ({
      id: connection.id,
      accountId: ACCOUNT_ID,
      name: connection.name,
      channel: connection.channel,
      identifier: connection.identifier,
      status: connection.status,
      provider: connection.provider,
      businessHours: json(connection.businessHours),
      awayMessage: json(connection.awayMessage),
      greeting: json(connection.greeting),
      webhookUrl: connection.webhookUrl ?? null,
      teamName: connection.teamName ?? null,
    })),
  });

  if (process.env.SEED_MOCK_CONVERSATIONS === 'true') {
    console.log('· conversas e mensagens de exemplo');
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
          protocols: json(conversation.protocols),
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
              content: json(item.message.content),
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
      history: json(deal.history),
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
      knowledgeBase: json(agent.knowledgeBase),
      transferRules: json(agent.transferRules),
      flow: json(agent.flow),
      logs: json(agent.logs),
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

  console.log('· automações');
  await prisma.automation.createMany({
    data: SETTINGS.automations.map((automation) => ({
      id: automation.id,
      accountId: automation.accountId,
      name: automation.name,
      trigger: automation.trigger,
      conditions: json(automation.conditions),
      actions: json(automation.actions),
      enabled: automation.enabled,
      order: automation.order,
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
      tags: json(article.tags),
    })),
  });

  console.log('· equipes');
  await prisma.team.createMany({
    data: SETTINGS.teams.map((t) => ({
      id: t.id,
      accountId: ACCOUNT_ID,
      name: t.name,
      description: null,
      color: t.color,
    })),
  });

  // Os vínculos vivem em tabelas próprias desde a migração `remove_json_equipes`.
  // São eles que decidem quem enxerga qual caixa de entrada — ver `TeamInbox`.
  await prisma.teamInbox.createMany({
    data: SETTINGS.teams.flatMap((t) =>
      t.inboxIds.map((inboxId) => ({ teamId: t.id, inboxId })),
    ),
    skipDuplicates: true,
  });

  await prisma.teamMember.createMany({
    data: SETTINGS.teams.flatMap((t) => t.memberIds.map((userId) => ({ teamId: t.id, userId }))),
    skipDuplicates: true,
  });

  console.log('· webhooks');
  await prisma.webhook.createMany({
    data: SETTINGS.webhooks.map((w) => ({
      id: w.id,
      accountId: ACCOUNT_ID,
      name: w.url.includes('erp') ? 'Integração ERP' : 'Automação n8n',
      url: w.url,
      events: json(w.events),
      secret: null,
      isActive: w.enabled,
      failureCount: 0,
    })),
  });

  console.log('· tokens de API');
  await prisma.apiToken.createMany({
    data: SETTINGS.apiTokens.map((tk) => ({
      id: tk.id,
      accountId: ACCOUNT_ID,
      name: tk.name,
      tokenHash: crypto.createHash('sha256').update(tk.id).digest('hex'),
      tokenPrefix: 'sk_live_',
      permissions: json(['*']),
      lastUsedAt: new Date(),
    })),
  });

  console.log('· atributos customizados');
  await prisma.customAttributeDefinition.createMany({
    data: SETTINGS.customAttributes.map((ca, idx) => ({
      id: ca.id,
      accountId: ACCOUNT_ID,
      target: ca.appliesTo === 'conversa' ? 'deal' : 'contact',
      name: ca.name,
      key: ca.key,
      type: ca.type === 'lista' ? 'select' : ca.type === 'numero' ? 'number' : ca.type === 'data' ? 'date' : 'text',
      options: json([]),
      isRequired: false,
      order: idx,
    })),
  });

  console.log('· respostas rápidas');
  await prisma.cannedResponse.createMany({
    data: SETTINGS.cannedResponses.map((cr) => ({
      id: cr.id,
      accountId: ACCOUNT_ID,
      shortcut: cr.shortcut,
      content: cr.content,
      category: 'Geral',
      tags: json([]),
      usageCount: 0,
    })),
  });

  console.log('· macros');
  await prisma.macro.createMany({
    data: SETTINGS.macros.map((m) => ({
      id: m.id,
      accountId: ACCOUNT_ID,
      name: m.name,
      description: m.steps,
      category: 'Geral',
      shortcut: null,
      actions: json([]),
    })),
  });

  console.log('· logs de auditoria');
  await prisma.auditLogEntry.createMany({
    data: SETTINGS.auditLog.map((al) => ({
      id: al.id,
      accountId: ACCOUNT_ID,
      actorId: 'usr-admin',
      actorName: al.actor,
      action: al.action,
      targetType: al.target,
      targetId: null,
      targetName: null,
      ip: al.ip ?? null,
      userAgent: null,
      metadata: json({}),
    })),
  });

  console.log('· segmentos e templates');
  await prisma.segment.createMany({
    data: SEGMENTS.map((s) => ({
      id: s.id,
      accountId: s.accountId,
      name: s.name,
      description: s.description ?? null,
      filters: json([]),
      contactCount: s.contactCount,
    })),
  });

  await prisma.messageTemplate.createMany({
    data: TEMPLATES.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      name: t.name,
      category: 'MARKETING',
      language: 'pt_BR',
      body: t.body,
      status: t.approval === 'aprovado' ? 'approved' : 'pending',
      buttons: json([]),
      variables: json(t.variables),
    })),
  });

  console.log('· campanhas');
  await prisma.campaign.createMany({
    data: CAMPAIGNS.map((c) => ({
      id: c.id,
      accountId: c.accountId,
      inboxId: 'ibx-wa-oficial',
      name: c.name,
      channel: 'whatsapp',
      status: c.status === 'em_andamento' ? 'running' : c.status === 'concluida' ? 'completed' : c.status === 'agendada' ? 'scheduled' : c.status === 'pausada' ? 'paused' : 'draft',
      stats: json(c.metrics),
    })),
  });

  console.log('· configurações gerais');
  await prisma.accountSettings.create({
    data: {
      accountId: ACCOUNT_ID,
      assignmentMethod: SETTINGS.assignmentMethod,
      billing: json(SETTINGS.billing),
      activeSessions: json(SETTINGS.activeSessions),
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
