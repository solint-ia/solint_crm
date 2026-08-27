import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  jidDecode,
  jidNormalizedUser,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';

/**
 * Resolucao de identidade do WhatsApp.
 *
 * A partir do Baileys 7 o `remoteJid` pode chegar como LID (`@lid`) em vez do
 * número de telefone (`@s.whatsapp.net`). Todo o CRM indexa contato e conversa
 * pelo telefone, entao a traducao LID -> PN precisa acontecer aqui, na borda,
 * e nunca vazar para as camadas de cima.
 */

export interface ChatIdentity {
  /** JID canonico do chat — destino de envio (grupo ou usuário). */
  readonly jid: string;
  readonly isGroup: boolean;
  /** E.164 do contato. Vazio para grupos. */
  readonly phone: string;
  /** Chave estavel usada para derivar ids de contato/conversa. */
  readonly key: string;
  readonly contactId: string;
  readonly conversationId: string;
}

/** Chats que viram atendimento: exclusivamente mensagens privadas 1x1. Ignora grupos, status, transmissões e canais. */
export const isSupportedChatJid = (jid: string | undefined | null): jid is string => {
  if (!jid) return false;
  if (isJidStatusBroadcast(jid)) return false;
  if (isJidBroadcast(jid)) return false;
  if (isJidNewsletter(jid)) return false;
  if (isJidGroup(jid) || jid.endsWith('@g.us')) return false;
  return true;
};


export const userOf = (jid: string | undefined): string => jidDecode(jid)?.user ?? '';

export const phoneFromJid = (jid: string | undefined): string => {
  const user = userOf(jid);
  return /^\d{8,15}$/.test(user) ? `+${user}` : '';
};

/**
 * Converte um JID de usuário para a forma com número de telefone.
 * Ordem de preferencia: proprio JID (ja e PN) -> `remoteJidAlt`/`participantAlt`
 * enviado pelo servidor -> tabela de mapeamento LID->PN da sessão.
 */
export const resolvePhoneJid = async (
  socket: WASocket,
  jid: string,
  altJid?: string,
): Promise<string> => {
  if (!isLidUser(jid)) return jidNormalizedUser(jid);
  if (altJid && !isLidUser(altJid)) return jidNormalizedUser(altJid);
  try {
    const mapped = await socket.signalRepository.lidMapping.getPNForLID(jidNormalizedUser(jid));
    if (mapped) return jidNormalizedUser(mapped);
  } catch {
    // Mapeamento indisponivel — segue com o LID como identidade.
  }
  return jidNormalizedUser(jid);
};

/**
 * Ids sugeridos para o chat — **escopados pela conta**.
 *
 * Eram derivados so do telefone (`cv-wa-<numero>`), e como `Contact.id` e
 * `Conversation.id` sao chave primaria global, duas contas falando com o mesmo
 * numero disputavam a mesma linha. O efeito, quando a segunda conta apareceu:
 * `conversation.create` estourava `P2002` na propria chave primaria, o
 * `catch` relia a conversa escopado pela conta, nao achava nada (a linha era
 * da outra conta) e relancava — a excecao subia ate o listener do Baileys, que
 * nao aguarda listener assincrono, e **a mensagem sumia**. Uma conexao nova
 * conectava com sucesso e nao recebia nada.
 *
 * Sao "sugeridos" porque valem para linha nova. Quando a conversa ja existe,
 * quem manda e o id que ela tem — inclusive o formato antigo, sem conta. Ver
 * `resolveStoredIds` em `wa-store.ts`, que faz essa traducao pela chave
 * natural (`inboxId` + `channelThreadId`) antes de qualquer gravacao.
 */
const identityFromKey = (
  accountId: string,
  jid: string,
  isGroup: boolean,
  phone: string,
): ChatIdentity => {
  const key = isGroup ? `g-${userOf(jid)}` : phone ? phone.slice(1) : `lid-${userOf(jid)}`;
  return {
    jid,
    isGroup,
    phone,
    key,
    contactId: `ct-wa-${accountId}-${key}`,
    conversationId: `cv-wa-${accountId}-${key}`,
  };
};

/** Identidade do chat ao qual a mensagem pertence (o grupo, no caso de grupos). */
export const resolveChatIdentity = async (
  socket: WASocket,
  key: WAMessageKey,
  accountId: string,
): Promise<ChatIdentity | null> => {
  const remoteJid = key.remoteJid;
  if (!isSupportedChatJid(remoteJid)) return null;

  if (isJidGroup(remoteJid)) {
    return identityFromKey(accountId, remoteJid, true, '');
  }

  const pnJid = await resolvePhoneJid(socket, remoteJid, key.remoteJidAlt);
  return identityFromKey(accountId, pnJid, false, phoneFromJid(pnJid));
};

/** Identidade de quem escreveu — em grupos difere do chat. */
export const resolveSenderIdentity = async (
  socket: WASocket,
  key: WAMessageKey,
): Promise<{ readonly jid: string; readonly phone: string } | null> => {
  const participant = key.participant ?? key.remoteJid;
  if (!participant) return null;
  const pnJid = await resolvePhoneJid(socket, participant, key.participantAlt);
  return { jid: pnJid, phone: phoneFromJid(pnJid) };
};

/** Converte telefone livre digitado no CRM em JID de usuário. */
export const jidFromPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
};
