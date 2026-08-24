import type { Campaign, CampaignStatus, Segment, WhatsAppTemplate } from '../domain/campaign';
import type { Id } from '../domain/shared';

export interface CampaignRepository {
  list(accountId: Id): Promise<readonly Campaign[]>;
  findById(accountId: Id, campaignId: Id): Promise<Campaign | null>;
  listSegments(accountId: Id): Promise<readonly Segment[]>;
  listTemplates(accountId: Id): Promise<readonly WhatsAppTemplate[]>;
  createCampaign(
    accountId: Id,
    draft: {
      name: string;
      segmentId?: Id;
      templateId: Id;
      scheduledAt?: string;
      rateLimit?: number;
      variables?: readonly string[];
    },
  ): Promise<Campaign>;
  toggleCampaignStatus(accountId: Id, campaignId: Id, status: CampaignStatus): Promise<Campaign>;
  deleteCampaign(accountId: Id, campaignId: Id): Promise<void>;
}

