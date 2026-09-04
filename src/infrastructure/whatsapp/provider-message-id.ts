import { createHash } from 'node:crypto';

/**
 * Id estável usado no próprio protocolo do WhatsApp.
 *
 * Se o worker cair depois de o provedor aceitar a mensagem e antes de gravar o
 * resultado, a repetição usa o mesmo id em vez de criar uma segunda mensagem.
 */
export const providerMessageIdFor = (messageId: string): string =>
  `SOLINT${createHash('sha256').update(messageId).digest('hex').slice(0, 26).toUpperCase()}`;
