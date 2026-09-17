import type {
  DispatchContext,
  DispatchMedia,
  DispatchQuote,
  DispatchResult,
  DispatchTarget,
  WhatsAppChannel,
  WhatsAppPairingOptions,
} from './channel';
import type { CloudApiWhatsAppChannel } from './cloud/cloud-channel';
import { providerOfInbox } from './cloud/cloud-connection';
import type { WhatsAppOwner, WhatsAppStatusPayload } from './whatsapp-events';

/**
 * Escolhe, por caixa, quem fala com o WhatsApp.
 *
 * Caixa com `provider = 'cloud_api'` vai para a API oficial; qualquer outra
 * segue para o motor de QR Code configurado (`inprocess` ou `worker`). Quem
 * chama não muda nada: Server Actions, API v1, automações e agendamentos
 * continuam pedindo "o canal" e mandando a caixa da conversa.
 *
 * Métodos sem caixa (o status da conta na topbar) ficam com o motor de QR, que
 * é o comportamento de antes da API oficial existir.
 */
export class ProviderRouterChannel implements WhatsAppChannel {
  constructor(
    private readonly baileys: WhatsAppChannel,
    private readonly cloud: CloudApiWhatsAppChannel,
  ) {}

  get engine(): WhatsAppChannel['engine'] {
    return this.baileys.engine;
  }

  private async para(inboxId: string | undefined): Promise<WhatsAppChannel> {
    if (!inboxId) return this.baileys;
    return (await providerOfInbox(inboxId)) === 'cloud_api' ? this.cloud : this.baileys;
  }

  async getStatus(accountId: string, inboxId?: string): Promise<WhatsAppStatusPayload> {
    return (await this.para(inboxId)).getStatus(accountId, inboxId);
  }

  async startSession(
    owner: WhatsAppOwner,
    options?: WhatsAppPairingOptions,
  ): Promise<WhatsAppStatusPayload> {
    return (await this.para(options?.inboxId)).startSession(owner, options);
  }

  async disconnect(accountId: string, inboxId?: string): Promise<void> {
    return (await this.para(inboxId)).disconnect(accountId, inboxId);
  }

  async sendText(
    context: DispatchContext,
    target: DispatchTarget,
    text: string,
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    return (await this.para(context.inboxId)).sendText(context, target, text, quote);
  }

  async sendMedia(
    context: DispatchContext,
    target: DispatchTarget,
    media: DispatchMedia,
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    return (await this.para(context.inboxId)).sendMedia(context, target, media, quote);
  }

  async deleteMessage(
    context: DispatchContext,
    target: DispatchTarget,
    externalId: string,
  ): Promise<DispatchResult> {
    return (await this.para(context.inboxId)).deleteMessage(context, target, externalId);
  }

  async sendReaction(
    context: DispatchContext,
    target: DispatchTarget,
    message: {
      readonly externalId: string;
      readonly fromMe: boolean;
      readonly participant?: string;
    },
    emoji: string,
  ): Promise<DispatchResult> {
    return (await this.para(context.inboxId)).sendReaction(context, target, message, emoji);
  }

  async markRead(accountId: string, conversationId: string, inboxId?: string): Promise<void> {
    return (await this.para(inboxId)).markRead(accountId, conversationId, inboxId);
  }

  async markReadMany(
    accountId: string,
    inboxId: string,
    conversationIds: readonly string[],
  ): Promise<void> {
    return (await this.para(inboxId)).markReadMany(accountId, inboxId, conversationIds);
  }

  async sendPresence(
    context: { accountId: string; inboxId: string; conversationId: string },
    target: DispatchTarget,
    status: 'composing' | 'paused' | 'recording',
    durationMs?: number,
  ): Promise<DispatchResult> {
    return (await this.para(context.inboxId)).sendPresence(context, target, status, durationMs);
  }
}
