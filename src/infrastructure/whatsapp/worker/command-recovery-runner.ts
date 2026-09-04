import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { prisma, readJson } from '@/infrastructure/db/prisma';

const SWEEP_MS = 15_000;
const ORPHAN_AGE_MS = 30_000;

type StoredContent = {
  readonly type?: string;
  readonly text?: string;
  readonly url?: string;
  readonly caption?: string;
  readonly mimeType?: string;
  readonly fileName?: string;
  readonly voice?: boolean;
};

/**
 * Fecha a pequena janela entre gravar a bolha e enfileirar o envio nas rotas
 * HTTP. Se o processo web cair nesse intervalo, o worker reconstrói a intenção.
 */
export class CommandRecoveryRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private sweeping = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
    void this.sweep();
  }

  private async sweep(): Promise<void> {
    if (!this.running || this.sweeping) return;
    this.sweeping = true;
    try {
      const messages = await prisma.message.findMany({
        where: {
          deliveryStatus: 'enviando',
          isPrivate: false,
          createdAt: { lt: new Date(Date.now() - ORPHAN_AGE_MS) },
          conversation: { channel: 'whatsapp' },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          id: true,
          conversationId: true,
          content: true,
          contentType: true,
          conversation: {
            select: {
              accountId: true,
              inboxId: true,
              channelThreadId: true,
              contact: { select: { phone: true } },
            },
          },
        },
      });

      for (const message of messages) {
        const idempotencyKey = `message:${message.id}`;
        const existing = await prisma.whatsAppCommand.findUnique({
          where: { idempotencyKey },
          select: { id: true, status: true, error: true },
        });
        if (existing?.status === 'pending' || existing?.status === 'processing') continue;
        if (existing) {
          if (existing.status === 'failed') {
            await prisma.message.updateMany({
              where: { id: message.id, deliveryStatus: 'enviando' },
              data: {
                deliveryStatus: 'falha',
                dispatchError: existing.error ?? 'O comando de envio falhou.',
              },
            });
          }
          continue;
        }

        const content = readJson<StoredContent>(message.content, {});
        const basePayload = {
          recipient: {
            channelThreadId: message.conversation.channelThreadId ?? undefined,
            phone: message.conversation.contact.phone ?? undefined,
          },
          accountId: message.conversation.accountId,
          conversationId: message.conversationId,
          messageId: message.id,
        };

        let kind: 'send' | 'send_media';
        let payload: object;
        if (content.type === 'text' || content.type === 'template') {
          if (!content.text?.trim()) {
            await this.fail(message.id, 'Mensagem órfã sem texto para reconstruir o envio.');
            continue;
          }
          kind = 'send';
          payload = { ...basePayload, content: { text: content.text } };
        } else if (['image', 'video', 'audio', 'document'].includes(content.type ?? '')) {
          const mediaId = content.url?.split('/').filter(Boolean).pop();
          if (!mediaId) {
            await this.fail(
              message.id,
              'Mensagem órfã sem mídia persistida para reconstruir o envio.',
            );
            continue;
          }
          kind = 'send_media';
          payload = {
            ...basePayload,
            media: {
              kind: content.type,
              mediaId,
              mimeType: content.mimeType ?? 'application/octet-stream',
              ...(content.fileName ? { fileName: content.fileName } : {}),
              ...(content.caption ? { caption: content.caption } : {}),
              ...(content.voice ? { voice: true } : {}),
            },
          };
        } else {
          await this.fail(
            message.id,
            `Tipo ${message.contentType} não pode ser reconstruído automaticamente.`,
          );
          continue;
        }

        const command = await prisma.whatsAppCommand.upsert({
          where: { idempotencyKey },
          create: {
            inboxId: message.conversation.inboxId,
            kind,
            payload,
            status: 'pending',
            idempotencyKey,
          },
          update: {},
          select: { id: true },
        });
        await postgresPubSub.publish(CHANNELS.COMMANDS, {
          id: command.id,
          inboxId: message.conversation.inboxId,
          kind,
          recovered: true,
        });
      }
    } catch (error) {
      console.warn('[CommandRecovery] Falha ao recuperar envios órfãos:', error);
    } finally {
      this.sweeping = false;
    }
  }

  private async fail(messageId: string, error: string): Promise<void> {
    await prisma.message.updateMany({
      where: { id: messageId, deliveryStatus: 'enviando' },
      data: { deliveryStatus: 'falha', dispatchError: error },
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.sweeping) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
