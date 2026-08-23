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
}
