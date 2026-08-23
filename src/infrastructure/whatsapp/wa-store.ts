import 'server-only';

import type { Contact } from '@/core/domain/contact';
import type { Conversation } from '@/core/domain/conversation';
import type { Message } from '@/core/domain/message';
import { prisma, toJson } from '@/infrastructure/db/prisma';
import {
  CONVERSATION_INCLUDE,
  contactRow,
  conversationRow,
} from '@/infrastructure/repositories/prisma/mappers';
import { ACCOUNT_ID } from '@/infrastructure/seed/workspace';
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
 * A conta é fixa porque a conexão do WhatsApp hoje pertence à instalação, não a
 * um workspace escolhido. Quando houver mais de uma conta conectando o próprio
 * número, o `accountId` passa a vir do pareamento.
 */

const nowIso = (date: Date): string => date.toISOString();

/** Contato já conhecido — da conversa, quando existe, ou da agenda. */
export const findStoredContact = async (chat: ChatIdentity): Promise<Contact | undefined> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: chat.conversationId },
    include: { contact: { include: { labels: true } } },
  });
  if (conversation) return contactRow(conversation.contact);
  if (chat.isGroup) return undefined;

  const contact = await prisma.contact.findFirst({
    where: {
      accountId: ACCOUNT_ID,
      OR: [{ id: chat.contactId }, ...(chat.phone ? [{ phone: chat.phone }] : [])],
    },
    include: { labels: true },
  });
  return contact ? contactRow(contact) : undefined;
};

const upsertContact = async (contact: Contact, isGroup: boolean): Promise<void> => {
  // Grupos nunca entram na agenda de contatos — não são pessoas. Mas precisam
  // existir como linha, porque a conversa referencia um contato.
  const data = {
    accountId: ACCOUNT_ID,
    name: contact.name,
    phone: contact.phone,
    channel: contact.channel,
    avatarTone: contact.avatarTone,
    customFieldsJson: toJson(contact.customFields ?? []),
    kind: isGroup ? 'grupo' : 'pessoa',
    avatarUrl: contact.avatarUrl ?? null,
    participantCount: contact.participantCount ?? null,
  };

  await prisma.contact.upsert({
    where: { id: contact.id },
    create: { id: contact.id, ...data },
    update: {
      name: data.name,
      avatarUrl: data.avatarUrl,
      participantCount: data.participantCount,
    },
  });
};

export interface CommitInput {
  readonly chat: ChatIdentity;
  readonly contact: Contact;
  readonly message: Message;
  readonly preview: string;
  readonly at: Date;
  readonly fromMe: boolean;
}

/**
 * Anexa a mensagem à conversa (criando-a se preciso) e publica o resultado.
 *
 * A checagem de mensagem repetida é por id no banco: o WhatsApp reentrega
 * eventos, e sem isso a mesma mensagem apareceria duas vezes na timeline.
 */
export const commitMessage = async (input: CommitInput): Promise<void> => {
  const { chat, contact, message, preview, at, fromMe } = input;

  await upsertContact(contact, chat.isGroup);

  const existing = await prisma.conversation.findUnique({
    where: { id: chat.conversationId },
    select: { id: true, unreadCount: true, status: true, lastInboundAt: true },
  });

  if (existing) {
    const known = await prisma.message.findUnique({
      where: { id: message.id },
      select: { id: true },
    });
    if (known) return;

    await prisma.$transaction([
      prisma.message.create({
        data: {
          id: message.id,
          conversationId: chat.conversationId,
          author: message.author,
          authorName: message.authorName ?? null,
          contentType: message.content.type,
          contentJson: toJson(message.content),
          time: message.time,
          createdAt: at,
          deliveryStatus: message.deliveryStatus ?? null,
          isPrivate: message.isPrivate,
          externalId: message.externalId ?? null,
          origin: message.origin ?? null,
        },
      }),
      prisma.conversation.update({
        where: { id: chat.conversationId },
        data: {
          lastMessagePreview: preview,
          lastMessageAt: message.time,
          lastActivityAt: at,
          lastInboundAt: fromMe ? existing.lastInboundAt : nowIso(at),
          unreadCount: fromMe ? existing.unreadCount : existing.unreadCount + 1,
          // Mensagem nova reabre um atendimento encerrado: o cliente voltou.
          status: existing.status === 'resolvida' ? 'aberta' : existing.status,
          statusLabel: existing.status === 'resolvida' ? 'Em andamento' : undefined,
          channelThreadId: chat.jid,
        },
      }),
    ]);

    await publish('new_message', chat.conversationId, message);
    return;
  }

  await prisma.conversation.create({
    data: {
      id: chat.conversationId,
      accountId: ACCOUNT_ID,
      contactId: contact.id,
      channel: 'whatsapp',
      inboxId: 'ibx-wa-oficial',
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
      protocolsJson: toJson([
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
          contentJson: toJson(message.content),
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

  await publish('new_conversation', chat.conversationId, message);
};

/** Recibo de entrega/leitura do canal. */
export const applyDeliveryUpdate = async (
  externalId: string,
  deliveryStatus: Message['deliveryStatus'],
): Promise<void> => {
  // O id pode chegar como `externalId` (mensagem que enviamos) ou como o id
  // próprio da mensagem (eco do celular pareado).
  const row = await prisma.message.findFirst({
    where: { OR: [{ externalId }, { id: externalId }] },
    select: { id: true, conversationId: true },
  });
  if (!row) return;

  await prisma.message.update({ where: { id: row.id }, data: { deliveryStatus } });

  const updated = await loadConversation(row.conversationId);
  if (!updated) return;

  const message = updated.timeline.find(
    (item) => item.kind === 'message' && item.message.id === row.id,
  );

  waEventBus.emitConversation({
    type: 'message_updated',
    conversationId: row.conversationId,
    message: message?.kind === 'message' ? message.message : undefined,
    conversation: updated,
  });
};

/** Nome, foto ou número de participantes mudaram no canal. */
export const patchContact = async (
  conversationId: string,
  patch: { readonly name?: string; readonly avatarUrl?: string; readonly participantCount?: number },
): Promise<void> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { contactId: true, contact: { select: { name: true, avatarUrl: true, participantCount: true } } },
  });
  if (!conversation) return;

  const current = conversation.contact;
  const unchanged =
    (patch.name === undefined || patch.name === current.name) &&
    (patch.avatarUrl === undefined || patch.avatarUrl === current.avatarUrl) &&
    (patch.participantCount === undefined ||
      patch.participantCount === current.participantCount);
  // Publicar um evento sem mudança faria a caixa de entrada se redesenhar à toa.
  if (unchanged) return;

  await prisma.contact.update({
    where: { id: conversation.contactId },
    data: {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.avatarUrl === undefined ? {} : { avatarUrl: patch.avatarUrl }),
      ...(patch.participantCount === undefined
        ? {}
        : { participantCount: patch.participantCount }),
    },
  });

  const updated = await loadConversation(conversationId);
  if (updated) {
    waEventBus.emitConversation({
      type: 'conversation_updated',
      conversationId,
      conversation: updated,
    });
  }
};

export const conversationExists = async (conversationId: string): Promise<boolean> =>
  (await prisma.conversation.count({ where: { id: conversationId } })) > 0;

const loadConversation = async (conversationId: string): Promise<Conversation | null> => {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: CONVERSATION_INCLUDE,
  });
  return row ? conversationRow(row) : null;
};

const publish = async (
  type: 'new_message' | 'new_conversation',
  conversationId: string,
  message: Message,
): Promise<void> => {
  const conversation = await loadConversation(conversationId);
  waEventBus.emitConversation({
    type,
    conversationId,
    message,
    conversation: conversation ?? undefined,
  });
};
