import type {
  Campaign,
  CampaignAudience,
  CampaignAudienceOption,
  CampaignInbox,
  CampaignRecipient,
  CampaignVariable,
  WhatsAppTemplate,
} from '../domain/campaign';
import type { Id } from '../domain/shared';

export interface CampaignDraft {
  readonly name: string;
  readonly inboxId: Id;
  readonly templateId: Id;
  readonly audience: CampaignAudience;
  readonly variables: readonly CampaignVariable[];
  readonly rateLimit: number;
  /** ISO. Ausente = começa agora. */
  readonly scheduledAt?: string;
  readonly createdById: Id;
}

export interface CampaignRepository {
  list(accountId: Id): Promise<readonly Campaign[]>;
  findById(accountId: Id, campaignId: Id): Promise<Campaign | null>;
  listRecipients(accountId: Id, campaignId: Id): Promise<readonly CampaignRecipient[]>;
  /** Caixas da API oficial da conta, únicas que disparam campanha. */
  listInboxes(accountId: Id): Promise<readonly CampaignInbox[]>;
  listAudiences(accountId: Id): Promise<readonly CampaignAudienceOption[]>;
  listTemplates(accountId: Id): Promise<readonly WhatsAppTemplate[]>;
  /** Cria a campanha e materializa os destinatários. */
  createCampaign(accountId: Id, draft: CampaignDraft): Promise<Campaign>;
  pauseCampaign(accountId: Id, campaignId: Id): Promise<Campaign>;
  resumeCampaign(accountId: Id, campaignId: Id): Promise<Campaign>;
  cancelCampaign(accountId: Id, campaignId: Id): Promise<Campaign>;
  deleteCampaign(accountId: Id, campaignId: Id): Promise<void>;
}
