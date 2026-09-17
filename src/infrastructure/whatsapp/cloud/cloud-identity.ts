import { createHash } from 'node:crypto';

import type { ChatIdentity, ChatScope } from '../wa-identity';
import { BSUID_THREAD_PREFIX } from './cloud-sender';

/**
 * A identidade do chat de uma caixa oficial, no **mesmo esquema** do QR Code.
 *
 * Com telefone, o `jid` é `<numero>@s.whatsapp.net`, a conversa é
 * `cv-wa-<caixa>-<numero>` e o contato `ct-wa-<conta>-<numero>`. É o que faz
 * uma caixa migrar do QR para a API oficial e continuar nas mesmas conversas, e
 * o que permite a `resolveStoredIds` aplicar a mesma regra do nono dígito.
 *
 * Sem telefone (só BSUID), a chave nasce do BSUID. O id da Meta pode ter até
 * 128 caracteres e pontos; a chave usa um resumo dele para caber nos ids.
 */
export const cloudChatIdentity = (
  scope: ChatScope,
  phone: string,
  userId: string | undefined,
): ChatIdentity => {
  const digits = phone.replace(/\D/g, '');
  if (digits) {
    return {
      jid: `${digits}@s.whatsapp.net`,
      isGroup: false,
      phone: `+${digits}`,
      key: digits,
      contactId: `ct-wa-${scope.accountId}-${digits}`,
      conversationId: `cv-wa-${scope.inboxId}-${digits}`,
    };
  }
  const bsuid = userId ?? 'desconhecido';
  const key = `bsuid-${createHash('sha256').update(bsuid).digest('hex').slice(0, 24)}`;
  return {
    jid: `${BSUID_THREAD_PREFIX}${bsuid}`,
    isGroup: false,
    phone: '',
    key,
    contactId: `ct-wa-${scope.accountId}-${key}`,
    conversationId: `cv-wa-${scope.inboxId}-${key}`,
  };
};

/** Id seguro para o depósito de mídia: o `wamid` tem pontos e `=`. */
export const cloudMediaSourceId = (wamid: string): string =>
  `cloud-${createHash('sha256').update(wamid).digest('hex').slice(0, 40)}`;

/** Id da linha da mensagem no CRM, estável para a mesma mensagem da Meta. */
export const cloudMessageRowId = (conversationId: string, wamid: string): string =>
  `msg-wa-${conversationId}-${createHash('sha256').update(wamid).digest('hex').slice(0, 32)}`;
