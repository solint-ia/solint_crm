import type {
  Campaign,
  CampaignMetrics,
  CampaignStatus,
  Segment,
  WhatsAppTemplate,
} from '@/core/domain/campaign';
import { NotFoundError, type Id } from '@/core/domain/shared';
import type { CampaignRepository } from '@/core/ports/campaign-repository';
import { prisma, readJson, asJson } from '@/infrastructure/db/prisma';

export class PrismaCampaignRepository implements CampaignRepository {
  async list(accountId: Id): Promise<readonly Campaign[]> {
    const rows = await prisma.campaign.findMany({
      where: { accountId },
      include: { segment: true, template: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => {
      const stats = readJson<Partial<CampaignMetrics>>(r.stats, {});
      return {
        id: r.id,
        accountId: r.accountId,
        name: r.name,
        status: (r.status as CampaignStatus) || 'rascunho',
        segmentName: r.segment?.name ?? 'Base geral de contatos',
        templateName: r.template?.name ?? 'Template padrão',
        scheduledLabel: r.scheduledAt
          ? r.scheduledAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : 'Disparo manual',
        metrics: {
          recipients: stats.recipients ?? 0,
          sent: stats.sent ?? 0,
          delivered: stats.delivered ?? 0,
          read: stats.read ?? 0,
          failed: stats.failed ?? 0,
        },
      };
    });
  }

  async findById(accountId: Id, campaignId: Id): Promise<Campaign | null> {
    const r = await prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
      include: { segment: true, template: true },
    });
    if (!r) return null;

    const stats = readJson<Partial<CampaignMetrics>>(r.stats, {});
    return {
      id: r.id,
      accountId: r.accountId,
      name: r.name,
      status: (r.status as CampaignStatus) || 'rascunho',
      segmentName: r.segment?.name ?? 'Base geral de contatos',
      templateName: r.template?.name ?? 'Template padrão',
      scheduledLabel: r.scheduledAt
        ? r.scheduledAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'Disparo manual',
      metrics: {
        recipients: stats.recipients ?? 0,
        sent: stats.sent ?? 0,
        delivered: stats.delivered ?? 0,
        read: stats.read ?? 0,
        failed: stats.failed ?? 0,
      },
    };
  }

  async listSegments(accountId: Id): Promise<readonly Segment[]> {
    const rows = await prisma.segment.findMany({
      where: { accountId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      name: r.name,
      description: r.description ?? '',
      contactCount: r.contactCount,
    }));
  }

  async listTemplates(accountId: Id): Promise<readonly WhatsAppTemplate[]> {
    const rows = await prisma.messageTemplate.findMany({
      where: { accountId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => {
      // Extrai variáveis {{1}}, {{2}}, etc. do corpo da mensagem
      const matches = Array.from(r.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => `Variável ${m[1]}`);
      return {
        id: r.id,
        accountId: r.accountId,
        name: r.name,
        body: r.body,
        approval: 'aprovado',
        variables: [...new Set(matches)],
      };
    });
  }

  async createCampaign(
    accountId: Id,
    draft: {
      name: string;
      segmentId?: Id;
      templateId: Id;
      scheduledAt?: string;
      rateLimit?: number;
      variables?: readonly string[];
    },
  ): Promise<Campaign> {
    const inbox = await prisma.inbox.findFirst({
      where: { accountId },
      select: { id: true, channel: true },
    });

    const row = await prisma.campaign.create({
      data: {
        accountId,
        inboxId: inbox?.id ?? 'inbox-default',
        channel: inbox?.channel ?? 'whatsapp',
        name: draft.name,
        segmentId: draft.segmentId || null,
        templateId: draft.templateId,
        scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt) : null,
        status: draft.scheduledAt ? 'agendada' : 'em_andamento',
        stats: asJson({
          recipients: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
        }),
      },
      include: { segment: true, template: true },
    });

    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      status: (row.status as CampaignStatus) || 'em_andamento',
      segmentName: row.segment?.name ?? 'Base geral de contatos',
      templateName: row.template?.name ?? 'Template padrão',
      scheduledLabel: row.scheduledAt
        ? row.scheduledAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'Disparo manual',
      metrics: { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
    };
  }

  async toggleCampaignStatus(
    accountId: Id,
    campaignId: Id,
    status: CampaignStatus,
  ): Promise<Campaign> {
    const exists = await prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Campanha', campaignId);

    const row = await prisma.campaign.update({
      where: { id: campaignId, accountId },
      data: { status },
      include: { segment: true, template: true },
    });

    const stats = readJson<Partial<CampaignMetrics>>(row.stats, {});
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      status: (row.status as CampaignStatus) || 'rascunho',
      segmentName: row.segment?.name ?? 'Base geral de contatos',
      templateName: row.template?.name ?? 'Template padrão',
      scheduledLabel: row.scheduledAt
        ? row.scheduledAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'Disparo manual',
      metrics: {
        recipients: stats.recipients ?? 0,
        sent: stats.sent ?? 0,
        delivered: stats.delivered ?? 0,
        read: stats.read ?? 0,
        failed: stats.failed ?? 0,
      },
    };
  }

  async deleteCampaign(accountId: Id, campaignId: Id): Promise<void> {
    const exists = await prisma.campaign.findFirst({
      where: { id: campaignId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Campanha', campaignId);
    await prisma.campaign.delete({ where: { id: campaignId, accountId } });
  }
}
