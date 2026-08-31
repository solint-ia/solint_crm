import { prisma } from '@/infrastructure/db/prisma';
import { horaLabel } from '@/lib/datetime';

export interface AutoMessageOptions {
  readonly accountId: string;
  readonly inboxId: string;
  readonly conversationId: string;
  readonly recipient: {
    readonly channelThreadId?: string | null;
    readonly phone: string;
  };
  readonly text: string;
  readonly origin?: 'saudacao' | 'ausencia' | 'encerramento' | 'automacao';
  readonly authorName?: string;
}

/**
 * Envia uma mensagem automática (saudação, ausência, encerramento ou automação de regra).
 *
 * A mensagem é registrada no banco como mensagem pública (visível na timeline do
 * CRM e enviada ao cliente), despachada para o canal de WhatsApp (via Queue ou InProcess)
 * e emitida no barramento em tempo real.
 */
export async function dispatchAutoMessage({
  accountId,
  inboxId,
  conversationId,
  recipient,
  text,
  origin = 'automacao',
  authorName = 'Atendimento Automático',
}: AutoMessageOptions) {
  if (!text || !text.trim()) return null;

  const cleanText = text.trim();
  const messageId = `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const time = horaLabel(new Date());

  const created = await prisma.message.create({
    data: {
      id: messageId,
      conversationId,
      author: 'system',
      authorName,
      contentType: 'texto',
      content: { type: 'texto', text: cleanText },
      time,
      isPrivate: false,
      origin,
    },
  });

  await prisma.conversation.updateMany({
    where: { id: conversationId, accountId },
    data: {
      lastMessagePreview: cleanText,
      lastMessageAt: time,
      lastActivityAt: new Date(),
    },
  });

  // Despacho no canal WhatsApp
  try {
    if (process.env.SOLINT_WORKER === '1') {
      // Dentro do worker: enfileira o comando direto
      const { CHANNELS, postgresPubSub } = await import('@/infrastructure/db/postgres-pubsub');
      const command = await prisma.whatsAppCommand.create({
        data: {
          inboxId,
          kind: 'send',
          payload: {
            recipient: {
              channelThreadId: recipient.channelThreadId ?? undefined,
              phone: recipient.phone,
            },
            content: { text: cleanText },
            accountId,
            conversationId,
            messageId: created.id,
          },
          status: 'pending',
        },
      });
      await postgresPubSub.publish(CHANNELS.COMMANDS, {
        inboxId,
        kind: 'send',
        id: command.id,
      });
    } else {
      // Dentro do servidor Next.js
      const { getWhatsAppChannel } = await import('./channel-provider');
      const channel = await getWhatsAppChannel();
      await channel.sendText(
        {
          accountId,
          conversationId,
          messageId: created.id,
          inboxId,
        },
        {
          channelThreadId: recipient.channelThreadId ?? undefined,
          phone: recipient.phone,
        },
        cleanText,
      );
    }
  } catch (error) {
    console.warn('[auto-reply] Falha ao despachar mensagem automática para o WhatsApp:', error);
  }

  // Notificação para o barramento de eventos em tempo real
  try {
    const { waEventBus } = await import('./whatsapp-events');
    waEventBus.emitConversation({
      type: 'new_message',
      accountId,
      conversationId,
      inboxId,
      messageId: created.id,
      message: {
        id: created.id,
        conversationId,
        author: 'system',
        authorName,
        contentType: 'texto',
        content: { type: 'texto', text: cleanText },
        time,
        createdAt: created.createdAt,
        isPrivate: false,
        origin,
      },
    });
  } catch (error) {
    console.warn('[auto-reply] Falha ao emitir evento em tempo real:', error);
  }

  return created;
}
