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

const identityFromKey = (jid: string, isGroup: boolean, phone: string): ChatIdentity => {
  const key = isGroup ? `g-${userOf(jid)}` : phone ? phone.slice(1) : `lid-${userOf(jid)}`;
  return {
    jid,
    isGroup,
    phone,
    key,
    contactId: `ct-wa-${key}`,
    conversationId: `cv-wa-${key}`,
  };
};

/** Identidade do chat ao qual a mensagem pertence (o grupo, no caso de grupos). */
export const resolveChatIdentity = async (
  socket: WASocket,
  key: WAMessageKey,
): Promise<ChatIdentity | null> => {
  const remoteJid = key.remoteJid;
  if (!isSupportedChatJid(remoteJid)) return null;

  if (isJidGroup(remoteJid)) {
    return identityFromKey(remoteJid, true, '');
  }

  const pnJid = await resolvePhoneJid(socket, remoteJid, key.remoteJidAlt);
  return identityFromKey(pnJid, false, phoneFromJid(pnJid));
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
