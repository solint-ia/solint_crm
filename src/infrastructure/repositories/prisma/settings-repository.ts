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
  CustomAttributeDefinition,
  Macro,
  Team,
  Webhook,
} from '@/core/domain/settings';
import { ConflictError, NotFoundError, type Id } from '@/core/domain/shared';
import type { Permission, Role } from '@/core/domain/user';
import type {
  ArticleDraft,
  AutomationDraft,
  InboxSettingsPatch,
  SettingsRepository,
  WorkspaceSettings,
} from '@/core/ports/settings-repository';
import { prisma, readJson, asJson } from '@/infrastructure/db/prisma';
import {
  articleRow,
  automationRow,
  categoryRow,
  connectionRow,
  labelRow,
  userRow,
} from './mappers';

const nowLabel = (): string =>
  new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

const EMPTY_BILLING: BillingInfo = {
  planName: '—',
  priceLabel: '—',
  renewalLabel: '—',
  usage: [],
  invoices: [],
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
        include: { user: true },
        orderBy: { user: { name: 'asc' } },
      }),
      prisma.role.findMany({ where: { accountId } }),
      prisma.label.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.knowledgeCategory.findMany({ where: { accountId }, orderBy: { order: 'asc' } }),
      prisma.knowledgeArticle.findMany({ where: { accountId }, orderBy: { title: 'asc' } }),
      prisma.accountSettings.findUnique({ where: { accountId } }),
      prisma.team.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.webhook.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.apiToken.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } }),
      prisma.customAttributeDefinition.findMany({ where: { accountId }, orderBy: { order: 'asc' } }),
      prisma.cannedResponse.findMany({ where: { accountId }, orderBy: { shortcut: 'asc' } }),
      prisma.macro.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.auditLogEntry.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    return {
      automations: automations.map(automationRow),
      connections: connections.map(connectionRow),
      members: members.map((row) => userRow(row.user, row)),
      roles: roles.map((row): Role => ({
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
        createdLabel: tk.createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }),
        lastUsedLabel: tk.lastUsedAt ? 'Ativo recentemente' : 'Nunca usado',
      })),
      teams: teams.map((t): Team => ({
        id: t.id,
        name: t.name,
        memberCount: readJson<string[]>(t.members, []).length,
        inboxes: readJson<string[]>(t.inboxIds, []),
        businessHours: 'Seg a Sex, 08h às 18h',
      })),
      customAttributes: customAttributes.map((ca): CustomAttributeDefinition => ({
        id: ca.id,
        name: ca.name,
        key: ca.key,
        type: ca.type === 'select' ? 'lista' : ca.type === 'number' ? 'numero' : ca.type === 'date' ? 'data' : ca.type === 'boolean' ? 'booleano' : 'texto',
        appliesTo: ca.target === 'deal' ? 'conversa' : 'contato',
      })),
      billing: readJson<BillingInfo>(settings?.billing, EMPTY_BILLING),
      auditLog: auditLog.map((al): AuditLogEntry => ({
        id: al.id,
        actor: al.actorName,
        action: al.action,
        target: al.targetType,
        ip: al.ip ?? '—',
        at: al.createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
      })),
      activeSessions: readJson<readonly ActiveSession[]>(settings?.activeSessions, []),
    };
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
          ...(patch.webhookUrl === undefined ? {} : { webhookUrl: patch.webhookUrl || null }),
        },
      }),
    );
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
    draft: { name: string; url: string; events: readonly string[] },
  ): Promise<Webhook> {
    const row = await prisma.webhook.create({
      data: {
        accountId,
        name: draft.name,
        url: draft.url,
        events: asJson(draft.events),
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
      createdLabel: row.createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }),
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
    const dbType = draft.type === 'lista' ? 'select' : draft.type === 'numero' ? 'number' : draft.type === 'data' ? 'date' : draft.type === 'booleano' ? 'boolean' : 'text';

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
      members?: readonly string[];
      inboxes?: readonly string[];
    },
  ): Promise<Team> {
    const row = await prisma.team.create({
      data: {
        accountId,
        name: draft.name,
        color: draft.color ?? '#3B82F6',
        members: asJson(draft.members ?? []),
        inboxIds: asJson(draft.inboxes ?? []),
      },
    });
    return {
      id: row.id,
      name: row.name,
      memberCount: (draft.members ?? []).length,
      inboxes: draft.inboxes ?? [],
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

  private async assertAutomation(accountId: Id, automationId: Id) {
    const row = await prisma.automation.findFirst({
      where: { id: automationId, accountId },
      select: { id: true },
    });
    if (!row) throw new NotFoundError('Automação', automationId);
    return row;
  }
}
