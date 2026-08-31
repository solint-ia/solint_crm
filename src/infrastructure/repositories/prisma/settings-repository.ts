import crypto from 'node:crypto';

import type { Automation } from '@/core/domain/automation';
import type { KnowledgeArticle, KnowledgeCategory } from '@/core/domain/knowledge';
import { slugify } from '@/core/domain/knowledge';
import type {
  ActiveSession,
  ApiToken,
  AssignmentMethod,
  AuditLogEntry,
  BillingInfo,
  CannedResponse,
  ChannelConnection,
  CompanyProfile,
  CustomAttributeDefinition,
  Macro,
  Team,
  Webhook,
} from '@/core/domain/settings';
import { ConflictError, NotFoundError, type Id } from '@/core/domain/shared';
import { SYSTEM_ROLES, systemRoleId } from '@/core/domain/system-roles';
import type { Role as PrismaRole } from '@/generated/prisma';
import type { Permission, Role } from '@/core/domain/user';
import { defaultBusinessHours } from '@/core/domain/business-hours';
import type {
  ArticleDraft,
  AutomationDraft,
  InboxDeletionImpact,
  InboxDraft,
  InboxSettingsPatch,
  LabelDraft,
  SettingsRepository,
  WorkspaceSettings,
} from '@/core/ports/settings-repository';
import type { Label } from '@/core/domain/label';
import { prisma, readJson, asJson } from '@/infrastructure/db/prisma';
import { APP_TIMEZONE } from '@/lib/datetime';
import {
  articleRow,
  automationRow,
  categoryRow,
  connectionRow,
  labelRow,
  userRow,
} from './mappers';

const nowLabel = (): string =>
  new Date().toLocaleDateString('pt-BR', { timeZone: APP_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' });

const EMPTY_BILLING: BillingInfo = {
  planName: '—',
  priceLabel: '—',
  renewalLabel: '—',
  usage: [],
  invoices: [],
};

/**
 * Garante que a conta tem os papéis de sistema, criando o que faltar.
 *
 * Contas criadas antes de o papel de agente existir só têm "administrador" —
 * e sem este remendo o gestor abriria a tela de equipe e continuaria com uma
 * opção só, para sempre. Uma migração de dados resolveria as de hoje e não as
 * de amanhã; aqui a conta se completa sozinha na primeira vez que alguém abre
 * as configurações.
 *
 * Não escreve nada quando não falta nada, que é o caso normal: a comparação é
 * feita sobre os papéis que a consulta já trouxe, sem ida extra ao banco.
 * `skipDuplicates` cobre duas abas abrindo a tela ao mesmo tempo.
 */
const ensureSystemRoles = async (
  accountId: Id,
  existentes: readonly PrismaRole[],
): Promise<readonly PrismaRole[]> => {
  const conhecidos = new Set(existentes.map((role) => role.slug));
  const faltando = SYSTEM_ROLES.filter((role) => !conhecidos.has(role.slug));
  if (faltando.length === 0) return existentes;

  await prisma.role.createMany({
    data: faltando.map((role) => ({
      id: systemRoleId(accountId, role.slug),
      accountId,
      slug: role.slug,
      name: role.name,
      description: role.description,
      permissions: asJson(role.permissions),
      isSystem: true,
    })),
    skipDuplicates: true,
  });

  return prisma.role.findMany({ where: { accountId } });
};

export class PrismaSettingsRepository implements SettingsRepository {
  /**
   * Uma leitura só monta a tela inteira de Configurações.
   *
   * São consultas paralelas em vez de sequenciais porque nenhuma depende do
   * resultado da outra — encadeá-las multiplicaria a latência por sete sem
   * ganho nenhum.
   */
  async get(accountId: Id): Promise<WorkspaceSettings> {
    const [
      automations,
      connections,
      members,
      roles,
      labels,
      categories,
      articles,
      settings,
      teams,
      webhooks,
      apiTokens,
      customAttributes,
      cannedResponses,
      macros,
      auditLog,
    ] = await Promise.all([
      prisma.automation.findMany({ where: { accountId }, orderBy: { order: 'asc' } }),
      prisma.inbox.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.membership.findMany({
        where: { accountId },
        // As equipes vêm junto: são desta conta (o `where` do `Team` garante) e
        // buscá-las depois custaria uma ida ao banco por pessoa na tela.
        include: { user: { include: { teamMemberships: { include: { team: true } } } } },
        orderBy: { user: { name: 'asc' } },
      }),
      prisma.role.findMany({ where: { accountId } }),
      prisma.label.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.knowledgeCategory.findMany({ where: { accountId }, orderBy: { order: 'asc' } }),
      prisma.knowledgeArticle.findMany({ where: { accountId }, orderBy: { title: 'asc' } }),
      prisma.accountSettings.findUnique({ where: { accountId } }),
      prisma.team.findMany({
        where: { accountId },
        include: { teamMembers: true, teamInboxes: true },
        orderBy: { name: 'asc' },
      }),
      prisma.webhook.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.apiToken.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } }),
      prisma.customAttributeDefinition.findMany({
        where: { accountId },
        orderBy: { order: 'asc' },
      }),
      prisma.cannedResponse.findMany({ where: { accountId }, orderBy: { shortcut: 'asc' } }),
      prisma.macro.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.auditLogEntry.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const papeis = await ensureSystemRoles(accountId, roles);

    return {
      automations: automations.map(automationRow),
      connections: connections.map(connectionRow),
      members: members.map((row) =>
        userRow(
          row.user,
          row,
          // Só as equipes desta conta: a mesma pessoa pode atender em outra
          // empresa, e o nome da equipe de lá não tem o que fazer aqui.
          row.user.teamMemberships
            .filter((link) => link.team.accountId === accountId)
            .map((link) => link.team.name),
        ),
      ),
      roles: papeis.map((row): Role => ({
        id: row.id,
        accountId: row.accountId,
        slug: row.slug,
        name: row.name,
        description: row.description,
        permissions: readJson<readonly Permission[]>(row.permissions, []),
        isSystem: row.isSystem,
      })),
      labels: labels.map(labelRow),
      knowledge: {
        categories: categories.map(categoryRow),
        articles: articles.map(articleRow),
      },
      assignmentMethod: (settings?.assignmentMethod ?? 'round_robin') as AssignmentMethod,
      macros: macros.map((m): Macro => ({
        id: m.id,
        name: m.name,
        steps: m.description ?? 'Ações automáticas configuradas',
      })),
      cannedResponses: cannedResponses.map((cr): CannedResponse => ({
        id: cr.id,
        shortcut: cr.shortcut,
        content: cr.content,
      })),
      webhooks: webhooks.map((w): Webhook => ({
        id: w.id,
        url: w.url,
        events: readJson<readonly string[]>(w.events, []),
        enabled: w.isActive,
      })),
      apiTokens: apiTokens.map((tk): ApiToken => ({
        id: tk.id,
        name: tk.name,
        maskedValue: `${tk.tokenPrefix}****${tk.id.slice(-4)}`,
        createdLabel: tk.createdAt.toLocaleDateString('pt-BR', {
          timeZone: APP_TIMEZONE,
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        lastUsedLabel: tk.lastUsedAt ? 'Ativo recentemente' : 'Nunca usado',
      })),
      teams: teams.map((t): Team => ({
        id: t.id,
        name: t.name,
        color: t.color,
        memberCount: t.teamMembers.length,
        inboxIds: t.teamInboxes.map((link) => link.inboxId),
        memberIds: t.teamMembers.map((link) => link.userId),
        businessHours: 'Seg a Sex, 08h às 18h',
      })),
      customAttributes: customAttributes.map((ca): CustomAttributeDefinition => ({
        id: ca.id,
        name: ca.name,
        key: ca.key,
        type:
          ca.type === 'select'
            ? 'lista'
            : ca.type === 'number'
              ? 'numero'
              : ca.type === 'date'
                ? 'data'
                : ca.type === 'boolean'
                  ? 'booleano'
                  : 'texto',
        appliesTo: ca.target === 'deal' ? 'conversa' : 'contato',
      })),
      billing: readJson<BillingInfo>(settings?.billing, EMPTY_BILLING),
      auditLog: auditLog.map((al): AuditLogEntry => ({
        id: al.id,
        actor: al.actorName,
        action: al.action,
        target: al.targetType,
        ip: al.ip ?? '—',
        at: al.createdAt.toLocaleDateString('pt-BR', { timeZone: APP_TIMEZONE, day: '2-digit', month: 'short' }),
      })),
      activeSessions: readJson<readonly ActiveSession[]>(settings?.activeSessions, []),
      company: readJson<CompanyProfile>(settings?.company, {}),
    };
  }

  async saveCompanyProfile(
    accountId: Id,
    draft: CompanyProfile & { tradeName: string; document?: string },
  ): Promise<CompanyProfile> {
    const { tradeName, document, ...profile } = draft;

    // Nome e documento são colunas de `Account` porque são consultados; o resto
    // é o agregado da tela. Uma transação para os dois não divergirem.
    await prisma.$transaction([
      prisma.account.update({
        where: { id: accountId },
        data: { name: tradeName, document: document ?? null },
      }),
      prisma.accountSettings.update({
        where: { accountId },
        data: { company: asJson(profile) },
      }),
    ]);

    return profile;
  }

  async setAutomationEnabled(
    accountId: Id,
    automationId: Id,
    enabled: boolean,
  ): Promise<Automation> {
    await this.assertAutomation(accountId, automationId);
    return automationRow(
      await prisma.automation.update({ where: { id: automationId, accountId }, data: { enabled } }),
    );
  }

  async setAssignmentMethod(accountId: Id, method: AssignmentMethod): Promise<AssignmentMethod> {
    await prisma.accountSettings.update({
      where: { accountId },
      data: { assignmentMethod: method },
    });
    return method;
  }

  async saveAutomation(accountId: Id, draft: AutomationDraft): Promise<Automation> {
    if (draft.id) {
      await this.assertAutomation(accountId, draft.id);
      return automationRow(
        await prisma.automation.update({
          where: { id: draft.id, accountId },
          data: {
            name: draft.name,
            trigger: draft.trigger,
            conditions: asJson(draft.conditions),
            conditionLogic: draft.conditionLogic,
            actions: asJson(draft.actions),
            enabled: draft.enabled,
          },
        }),
      );
    }

    const last = await prisma.automation.findFirst({
      where: { accountId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return automationRow(
      await prisma.automation.create({
        data: {
          id: `au-${Date.now().toString(36)}`,
          accountId,
          name: draft.name,
          trigger: draft.trigger,
          conditions: asJson(draft.conditions),
          conditionLogic: draft.conditionLogic,
          actions: asJson(draft.actions),
          enabled: draft.enabled,
          order: (last?.order ?? 0) + 1,
        },
      }),
    );
  }

  async deleteAutomation(accountId: Id, automationId: Id): Promise<void> {
    await this.assertAutomation(accountId, automationId);
    await prisma.automation.delete({ where: { id: automationId, accountId } });
  }

  /**
   * Troca a posição com o vizinho e reescreve toda a ordem.
   *
   * Reescrever tudo em vez de trocar dois números evita buracos e empates
   * herdados de exclusões anteriores — e a ordem é o que decide quem vence um
   * conflito de sobrescrita, então empate ali não é detalhe.
   */
  async moveAutomation(
    accountId: Id,
    automationId: Id,
    direction: 'cima' | 'baixo',
  ): Promise<void> {
    const ordered = await prisma.automation.findMany({
      where: { accountId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });

    const index = ordered.findIndex((item) => item.id === automationId);
    if (index < 0) throw new NotFoundError('Automação', automationId);

    const target = direction === 'cima' ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;

    const a = ordered[index];
    const b = ordered[target];
    if (!a || !b) return;
    ordered[index] = b;
    ordered[target] = a;

    await prisma.$transaction(
      ordered.map((item, position) =>
        prisma.automation.update({
          where: { id: item.id, accountId },
          data: { order: position + 1 },
        }),
      ),
    );
  }

  async createInbox(accountId: Id, draft: InboxDraft): Promise<ChannelConnection> {
    const channel = draft.channel ?? 'whatsapp';
    const provider = draft.provider ?? (channel === 'whatsapp' ? 'baileys' : 'custom');
    const id = `ibx-${crypto.randomUUID()}`;

    const created = await prisma.$transaction(async (tx) => {
      const inbox = await tx.inbox.create({
        data: {
          id,
          accountId,
          name: draft.name.trim(),
          channel,
          identifier: channel === 'whatsapp' ? `whatsapp-${id.slice(-6)}` : id,
          status: 'desconectado',
          provider,
          businessHours: asJson(defaultBusinessHours()),
          awayMessage: asJson({ enabled: false, text: '' }),
          greeting: asJson({ enabled: false, text: '' }),
          closingMessage: asJson(draft.closingMessage ?? { enabled: false, text: '' }),
          waitingMessage: asJson(draft.waitingMessage ?? { enabled: false, text: '' }),
        },
      });

      if (channel === 'whatsapp') {
        await tx.whatsAppConnection.create({
          data: {
            inboxId: id,
            status: 'desconectado',
          },
        });
      }

      return inbox;
    });

    return connectionRow(created);
  }

  async updateInbox(
    accountId: Id,
    connectionId: Id,
    patch: InboxSettingsPatch,
  ): Promise<ChannelConnection> {
    const exists = await prisma.inbox.findFirst({
      where: { id: connectionId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Caixa de entrada', connectionId);

    return connectionRow(
      await prisma.inbox.update({
        where: { id: connectionId, accountId },
        data: {
          ...(patch.businessHours ? { businessHours: asJson(patch.businessHours) } : {}),
          ...(patch.awayMessage ? { awayMessage: asJson(patch.awayMessage) } : {}),
          ...(patch.greeting ? { greeting: asJson(patch.greeting) } : {}),
          ...(patch.closingMessage ? { closingMessage: asJson(patch.closingMessage) } : {}),
          ...(patch.waitingMessage ? { waitingMessage: asJson(patch.waitingMessage) } : {}),
          ...(patch.waitingMessageDelayMinutes === undefined
            ? {}
            : { waitingMessageDelayMinutes: patch.waitingMessageDelayMinutes }),
          ...(patch.csatEnabled === undefined ? {} : { csatEnabled: patch.csatEnabled }),
          ...(patch.csatQuestion === undefined
            ? {}
            : { csatQuestion: patch.csatQuestion || null }),
          ...(patch.webhookUrl === undefined ? {} : { webhookUrl: patch.webhookUrl || null }),
        },
      }),
    );
  }

  async inboxDeletionImpact(accountId: Id, connectionId: Id): Promise<InboxDeletionImpact> {
    const inbox = await prisma.inbox.findFirst({
      where: { id: connectionId, accountId },
      select: { id: true },
    });
    if (!inbox) throw new NotFoundError('Caixa de entrada', connectionId);

    const [conversations, messages, campaigns] = await Promise.all([
      prisma.conversation.count({ where: { accountId, inboxId: connectionId } }),
      prisma.message.count({ where: { conversation: { accountId, inboxId: connectionId } } }),
      prisma.campaign.count({ where: { accountId, inboxId: connectionId } }),
    ]);

    return { conversations, messages, campaigns };
  }

  /**
   * Exclui a caixa e tudo que dependia dela.
   *
   * O banco recusa apagar uma caixa que ainda tenha conversa ou campanha
   * (`onDelete: Restrict` nas duas), e isso é proposital: essas linhas são
   * histórico de atendimento, não sobra. Então elas são apagadas aqui, de
   * forma explícita, dentro da mesma transação — nunca por efeito colateral de
   * um cascade que ninguém leu.
   *
   * O que **não** é apagado: os contatos. Eles são da conta, não da caixa, e
   * costumam aparecer em negócios, campanhas e outras conversas.
   */
  async deleteInbox(accountId: Id, connectionId: Id, confirmName: string): Promise<void> {
    const inbox = await prisma.inbox.findFirst({
      where: { id: connectionId, accountId },
      select: { id: true, name: true, channel: true },
    });
    if (!inbox) throw new NotFoundError('Caixa de entrada', connectionId);

    if (confirmName.trim() !== inbox.name.trim()) {
      throw new Error('O nome digitado não confere com o nome da caixa de entrada.');
    }

    if (inbox.channel === 'whatsapp') {
      // Comandos pendentes desta caixa perderam o sentido — inclusive envios
      // para conversas que estão prestes a deixar de existir. Só o
      // `disconnect` fica, e ele é enfileirado depois da limpeza justamente
      // para não ser varrido junto.
      await prisma.whatsAppCommand.deleteMany({ where: { inboxId: connectionId } });

      // A sessão vive no worker, noutro processo: derrubá-la é um pedido, não
      // uma chamada. A linha da conexão (e as credenciais dentro dela) sai por
      // cascade junto com a caixa; o comando existe para o socket não ficar de
      // pé até o próximo reinício do worker.
      await prisma.whatsAppCommand.create({
        data: { inboxId: connectionId, kind: 'disconnect', payload: {}, status: 'pending' },
      });
    }

    // `Deal.conversationId` é um id solto, sem chave estrangeira — apagar a
    // conversa deixaria o card do funil apontando para o nada, e o link "abrir
    // conversa" levaria a um 404.
    const conversationIds = (
      await prisma.conversation.findMany({
        where: { accountId, inboxId: connectionId },
        select: { id: true },
      })
    ).map((row) => row.id);

    await prisma.$transaction([
      ...(conversationIds.length > 0
        ? [
            prisma.deal.updateMany({
              where: { accountId, conversationId: { in: conversationIds } },
              data: { conversationId: null },
            }),
          ]
        : []),
      // As mensagens saem por cascade a partir da conversa, e os destinatários
      // a partir da campanha.
      prisma.campaign.deleteMany({ where: { accountId, inboxId: connectionId } }),
      prisma.conversation.deleteMany({ where: { accountId, inboxId: connectionId } }),
      prisma.inbox.delete({ where: { id: connectionId, accountId } }),
    ]);
  }

  async saveArticle(accountId: Id, draft: ArticleDraft): Promise<KnowledgeArticle> {
    const category = await prisma.knowledgeCategory.findFirst({
      where: { id: draft.categoryId, accountId },
      select: { id: true },
    });
    if (!category) throw new NotFoundError('Categoria', draft.categoryId);

    const shared = {
      categoryId: draft.categoryId,
      title: draft.title,
      slug: slugify(draft.title),
      excerpt: draft.excerpt,
      content: draft.content,
      status: draft.status,
      tags: asJson(draft.tags),
      updatedLabel: nowLabel(),
    };

    if (draft.id) {
      const exists = await prisma.knowledgeArticle.findFirst({
        where: { id: draft.id, accountId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Artigo', draft.id);

      return articleRow(
        await prisma.knowledgeArticle.update({
          where: { id: draft.id, accountId },
          data: shared,
        }),
      );
    }

    return articleRow(
      await prisma.knowledgeArticle.create({
        data: {
          ...shared,
          id: `ka-${Date.now().toString(36)}`,
          accountId,
          authorName: 'Você',
        },
      }),
    );
  }

  async deleteArticle(accountId: Id, articleId: Id): Promise<void> {
    const exists = await prisma.knowledgeArticle.findFirst({
      where: { id: articleId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Artigo', articleId);
    await prisma.knowledgeArticle.delete({ where: { id: articleId, accountId } });
  }

  async saveCategory(
    accountId: Id,
    name: string,
    description: string,
    id?: Id,
  ): Promise<KnowledgeCategory> {
    if (id) {
      const exists = await prisma.knowledgeCategory.findFirst({
        where: { id, accountId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Categoria', id);
      return categoryRow(
        await prisma.knowledgeCategory.update({
          where: { id, accountId },
          data: { name, description },
        }),
      );
    }

    const last = await prisma.knowledgeCategory.findFirst({
      where: { accountId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    return categoryRow(
      await prisma.knowledgeCategory.create({
        data: {
          id: `kc-${Date.now().toString(36)}`,
          accountId,
          name,
          description,
          order: (last?.order ?? 0) + 1,
        },
      }),
    );
  }

  /** Categoria com artigos não some sem aviso: apagar arrastaria conteúdo junto. */
  async deleteCategory(accountId: Id, categoryId: Id): Promise<void> {
    const category = await prisma.knowledgeCategory.findFirst({
      where: { id: categoryId, accountId },
      include: { _count: { select: { articles: true } } },
    });
    if (!category) throw new NotFoundError('Categoria', categoryId);

    const used = category._count.articles;
    if (used > 0) {
      throw new ConflictError(
        `A categoria "${category.name}" ainda tem ${used} ${
          used === 1 ? 'artigo' : 'artigos'
        }. Mova ou apague o conteúdo antes de excluir.`,
      );
    }

    await prisma.knowledgeCategory.delete({ where: { id: categoryId, accountId } });
  }

  // --- Onda 3: Webhooks ---
  async createWebhook(
    accountId: Id,
    draft: { name: string; url: string; events: readonly string[]; secret?: string },
  ): Promise<Webhook> {
    const row = await prisma.webhook.create({
      data: {
        accountId,
        name: draft.name,
        url: draft.url,
        events: asJson(draft.events),
        // Sem segredo a entrega sai sem assinatura, e quem recebe nao tem como
        // provar que o evento veio daqui. O campo e opcional porque um endpoint
        // interno de rede fechada pode dispensar; exposto na internet, nao.
        ...(draft.secret ? { secret: draft.secret } : {}),
        isActive: true,
      },
    });
    return {
      id: row.id,
      url: row.url,
      events: readJson<readonly string[]>(row.events, []),
      enabled: row.isActive,
    };
  }

  async toggleWebhook(accountId: Id, webhookId: Id, enabled: boolean): Promise<Webhook> {
    const exists = await prisma.webhook.findFirst({
      where: { id: webhookId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Webhook', webhookId);

    const row = await prisma.webhook.update({
      where: { id: webhookId, accountId },
      data: { isActive: enabled },
    });
    return {
      id: row.id,
      url: row.url,
      events: readJson<readonly string[]>(row.events, []),
      enabled: row.isActive,
    };
  }

  async deleteWebhook(accountId: Id, webhookId: Id): Promise<void> {
    const exists = await prisma.webhook.findFirst({
      where: { id: webhookId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Webhook', webhookId);
    await prisma.webhook.delete({ where: { id: webhookId, accountId } });
  }

  // --- Onda 3: Tokens de API ---
  async createApiToken(
    accountId: Id,
    draft: { name: string; permissions?: readonly string[] },
  ): Promise<{ token: ApiToken; rawSecret: string }> {
    const rawEntropy = crypto.randomBytes(24).toString('base64url');
    const rawSecret = `sk_live_${rawEntropy}`;
    const tokenHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const row = await prisma.apiToken.create({
      data: {
        accountId,
        name: draft.name,
        tokenHash,
        tokenPrefix: 'sk_live_',
        permissions: asJson(draft.permissions ?? ['*']),
      },
    });

    const token: ApiToken = {
      id: row.id,
      name: row.name,
      maskedValue: `sk_live_****${rawSecret.slice(-4)}`,
      createdLabel: row.createdAt.toLocaleDateString('pt-BR', {
        timeZone: APP_TIMEZONE,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      lastUsedLabel: 'Nunca usado',
    };

    return { token, rawSecret };
  }

  async deleteApiToken(accountId: Id, tokenId: Id): Promise<void> {
    const exists = await prisma.apiToken.findFirst({
      where: { id: tokenId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Token de API', tokenId);
    await prisma.apiToken.delete({ where: { id: tokenId, accountId } });
  }

  // --- Onda 3: Respostas Rápidas ---
  async createCannedResponse(
    accountId: Id,
    draft: { shortcut: string; content: string },
  ): Promise<CannedResponse> {
    const shortcut = draft.shortcut.startsWith('/') ? draft.shortcut : `/${draft.shortcut}`;
    const row = await prisma.cannedResponse.upsert({
      where: { accountId_shortcut: { accountId, shortcut } },
      create: {
        accountId,
        shortcut,
        content: draft.content,
        category: 'Geral',
      },
      update: {
        content: draft.content,
      },
    });
    return {
      id: row.id,
      shortcut: row.shortcut,
      content: row.content,
    };
  }

  async updateCannedResponse(
    accountId: Id,
    responseId: Id,
    draft: { shortcut: string; content: string },
  ): Promise<CannedResponse> {
    const exists = await prisma.cannedResponse.findFirst({
      where: { id: responseId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Resposta rápida', responseId);

    const shortcut = draft.shortcut.startsWith('/') ? draft.shortcut : `/${draft.shortcut}`;

    // O atalho é único por conta. Renomear para um já ocupado por outra
    // resposta é conflito de verdade — e a mensagem precisa dizer isso, não
    // deixar o erro cru do Prisma chegar à tela.
    const conflito = await prisma.cannedResponse.findFirst({
      where: { accountId, shortcut, id: { not: responseId } },
      select: { id: true },
    });
    if (conflito) {
      throw new ConflictError(`Já existe uma resposta rápida com o atalho ${shortcut}.`);
    }

    const row = await prisma.cannedResponse.update({
      where: { id: responseId, accountId },
      data: { shortcut, content: draft.content },
    });
    return { id: row.id, shortcut: row.shortcut, content: row.content };
  }

  async deleteCannedResponse(accountId: Id, responseId: Id): Promise<void> {
    const exists = await prisma.cannedResponse.findFirst({
      where: { id: responseId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Resposta rápida', responseId);
    await prisma.cannedResponse.delete({ where: { id: responseId, accountId } });
  }

  // --- Onda 3: Atributos Customizados ---
  async createCustomAttribute(
    accountId: Id,
    draft: {
      name: string;
      key: string;
      type: 'texto' | 'numero' | 'data' | 'lista' | 'booleano';
      appliesTo: 'contato' | 'conversa';
      options?: readonly string[];
    },
  ): Promise<CustomAttributeDefinition> {
    const dbTarget = draft.appliesTo === 'conversa' ? 'deal' : 'contact';
    const dbType =
      draft.type === 'lista'
        ? 'select'
        : draft.type === 'numero'
          ? 'number'
          : draft.type === 'data'
            ? 'date'
            : draft.type === 'booleano'
              ? 'boolean'
              : 'text';

    const row = await prisma.customAttributeDefinition.upsert({
      where: { accountId_target_key: { accountId, target: dbTarget, key: draft.key } },
      create: {
        accountId,
        target: dbTarget,
        name: draft.name,
        key: draft.key,
        type: dbType,
        options: asJson(draft.options ?? []),
      },
      update: {
        name: draft.name,
        type: dbType,
        options: asJson(draft.options ?? []),
      },
    });

    return {
      id: row.id,
      name: row.name,
      key: row.key,
      type: draft.type,
      appliesTo: draft.appliesTo,
    };
  }

  async deleteCustomAttribute(accountId: Id, attributeId: Id): Promise<void> {
    const exists = await prisma.customAttributeDefinition.findFirst({
      where: { id: attributeId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Atributo customizado', attributeId);
    await prisma.customAttributeDefinition.delete({ where: { id: attributeId, accountId } });
  }

  // --- Onda 3: Equipes ---
  async createTeam(
    accountId: Id,
    draft: {
      name: string;
      color?: string;
      memberIds?: readonly string[];
      inboxIds?: readonly string[];
    },
  ): Promise<Team> {
    return this.saveTeam(accountId, draft);
  }

  async updateTeam(
    accountId: Id,
    teamId: Id,
    draft: {
      name: string;
      color?: string;
      memberIds?: readonly string[];
      inboxIds?: readonly string[];
    },
  ): Promise<Team> {
    return this.saveTeam(accountId, draft, teamId);
  }

  /**
   * Cria ou atualiza a equipe junto com seus vínculos, numa transação.
   *
   * Os ids recebidos **não são confiáveis** — vêm de um formulário. Antes de
   * gravar, cada um é conferido contra a própria conta: um id de caixa de outro
   * inquilino gravado aqui viraria acesso a conversas de outra empresa, que é
   * exatamente o risco que esta tabela existe para controlar.
   *
   * Vínculos são substituídos por inteiro (apaga e regrava) em vez de
   * reconciliados um a um: são poucas linhas, e "o que está na tela é o que
   * fica" é mais fácil de garantir do que um diff.
   */
  private async saveTeam(
    accountId: Id,
    draft: {
      name: string;
      color?: string;
      memberIds?: readonly string[];
      inboxIds?: readonly string[];
    },
    teamId?: Id,
  ): Promise<Team> {
    const [inboxesDaConta, membrosDaConta] = await Promise.all([
      prisma.inbox.findMany({ where: { accountId }, select: { id: true } }),
      prisma.membership.findMany({ where: { accountId }, select: { userId: true } }),
    ]);

    const inboxIds = (draft.inboxIds ?? []).filter((id) =>
      inboxesDaConta.some((inbox) => inbox.id === id),
    );
    const memberIds = (draft.memberIds ?? []).filter((id) =>
      membrosDaConta.some((member) => member.userId === id),
    );

    const row = await prisma.$transaction(async (tx) => {
      if (teamId) {
        const exists = await tx.team.findFirst({
          where: { id: teamId, accountId },
          select: { id: true },
        });
        if (!exists) throw new NotFoundError('Equipe', teamId);

        await tx.team.update({
          where: { id: teamId, accountId },
          data: { name: draft.name, ...(draft.color ? { color: draft.color } : {}) },
        });
        await tx.teamInbox.deleteMany({ where: { teamId } });
        await tx.teamMember.deleteMany({ where: { teamId } });
      }

      const team = teamId
        ? { id: teamId, name: draft.name, color: draft.color ?? '#3B82F6' }
        : await tx.team.create({
            data: { accountId, name: draft.name, color: draft.color ?? '#3B82F6' },
          });

      if (inboxIds.length > 0) {
        await tx.teamInbox.createMany({
          data: inboxIds.map((inboxId) => ({ teamId: team.id, inboxId })),
          skipDuplicates: true,
        });
      }
      if (memberIds.length > 0) {
        await tx.teamMember.createMany({
          data: memberIds.map((userId) => ({ teamId: team.id, userId })),
          skipDuplicates: true,
        });
      }

      return team;
    });

    return {
      id: row.id,
      name: row.name,
      color: row.color,
      memberCount: memberIds.length,
      inboxIds,
      memberIds,
      businessHours: 'Seg a Sex, 08h às 18h',
    };
  }

  async deleteTeam(accountId: Id, teamId: Id): Promise<void> {
    const exists = await prisma.team.findFirst({
      where: { id: teamId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Equipe', teamId);
    await prisma.team.delete({ where: { id: teamId, accountId } });
  }

  // --- Sessões ativas ---

  /**
   * Lê a lista corrente e grava a que o filtro deixou.
   *
   * `activeSessions` é uma coluna JSON lida e gravada inteira, então as duas
   * operações compartilham este caminho — o que muda entre elas é só o critério.
   */
  private async writeSessions(
    accountId: Id,
    manter: (session: ActiveSession) => boolean,
  ): Promise<readonly ActiveSession[]> {
    const settings = await prisma.accountSettings.findUnique({ where: { accountId } });
    const atuais = readJson<readonly ActiveSession[]>(settings?.activeSessions, []);
    const restantes = atuais.filter(manter);

    await prisma.accountSettings.update({
      where: { accountId },
      data: { activeSessions: asJson(restantes) },
    });

    return restantes;
  }

  async terminateSession(accountId: Id, sessionId: Id): Promise<readonly ActiveSession[]> {
    return this.writeSessions(accountId, (s) => s.id !== sessionId || s.current);
  }

  async terminateOtherSessions(accountId: Id): Promise<readonly ActiveSession[]> {
    return this.writeSessions(accountId, (s) => s.current);
  }

  // --- Etiquetas ---
  //
  // O catálogo era o único conjunto lido da tabela e nunca escrito: a tela
  // criava a etiqueta em estado do React, mostrava o aviso de sucesso e perdia
  // tudo no primeiro recarregamento.

  async createLabel(accountId: Id, draft: LabelDraft): Promise<Label> {
    // `Label.id` não tem `@default` no schema, então o id sai daqui — no mesmo
    // formato que as demais tabelas de id explícito deste projeto.
    const id = `lbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const row = await prisma.label.create({
      data: {
        id,
        accountId,
        name: draft.name,
        tone: draft.tone,
        description: draft.description ?? null,
      },
    });
    return labelRow(row);
  }

  async updateLabel(accountId: Id, labelId: Id, draft: LabelDraft): Promise<Label> {
    await this.assertLabel(accountId, labelId);
    const row = await prisma.label.update({
      where: { id: labelId, accountId },
      data: {
        name: draft.name,
        tone: draft.tone,
        description: draft.description ?? null,
      },
    });
    return labelRow(row);
  }

  async deleteLabel(accountId: Id, labelId: Id): Promise<void> {
    await this.assertLabel(accountId, labelId);
    await prisma.label.delete({ where: { id: labelId, accountId } });
  }

  private async assertLabel(accountId: Id, labelId: Id) {
    const row = await prisma.label.findFirst({
      where: { id: labelId, accountId },
      select: { id: true },
    });
    if (!row) throw new NotFoundError('Etiqueta', labelId);
    return row;
  }

  private async assertAutomation(accountId: Id, automationId: Id) {
    const row = await prisma.automation.findFirst({
      where: { id: automationId, accountId },
      select: { id: true },
    });
    if (!row) throw new NotFoundError('Automação', automationId);
    return row;
  }
}
