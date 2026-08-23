import 'server-only';

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
import { prisma, fromJson, toJson } from '@/infrastructure/db/prisma';
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
    ] = await Promise.all([
      prisma.automation.findMany({ where: { accountId }, orderBy: { order: 'asc' } }),
      prisma.channelConnection.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.role.findMany({ where: { accountId } }),
      prisma.label.findMany({ where: { accountId }, orderBy: { name: 'asc' } }),
      prisma.knowledgeCategory.findMany({ where: { accountId }, orderBy: { order: 'asc' } }),
      prisma.knowledgeArticle.findMany({ where: { accountId }, orderBy: { title: 'asc' } }),
      prisma.accountSettings.findUnique({ where: { accountId } }),
    ]);

    return {
      automations: automations.map(automationRow),
      connections: connections.map(connectionRow),
      members: members.map(userRow),
      roles: roles.map(
        (row): Role => ({
          id: row.id,
          accountId: row.accountId,
          slug: row.slug,
          name: row.name,
          description: row.description,
          permissions: fromJson<readonly Permission[]>(row.permissionsJson, []),
          isSystem: row.isSystem,
        }),
      ),
      labels: labels.map(labelRow),
      knowledge: {
        categories: categories.map(categoryRow),
        articles: articles.map(articleRow),
      },
      assignmentMethod: (settings?.assignmentMethod ?? 'round_robin') as AssignmentMethod,
      macros: fromJson<readonly Macro[]>(settings?.macrosJson, []),
      cannedResponses: fromJson<readonly CannedResponse[]>(settings?.cannedResponsesJson, []),
      webhooks: fromJson<readonly Webhook[]>(settings?.webhooksJson, []),
      apiTokens: fromJson<readonly ApiToken[]>(settings?.apiTokensJson, []),
      teams: fromJson<readonly Team[]>(settings?.teamsJson, []),
      customAttributes: fromJson<readonly CustomAttributeDefinition[]>(
        settings?.customAttributesJson,
        [],
      ),
      billing: fromJson<BillingInfo>(settings?.billingJson, EMPTY_BILLING),
      auditLog: fromJson<readonly AuditLogEntry[]>(settings?.auditLogJson, []),
      activeSessions: fromJson<readonly ActiveSession[]>(settings?.activeSessionsJson, []),
    };
  }

  async setAutomationEnabled(
    accountId: Id,
    automationId: Id,
    enabled: boolean,
  ): Promise<Automation> {
    await this.assertAutomation(accountId, automationId);
    return automationRow(
      await prisma.automation.update({ where: { id: automationId }, data: { enabled } }),
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
          where: { id: draft.id },
          data: {
            name: draft.name,
            trigger: draft.trigger,
            conditionsJson: toJson(draft.conditions),
            actionsJson: toJson(draft.actions),
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
          conditionsJson: toJson(draft.conditions),
          actionsJson: toJson(draft.actions),
          enabled: draft.enabled,
          order: (last?.order ?? 0) + 1,
        },
      }),
    );
  }

  async deleteAutomation(accountId: Id, automationId: Id): Promise<void> {
    await this.assertAutomation(accountId, automationId);
    await prisma.automation.delete({ where: { id: automationId } });
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
        prisma.automation.update({ where: { id: item.id }, data: { order: position + 1 } }),
      ),
    );
  }

  async updateInbox(
    accountId: Id,
    connectionId: Id,
    patch: InboxSettingsPatch,
  ): Promise<ChannelConnection> {
    const exists = await prisma.channelConnection.findFirst({
      where: { id: connectionId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Caixa de entrada', connectionId);

    return connectionRow(
      await prisma.channelConnection.update({
        where: { id: connectionId },
        data: {
          ...(patch.businessHours ? { businessHoursJson: toJson(patch.businessHours) } : {}),
          ...(patch.awayMessage ? { awayMessageJson: toJson(patch.awayMessage) } : {}),
          ...(patch.greeting ? { greetingJson: toJson(patch.greeting) } : {}),
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
      tagsJson: toJson(draft.tags),
      updatedLabel: nowLabel(),
    };

    if (draft.id) {
      const exists = await prisma.knowledgeArticle.findFirst({
        where: { id: draft.id, accountId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Artigo', draft.id);

      return articleRow(
        await prisma.knowledgeArticle.update({ where: { id: draft.id }, data: shared }),
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
    await prisma.knowledgeArticle.delete({ where: { id: articleId } });
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
        await prisma.knowledgeCategory.update({ where: { id }, data: { name, description } }),
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

    await prisma.knowledgeCategory.delete({ where: { id: categoryId } });
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
