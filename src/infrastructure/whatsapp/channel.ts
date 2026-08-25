import type { WhatsAppOwner, WhatsAppStatusPayload } from './whatsapp-events';

/**
 * Fronteira entre "o CRM quer falar no WhatsApp" e "quem executa isso".
 *
 * Existem dois executores. O **in-process** roda o Baileys dentro do próprio
 * servidor Next e é o padrão. O **worker** é um processo separado que consome
 * uma fila de comandos — é o que permite atender várias caixas e sobreviver a um
 * deploy do site sem derrubar as sessões.
 *
 * Antes os dois existiam no código sem nada em comum, e as telas falavam direto
 * com o in-process. Trocar de motor significaria mexer em rota, Server Action e
 * componente. Com esta fronteira, troca-se uma variável de ambiente.
 */

export interface DispatchTarget {
  readonly channelThreadId?: string;
  readonly phone?: string;
}

/** De onde saiu o envio — o worker precisa disso para carimbar a mensagem depois. */
export interface DispatchContext {
  readonly accountId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

export interface DispatchMedia {
  readonly kind: 'image' | 'video' | 'audio' | 'document';
  readonly mediaId: string;
  readonly mimeType: string;
  readonly fileName?: string;
  readonly caption?: string;
  readonly voice?: boolean;
}

export interface DispatchResult {
  readonly ok: boolean;
  /**
   * Id da mensagem no canal.
   *
   * Ausente quando `queued` é verdadeiro: o envio foi aceito mas ainda não
   * aconteceu, e quem carimba o id é o worker, ao concluir.
   */
  readonly externalId?: string;
  /** O envio entrou na fila. A tela mostra "enviando" e o recibo chega depois. */
  readonly queued?: boolean;
  readonly error?: string;
}

export interface WhatsAppChannel {
  /** Nome do motor, para diagnóstico e para a interface saber o que esperar. */
  readonly engine: 'inprocess' | 'worker';

  /**
   * Estado da conexão da conta.
   *
   * Assíncrono mesmo no motor in-process, onde o valor está em memória: um
   * método que muda de assinatura conforme o motor não seria uma fronteira.
   */
  getStatus(accountId: string): Promise<WhatsAppStatusPayload>;

  startSession(owner: WhatsAppOwner): Promise<WhatsAppStatusPayload>;

  disconnect(accountId: string): Promise<void>;

  sendText(
    context: DispatchContext,
    target: DispatchTarget,
    text: string,
  ): Promise<DispatchResult>;

  sendMedia(
    context: DispatchContext,
    target: DispatchTarget,
    media: DispatchMedia,
  ): Promise<DispatchResult>;

  markRead(accountId: string, conversationId: string): Promise<void>;
}

/**
 * Motor em uso.
 *
 * O padrão é `inprocess` de propósito: `npm run dev` sozinho tem que continuar
 * funcionando. O worker exige um segundo processo no ar, e ligá-lo por padrão
 * faria o WhatsApp parar de funcionar para quem não soubesse disso.
 */
export const WA_ENGINE: WhatsAppChannel['engine'] =
  process.env.WA_ENGINE === 'worker' ? 'worker' : 'inprocess';
