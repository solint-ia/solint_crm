import {
  isWithinBusinessHours,
  normalizeAutoReply,
  normalizeBusinessHours,
  type AutoReply,
} from '@/core/domain/business-hours';
import { DEFAULT_CSAT_QUESTION, parseCsatScore } from '@/core/domain/csat';
import { prisma } from '@/infrastructure/db/prisma';
import { dispatchAutoMessage, type AutoMessageOrigin } from './auto-reply';

/**
 * As quatro mensagens automáticas da caixa de entrada, num lugar só.
 *
 * Elas estavam espalhadas: saudação e ausência dentro do gravador de mensagens
 * do WhatsApp, encerramento dentro da Server Action de status, e a de espera
 * **em lugar nenhum** — o cartão existia na tela, o texto era salvo no banco e
 * nada no sistema jamais o lia. Além disso, nenhuma delas tinha trava: a de
 * ausência saía a cada mensagem recebida fora do expediente, então um cliente
 * que mandasse cinco frases às onze da noite recebia cinco vezes o mesmo aviso.
 *
 * Aqui cada regra responde duas perguntas — "o texto está ligado e preenchido?"
 * e "eu já disparei nesta conversa?" — e a segunda é respondida pela coluna
 * `origin` das mensagens já gravadas, não por memória de processo: o worker
 * reinicia, e uma trava que vive na RAM some junto.
 */

/**
 * Quanto tempo a mensagem de ausência espera antes de poder repetir.
 *
 * Uma noite inteira de mensagens é um episódio só do ponto de vista de quem
 * escreve. Oito horas cobre a madrugada e ainda deixa o aviso sair de novo no
 * dia seguinte, se o cliente voltar a escrever com o atendimento fechado.
 */
const AWAY_COOLDOWN_MS = 8 * 60 * 60 * 1000;

/** Encerrar duas vezes seguidas é clique repetido, não dois atendimentos. */
const CLOSING_COOLDOWN_MS = 5 * 60 * 1000;

/** Depois disso, a resposta do cliente não é mais leitura da pesquisa. */
const CSAT_WINDOW_MS = 24 * 60 * 60 * 1000;

interface Destino {
  readonly accountId: string;
  readonly inboxId: string;
  readonly conversationId: string;
  readonly channelThreadId?: string | null;
  readonly phone: string;
}

/** A mensagem automática mais recente daquela origem, se houver. */
const ultimoDisparo = async (
  conversationId: string,
  origin: AutoMessageOrigin,
): Promise<Date | undefined> => {
  const linha = await prisma.message.findFirst({
    where: { conversationId, origin },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return linha?.createdAt;
};

const utilizavel = (reply: AutoReply | undefined): reply is AutoReply =>
  Boolean(reply?.enabled && reply.text.trim());

const enviar = async (
  destino: Destino,
  text: string,
  origin: AutoMessageOrigin,
  authorName: string,
): Promise<void> => {
  await dispatchAutoMessage({
    accountId: destino.accountId,
    inboxId: destino.inboxId,
    conversationId: destino.conversationId,
    recipient: { channelThreadId: destino.channelThreadId ?? null, phone: destino.phone },
    text: text.trim(),
    origin,
    authorName,
  });
};

const CONFIG_SELECT = {
  businessHours: true,
  awayMessage: true,
  greeting: true,
  closingMessage: true,
  waitingMessage: true,
  waitingMessageDelayMinutes: true,
  csatEnabled: true,
  csatQuestion: true,
} as const;

export interface InboxAutoConfig {
  readonly greeting: AutoReply;
  readonly away: AutoReply;
  readonly closing: AutoReply;
  readonly waiting: AutoReply;
  readonly waitingDelayMinutes: number;
  readonly csatEnabled: boolean;
  readonly csatQuestion: string;
  readonly isOpenNow: (now?: Date) => boolean;
}

export const loadInboxAutoConfig = async (
  accountId: string,
  inboxId: string,
): Promise<InboxAutoConfig | undefined> => {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, accountId },
    select: CONFIG_SELECT,
  });
  if (!inbox) return undefined;

  const hours = normalizeBusinessHours(inbox.businessHours);
  return {
    greeting: normalizeAutoReply(inbox.greeting),
    away: normalizeAutoReply(inbox.awayMessage),
    closing: normalizeAutoReply(inbox.closingMessage),
    waiting: normalizeAutoReply(inbox.waitingMessage),
    waitingDelayMinutes: Math.max(1, inbox.waitingMessageDelayMinutes || 5),
    csatEnabled: inbox.csatEnabled,
    csatQuestion: inbox.csatQuestion?.trim() || DEFAULT_CSAT_QUESTION,
    isOpenNow: (now = new Date()) => isWithinBusinessHours(hours, now),
  };
};

/* ==========================================================================
   1 e 2 — Saudação e ausência, no caminho da mensagem recebida.
   ========================================================================== */

export interface InboundAutoInput extends Destino {
  /** A conversa acabou de nascer com esta mensagem. */
  readonly isNewConversation: boolean;
}

/**
 * Decide entre saudação e ausência para uma mensagem recebida.
 *
 * A ordem importa e é deliberada: fora do expediente, o aviso de ausência
 * substitui a saudação em vez de acompanhá-la — duas mensagens automáticas
 * seguidas para quem escreveu uma só é ruído, e a de ausência é a que carrega
 * a informação útil ("ninguém vai responder agora").
 */
export const runInboundAutoReplies = async (input: InboundAutoInput): Promise<void> => {
  const config = await loadInboxAutoConfig(input.accountId, input.inboxId);
  if (!config) return;

  if (!config.isOpenNow() && utilizavel(config.away)) {
    const ultimo = await ultimoDisparo(input.conversationId, 'ausencia');
    if (!ultimo || Date.now() - ultimo.getTime() > AWAY_COOLDOWN_MS) {
      await enviar(input, config.away.text, 'ausencia', 'Mensagem de ausência');
      return;
    }
    // Já avisamos há pouco, e a conversa não é nova se ela já recebeu o aviso.
    if (!input.isNewConversation) return;
  }

  if (!input.isNewConversation || !utilizavel(config.greeting)) return;

  // Uma saudação por conversa, para sempre. Duas mensagens chegando juntas
  // fazem os dois gravadores acharem que a conversa é nova (a mesma corrida que
  // o `P2002` de `createConversationWith` documenta) — e o cliente recebia a
  // boas-vindas duplicada.
  if (await ultimoDisparo(input.conversationId, 'saudacao')) return;

  await enviar(input, config.greeting.text, 'saudacao', 'Mensagem de saudação');
};

/* ==========================================================================
   3 — Encerramento, quando o atendimento é resolvido.
   ========================================================================== */

/**
 * Dispara o encerramento e, se ligada, a pesquisa de satisfação.
 *
 * Serve os dois caminhos que resolvem uma conversa: o botão do atendente e a
 * ação `resolver_conversa` das automações. A segunda mudava o status direto no
 * banco e o cliente nunca recebia o encerramento — a mensagem existia, estava
 * ligada, e simplesmente não saía quando quem resolvia era uma regra.
 */
export const runClosingAutoReply = async (
  accountId: string,
  conversationId: string,
): Promise<void> => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: {
      id: true,
      inboxId: true,
      channel: true,
      channelThreadId: true,
      csatAskedAt: true,
      csatScore: true,
      contact: { select: { phone: true } },
    },
  });
  if (!conversation) return;

  const config = await loadInboxAutoConfig(accountId, conversation.inboxId);
  if (!config) return;

  const destino: Destino = {
    accountId,
    inboxId: conversation.inboxId,
    conversationId: conversation.id,
    channelThreadId: conversation.channelThreadId,
    phone: conversation.contact?.phone ?? '',
  };

  if (utilizavel(config.closing)) {
    const ultimo = await ultimoDisparo(conversationId, 'encerramento');
    if (!ultimo || Date.now() - ultimo.getTime() > CLOSING_COOLDOWN_MS) {
      await enviar(destino, config.closing.text, 'encerramento', 'Encerramento automático');
    }
  }

  // A pesquisa vale uma vez por atendimento, e só enquanto não houver nota —
  // reperguntar a quem já respondeu é pedir para ser ignorado.
  if (!config.csatEnabled || conversation.csatScore !== null) return;
  const jaPerguntou =
    conversation.csatAskedAt && Date.now() - conversation.csatAskedAt.getTime() < CSAT_WINDOW_MS;
  if (jaPerguntou) return;

  await enviar(destino, config.csatQuestion, 'csat', 'Pesquisa de satisfação');
  await prisma.conversation.updateMany({
    where: { id: conversationId, accountId },
    data: { csatAskedAt: new Date() },
  });
};

/* ==========================================================================
   4 — Espera, para quem ficou na fila sem resposta.
   ========================================================================== */

/**
 * Manda o aviso de espera se a conversa realmente estiver parada.
 *
 * "Parada" é uma condição sobre as mensagens, não sobre o relógio: a última
 * mensagem pública precisa ser do contato. Uma conversa em que o atendente
 * respondeu há dez minutos e o cliente está pensando não está na fila.
 */
export const runWaitingAutoReply = async (
  accountId: string,
  conversationId: string,
): Promise<boolean> => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: {
      id: true,
      inboxId: true,
      status: true,
      channelThreadId: true,
      contact: { select: { phone: true } },
    },
  });
  if (!conversation) return false;
  if (conversation.status !== 'aberta' && conversation.status !== 'espera') return false;

  const config = await loadInboxAutoConfig(accountId, conversation.inboxId);
  if (!config || !utilizavel(config.waiting)) return false;

  // Fora do expediente quem fala é a mensagem de ausência. Avisar que "os
  // atendentes estão ocupados" às três da manhã é falso, e soa pior que o
  // silêncio.
  if (!config.isOpenNow()) return false;

  const ultima = await prisma.message.findFirst({
    where: { conversationId, isPrivate: false, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { author: true, createdAt: true },
  });
  if (!ultima) return false;

  // A própria mensagem de espera passa a ser a última quando ela sai: é assim
  // que a regra não se repete a cada rodada do varredor.
  if (ultima.author !== 'contact') return false;

  const esperaMs = Date.now() - ultima.createdAt.getTime();
  if (esperaMs < config.waitingDelayMinutes * 60_000) return false;

  await enviar(
    {
      accountId,
      inboxId: conversation.inboxId,
      conversationId,
      channelThreadId: conversation.channelThreadId,
      phone: conversation.contact?.phone ?? '',
    },
    config.waiting.text,
    'espera',
    'Mensagem de espera',
  );
  return true;
};

/* ==========================================================================
   Leitura da nota de satisfação que o cliente respondeu.
   ========================================================================== */

/**
 * Registra a nota quando a mensagem recebida for a resposta da pesquisa.
 *
 * Devolve `true` quando consumiu a mensagem — nesse caso a saudação e a
 * ausência não devem rodar: quem respondeu "5" não está começando uma conversa.
 */
export const captureCsatAnswer = async (
  accountId: string,
  conversationId: string,
  text: string | undefined,
): Promise<boolean> => {
  if (!text?.trim()) return false;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    select: { csatAskedAt: true, csatAnsweredAt: true, csatScore: true },
  });
  if (!conversation?.csatAskedAt || conversation.csatScore !== null) return false;
  if (Date.now() - conversation.csatAskedAt.getTime() > CSAT_WINDOW_MS) return false;

  const score = parseCsatScore(text);
  if (score === undefined) return false;

  await prisma.conversation.updateMany({
    where: { id: conversationId, accountId },
    data: { csatScore: score, csatAnsweredAt: new Date(), csatComment: text.trim().slice(0, 500) },
  });
  return true;
};
