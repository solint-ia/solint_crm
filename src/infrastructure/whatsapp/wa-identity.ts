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

/** Chats que viram atendimento: mensagens privadas 1x1, listas de transmissão e grupos do WhatsApp. Ignora status e canais. */
export const isSupportedChatJid = (jid: string | undefined | null): jid is string => {
  if (!jid) return false;
  if (isJidStatusBroadcast(jid) || jid === 'status@broadcast') return false;
  if (isJidNewsletter(jid) || jid.endsWith('@newsletter')) return false;
  return true;
};


export const userOf = (jid: string | undefined): string => jidDecode(jid)?.user ?? '';

export const phoneFromJid = (jid: string | undefined): string => {
  if (!jid || isLidUser(jid) || jid.endsWith('@lid')) return '';
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
  if (!isLidUser(jid) && !jid.endsWith('@lid')) return jidNormalizedUser(jid);
  if (altJid && !isLidUser(altJid) && !altJid.endsWith('@lid')) return jidNormalizedUser(altJid);
  try {
    const mapped = await socket.signalRepository?.lidMapping?.getPNForLID(jidNormalizedUser(jid));
    if (mapped && !isLidUser(mapped) && !mapped.endsWith('@lid')) return jidNormalizedUser(mapped);
  } catch {
    // Mapeamento indisponivel — segue com o LID como identidade.
  }
  return jidNormalizedUser(jid);
};

/**
 * Onde a mensagem entrou. É o que escopa os ids derivados.
 *
 * Os dois campos, e não um: eles respondem perguntas diferentes, e passá-los
 * nomeados impede o erro que trocá-los de posição causaria — um id de caixa no
 * lugar do de conta não daria erro nenhum, só grava a conversa no lugar errado.
 */
export interface ChatScope {
  readonly accountId: string;
  readonly inboxId: string;
}

/**
 * Ids sugeridos para o chat.
 *
 * **A conversa é da caixa; o contato é da conta.** Os dois escopos são
 * diferentes de propósito, e cada um custou um defeito para chegar aqui:
 *
 *  - Sem conta nenhuma (`cv-wa-<numero>`, o formato original), duas contas
 *    falando com o mesmo número disputavam a mesma linha de chave primária. A
 *    segunda conta conectava com sucesso e não recebia mensagem nenhuma: o
 *    `create` estourava `P2002`, o `catch` relia escopado pela conta, não
 *    achava (a linha era da outra) e relançava — e a exceção subia até o
 *    listener do Baileys, que não aguarda listener assíncrono.
 *
 *  - Escopando pela **conta** (`cv-wa-<conta>-<numero>`) aquilo se resolveu e
 *    apareceu o problema seguinte, um nível abaixo: duas caixas da mesma conta
 *    derivavam o mesmo id. Um cliente que escrevesse para os dois números da
 *    empresa tinha a segunda mensagem anexada à conversa da primeira caixa. A
 *    caixa que recebeu ficava vazia, os dois assuntos viravam uma timeline só
 *    e — o pior — a resposta saía pelo número errado, porque o envio usa a
 *    caixa **da conversa**. Nada falhava; a mensagem só sumia de onde entrou.
 *
 * O contato continua por conta porque é a mesma pessoa: dois números da mesma
 * empresa falando com o mesmo cliente não são dois clientes. O que não pode
 * ser compartilhado é a conversa — ela é um atendimento, e atendimento tem
 * canal.
 *
 * `inboxId` já é único por conta, então escopar por ele preserva o isolamento
 * entre contas em vez de trocar um problema pelo outro.
 *
 * São "sugeridos" porque valem para linha nova. Quando a conversa já existe,
 * quem manda é o id que ela tem — inclusive nos formatos antigos. Ver
 * `resolveStoredIds` em `wa-store.ts`, que traduz pela chave natural
 * (`inboxId` + `channelThreadId`) antes de qualquer gravação.
 */
const identityFromKey = (
  scope: ChatScope,
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
    contactId: `ct-wa-${scope.accountId}-${key}`,
    conversationId: `cv-wa-${scope.inboxId}-${key}`,
  };
};

/** Identidade do chat ao qual a mensagem pertence (ou contato individual em transmissões). */
export const resolveChatIdentity = async (
  socket: WASocket,
  key: WAMessageKey,
  scope: ChatScope,
): Promise<ChatIdentity | null> => {
  const remoteJid = key.remoteJid;
  if (!isSupportedChatJid(remoteJid)) return null;

  if (isJidGroup(remoteJid)) {
    return identityFromKey(scope, remoteJid, true, '');
  }

  // Se a mensagem veio de uma lista de transmissão (@broadcast), quem escreveu foi o participant
  const isBroadcast = isJidBroadcast(remoteJid) || remoteJid.endsWith('@broadcast');
  const targetJid = isBroadcast ? (key.participant ?? remoteJid) : remoteJid;
  const targetAlt = isBroadcast ? (key.participantAlt ?? key.remoteJidAlt) : key.remoteJidAlt;

  const pnJid = await resolvePhoneJid(socket, targetJid, targetAlt);
  return identityFromKey(scope, pnJid, false, phoneFromJid(pnJid));
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

/** Normaliza destinatário livre (telefone, JID individual, JID de grupo) para envio no socket. */
export const normalizeTargetJid = (raw: string | undefined | null): string | undefined => {
  if (!raw) return undefined;
  if (raw.endsWith('@g.us')) {
    const gIndex = raw.indexOf('-g-');
    if (gIndex !== -1) {
      const clean = raw.slice(gIndex + 3);
      return clean.endsWith('@g.us') ? clean : `${clean}@g.us`;
    }
    return raw;
  }
  return isSupportedChatJid(raw) ? raw : jidFromPhone(raw);
};
