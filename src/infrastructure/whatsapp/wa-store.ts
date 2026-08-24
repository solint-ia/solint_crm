import type { Contact } from '@/core/domain/contact';
import type { Conversation } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import { Prisma } from '@/generated/prisma';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import {
  CONVERSATION_INCLUDE,
  contactRow,
  conversationRow,
} from '@/infrastructure/repositories/prisma/mappers';
import type { ChatIdentity } from './wa-identity';
import { waEventBus } from './whatsapp-events';

/**
 * Persistência das mensagens que chegam do WhatsApp.
 *
 * Ficou separada do `whatsapp-service` de propósito: o serviço cuida do
 * protocolo (socket, chaves, mídia cifrada) e este módulo cuida do banco. Antes
 * o serviço mexia direto num array em memória, o que deixava toda mensagem real
 * recebida se perder no primeiro reinício.
 *
 * **Toda função aqui recebe `accountId`.** Antes ele vinha de uma constante
 * importada do seed, e o efeito era que toda mensagem real recebida era gravada
 * na conta de demonstração — qualquer que fosse a conta de quem conectou. Agora
 * a conta vem de quem pareou o número (ver `wa-owner.ts`), e na Fase 3 passa a
 * vir da `Inbox`, que é onde ela pertence quando há mais de uma conexão.
 */

const nowIso = (date: Date): string => date.toISOString();

/** Contato já conhecido — da conversa, quando existe, ou da agenda. */
export const findStoredContact = async (
  accountId: string,
  chat: ChatIdentity,
): Promise<Contact | undefined> => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: chat.conversationId, accountId },
    include: { contact: { include: { labels: true } } },
  });
  if (conversation) return contactRow(conversation.contact);
  if (chat.isGroup) return undefined;

  const contact = await prisma.contact.findFirst({
    where: {
      accountId,
      OR: [{ id: chat.contactId }, ...(chat.phone ? [{ phone: chat.phone }] : [])],
    },
    include: { labels: true },
  });
  return contact ? contactRow(contact) : undefined;
};

const upsertContact = async (
  accountId: string,
  contact: Contact,
  isGroup: boolean,
): Promise<void> => {
  const data = {
    name: contact.name,
    phone: contact.phone,
    channel: contact.channel,
    avatarTone: contact.avatarTone,
    customFields: asJson(contact.customFields ?? []),
    kind: isGroup ? 'grupo' : 'pessoa',
    avatarUrl: contact.avatarUrl ?? null,
    participantCount: contact.participantCount ?? null,
  };

  await prisma.contact.upsert({
    where: { id: contact.id },
    create: { ...data, id: contact.id, accountId },
    update: {
      name: data.name,
      avatarUrl: data.avatarUrl,
      participantCount: data.participantCount,
    },
  });
};

export interface CommitInput {
  readonly accountId: string;
  readonly inboxId?: string;
  readonly chat: ChatIdentity;
  readonly contact: Contact;
  readonly message: Message;
  readonly preview: string;
  readonly at: Date;
  readonly fromMe: boolean;
}

/**
 * Anexa a mensagem à conversa (criando-a se preciso) e publica o resultado.
 */
export const commitMessage = async (input: CommitInput): Promise<void> => {
  const { chat, contact, message, preview, at, fromMe } = input;
  const targetInboxId = input.inboxId ?? `ibx-${input.accountId}`;

  // Grava/atualiza o contato em 1 operação atômica (upsert)
  await upsertContact(input.accountId, contact, chat.isGroup);

  const existing = await prisma.conversation.findFirst({
    where: { id: chat.conversationId, accountId: input.accountId },
    select: { id: true, unreadCount: true, status: true, lastInboundAt: true },
  });

  if (existing) {
    try {
      await prisma.$transaction([
        prisma.message.create({
          data: {
            id: message.id,
            conversationId: chat.conversationId,
            author: message.author,
            authorName: message.authorName ?? null,
            contentType: message.content.type,
            content: asJson(message.content),
            time: message.time,
            createdAt: at,
            deliveryStatus: message.deliveryStatus ?? null,
            isPrivate: message.isPrivate,
            externalId: message.externalId ?? null,
            origin: message.origin ?? null,
          },
        }),
        prisma.conversation.update({
          where: { id: chat.conversationId, accountId: input.accountId },
          data: {
            lastMessagePreview: preview,
            lastMessageAt: message.time,
            lastActivityAt: at,
            lastInboundAt: fromMe ? existing.lastInboundAt : nowIso(at),
            unreadCount: fromMe ? undefined : { increment: 1 },
            status: existing.status === 'resolvida' ? 'aberta' : existing.status,
            statusLabel: existing.status === 'resolvida' ? 'Em andamento' : undefined,
            channelThreadId: chat.jid,
            inboxId: targetInboxId,
          },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }

    await publish(input.accountId, 'new_message', chat.conversationId, message);
    return;
  }

  await prisma.conversation.create({
    data: {
      id: chat.conversationId,
      accountId: input.accountId,
      contactId: contact.id,
      channel: 'whatsapp',
      inboxId: targetInboxId,
      queue: chat.isGroup ? 'Grupos' : 'Geral',
      status: 'aberta',
      statusLabel: 'Em andamento',
      priority: 'media',
      unreadCount: fromMe ? 0 : 1,
      lastMessagePreview: preview,
      lastMessageAt: message.time,
      lastActivityAt: at,
      lastInboundAt: fromMe ? null : nowIso(at),
      channelThreadId: chat.jid,
      protocols: asJson([
        {
          code: `#AT-${Math.floor(10000 + Math.random() * 90000)}`,
          date: at.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
          status: 'Em andamento',
        },
      ]),
      messages: {
        create: {
          id: message.id,
          author: message.author,
          authorName: message.authorName ?? null,
          contentType: message.content.type,
          content: asJson(message.content),
          time: message.time,
          createdAt: at,
          deliveryStatus: message.deliveryStatus ?? null,
          isPrivate: message.isPrivate,
          externalId: message.externalId ?? null,
          origin: message.origin ?? null,
        },
      },
    },
  });

  await publish(input.accountId, 'new_conversation', chat.conversationId, message);
};

/** Recibo de entrega/leitura do canal. */
export const applyDeliveryUpdate = async (
  externalId: string,
  deliveryStatus: Message['deliveryStatus'],
): Promise<void> => {
  // O id pode chegar como `externalId` (mensagem que enviamos) ou como o id
  // próprio da mensagem (eco do celular pareado).
  // A conta sai da própria linha, e não de um parâmetro: um recibo chega com um
  // id só, e ir buscar a conta aqui é mais barato — e mais difícil de errar —
  // do que exigir que quem recebeu o recibo já soubesse de qual conta é.
  const row = await prisma.message.findFirst({
    where: { OR: [{ externalId }, { id: externalId }] },
    select: { id: true, conversationId: true, conversation: { select: { accountId: true } } },
  });
  if (!row) return;

  await prisma.message.update({ where: { id: row.id }, data: { deliveryStatus } });

  const updated = await loadConversation(row.conversation.accountId, row.conversationId);
  if (!updated) return;

  const message = updated.timeline.find(
    (item) => item.kind === 'message' && item.message.id === row.id,
  );

  waEventBus.emitConversation({
    type: 'message_updated',
    accountId: row.conversation.accountId,
    conversationId: row.conversationId,
    message: message?.kind === 'message' ? message.message : undefined,
    conversation: updated,
  });
};

/** Nome, foto ou número de participantes mudaram no canal. */
export const patchContact = async (
  conversationId: string,
  patch: {
    readonly name?: string;
    readonly avatarUrl?: string;
    readonly participantCount?: number;
  },
): Promise<void> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      accountId: true,
      contactId: true,
      contact: { select: { name: true, avatarUrl: true, participantCount: true } },
    },
  });
  if (!conversation) return;

  const current = conversation.contact;
  const unchanged =
    (patch.name === undefined || patch.name === current.name) &&
    (patch.avatarUrl === undefined || patch.avatarUrl === current.avatarUrl) &&
    (patch.participantCount === undefined || patch.participantCount === current.participantCount);
  // Publicar um evento sem mudança faria a caixa de entrada se redesenhar à toa.
  if (unchanged) return;

  await prisma.contact.update({
    where: { id: conversation.contactId, accountId: conversation.accountId },
    data: {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.avatarUrl === undefined ? {} : { avatarUrl: patch.avatarUrl }),
      ...(patch.participantCount === undefined ? {} : { participantCount: patch.participantCount }),
    },
  });

  const updated = await loadConversation(conversation.accountId, conversationId);
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      accountId: conversation.accountId,
      conversationId,
      conversation: updated,
    });
  }
};

/** Escopada por conta: um id de outra conta deve responder "não existe". */
export const conversationExists = async (
  accountId: string,
  conversationId: string,
): Promise<boolean> =>
  (await prisma.conversation.count({ where: { id: conversationId, accountId } })) > 0;

const loadConversation = async (
  accountId: string,
  conversationId: string,
): Promise<Conversation | null> => {
  // `findFirst` e nao `findUnique`: o id sozinho e unico, mas a conta e que
  // decide se esta conversa pode ser vista daqui. Os ids do WhatsApp sao
  // derivados do JID (`cv-wa-<jid>`), entao duas contas falando com o mesmo
  // numero geram o mesmo id -- ver a divida anotada na Fase 3.
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    include: CONVERSATION_INCLUDE,
  });
  return row ? conversationRow(row) : null;
};

const publish = async (
  accountId: string,
  type: 'new_message' | 'new_conversation',
  conversationId: string,
  message: Message,
  inboxId?: string,
): Promise<void> => {
  const conversation = await loadConversation(accountId, conversationId);
  waEventBus.emitConversation({
    type,
    accountId,
    conversationId,
    inboxId,
    message,
    conversation: conversation ?? undefined,
  });
};

/**
 * Recupera o conteúdo de uma mensagem enviada anteriormente para atender
 * pedidos de reenvio de decifragem do Baileys (getMessage).
 */
export const findSentMessage = async (
  _inboxId: string,
  key: { id?: string | null },
): Promise<{ conversation: string } | undefined> => {
  if (!key.id) return undefined;
  const msg = await prisma.message.findFirst({
    where: { externalId: key.id },
    select: { content: true },
  });
  if (!msg?.content || typeof msg.content !== 'object') return undefined;
  const content = msg.content as Record<string, unknown>;
  if (content['type'] === 'text' && typeof content['text'] === 'string') {
    return { conversation: content['text'] };
  }
  return undefined;
};

