import type { Campaign, Segment, WhatsAppTemplate } from '@/core/domain/campaign';
import type { Id } from '@/core/domain/shared';
import type { CampaignRepository } from '@/core/ports/campaign-repository';
import { CAMPAIGNS, SEGMENTS, TEMPLATES } from '@/infrastructure/seed/campaigns';

export class InMemoryCampaignRepository implements CampaignRepository {
  async list(accountId: Id): Promise<readonly Campaign[]> {
    return CAMPAIGNS.filter((campaign) => campaign.accountId === accountId);
  }

  async findById(accountId: Id, campaignId: Id): Promise<Campaign | null> {
    return (
      CAMPAIGNS.find(
        (campaign) => campaign.accountId === accountId && campaign.id === campaignId,
      ) ?? null
    );
  }

  async listSegments(accountId: Id): Promise<readonly Segment[]> {
    return SEGMENTS.filter((segment) => segment.accountId === accountId);
  }

  async listTemplates(accountId: Id): Promise<readonly WhatsAppTemplate[]> {
    return TEMPLATES.filter((template) => template.accountId === accountId);
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
    const campaign: Campaign = {
      id: `cmp-${Date.now()}`,
      accountId,
      name: draft.name,
      status: draft.scheduledAt ? 'agendada' : 'em_andamento',
      segmentName: 'Base geral',
      templateName: 'Template WhatsApp',
      scheduledLabel: draft.scheduledAt ?? 'Hoje',
      metrics: { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
    };
    return campaign;
  }

  async toggleCampaignStatus(
    accountId: Id,
    campaignId: Id,
    status: Campaign['status'],
  ): Promise<Campaign> {
    const found = await this.findById(accountId, campaignId);
    if (!found) throw new Error('Campanha não encontrada');
    return { ...found, status };
  }

  async deleteCampaign(_accountId: Id, _campaignId: Id): Promise<void> {}
}

