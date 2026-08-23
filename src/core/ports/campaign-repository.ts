import type { Campaign, Segment, WhatsAppTemplate } from '../domain/campaign';
import type { Id } from '../domain/shared';

export interface CampaignRepository {
  list(accountId: Id): Promise<readonly Campaign[]>;
  findById(accountId: Id, campaignId: Id): Promise<Campaign | null>;
  listSegments(accountId: Id): Promise<readonly Segment[]>;
  listTemplates(accountId: Id): Promise<readonly WhatsAppTemplate[]>;
}
