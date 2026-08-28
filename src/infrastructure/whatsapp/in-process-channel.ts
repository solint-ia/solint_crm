import type {
  DispatchContext,
  DispatchMedia,
  DispatchQuote,
  DispatchResult,
  DispatchTarget,
  WhatsAppChannel,
} from './channel';
import { mediaStore } from './wa-media-store';
import { whatsappService } from './whatsapp-service';
import type { WhatsAppOwner, WhatsAppStatusPayload } from './whatsapp-events';

/**
 * Motor in-process: o Baileys roda dentro do servidor Next.
 *
 * É o comportamento que o projeto sempre teve, agora atrás da fronteira comum.
 * O envio é síncrono do ponto de vista de quem chama — a resposta já traz o id
 * da mensagem no canal —, então nada aqui devolve `queued`.
 *
 * Limite conhecido: o serviço atende **uma** sessão por processo e morre junto
 * com o servidor. É por isso que o motor `worker` existe.
 */
export class InProcessWhatsAppChannel implements WhatsAppChannel {
  readonly engine = 'inprocess' as const;

  /**
   * `inboxId` é aceito e ignorado: este motor tem uma sessão só para o processo
   * inteiro, então não há por onde escolher caixa. Quem precisa de roteamento
   * por caixa usa o motor `worker` — é uma das razões de ele existir.
   */
  async getStatus(_accountId: string, _inboxId?: string): Promise<WhatsAppStatusPayload> {
    return whatsappService.getStatus();
  }

  async startSession(owner: WhatsAppOwner): Promise<WhatsAppStatusPayload> {
    return whatsappService.startSession({ owner });
  }

  async disconnect(_accountId: string): Promise<void> {
    await whatsappService.disconnect();
  }

  async sendText(
    _context: DispatchContext,
    target: DispatchTarget,
    text: string,
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    return whatsappService.sendTextMessage(target, text, quote);
  }

  async deleteMessage(
    _context: DispatchContext,
    target: DispatchTarget,
    externalId: string,
  ): Promise<DispatchResult> {
    return whatsappService.deleteMessage(target, externalId);
  }

  async sendMedia(
    _context: DispatchContext,
    target: DispatchTarget,
    media: DispatchMedia,
  ): Promise<DispatchResult> {
    // O anexo já foi gravado no depósito antes de chegar aqui, e é de lá que os
    // bytes saem — nos dois motores. Passar o Buffer por este método deixaria a
    // fronteira com uma forma para cada motor, que é justamente o que ela evita.
    const stored = await mediaStore.read(media.mediaId);
    if (!stored) return { ok: false, error: 'Anexo não encontrado no depósito local.' };

    const data = await stored.bytes();
    return whatsappService.sendMediaMessage(target, {
      kind: media.kind,
      data,
      mimeType: media.mimeType,
      ...(media.fileName ? { fileName: media.fileName } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.voice ? { voice: true } : {}),
    });
  }

  async markRead(
    _accountId: string,
    conversationId: string,
    _inboxId?: string,
  ): Promise<void> {
    await whatsappService.markConversationAsRead(conversationId);
  }

  async sendPresence(
    _context: { accountId: string; inboxId: string; conversationId: string },
    target: DispatchTarget,
    status: 'composing' | 'paused' | 'recording',
  ): Promise<void> {
    const raw = target.channelThreadId ?? target.phone;
    if (!raw) return;
    await whatsappService.sendPresence(raw, status);
  }
}
