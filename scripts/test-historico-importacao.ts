/** Teste de integração da persistência silenciosa do histórico. */
import { randomUUID } from 'node:crypto';
import { proto, type WAMessage } from '@whiskeysockets/baileys';
import { defaultBusinessHours } from '../src/core/domain/business-hours';
import { prisma, asJson } from '../src/infrastructure/db/prisma';
import { open, seal } from '../src/infrastructure/whatsapp/auth/crypto';
import type { ChatIdentity } from '../src/infrastructure/whatsapp/wa-identity';
import { commitHistoryBatch } from '../src/infrastructure/whatsapp/wa-history-store';
import { HistoryImporter } from '../src/infrastructure/whatsapp/worker/history-import';

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
if (database.hostname !== 'localhost' && database.hostname !== '127.0.0.1') {
  throw new Error('Este teste só roda em PostgreSQL descartável no localhost.');
}

const suffix = randomUUID().slice(0, 8);
const accountId = `acc-history-${suffix}`;
const inboxId = `ibx-history-${suffix}`;
const phone = `+5599900${suffix.replace(/\D/g, '').padEnd(6, '0').slice(0, 6)}`;
const digits = phone.slice(1);
const chat: ChatIdentity = {
  jid: `${digits}@s.whatsapp.net`,
  isGroup: false,
  phone,
  key: digits,
  contactId: `ct-wa-${accountId}-${digits}`,
  conversationId: `cv-wa-${inboxId}-${digits}`,
};
const failures: string[] = [];
const check = (label: string, condition: boolean) => {
  console.log(`${condition ? 'OK   ' : 'FALHA'} ${label}`);
  if (!condition) failures.push(label);
};
const waText = (id: string, text: string, at: Date): WAMessage => ({
  key: { id, remoteJid: chat.jid, fromMe: false },
  messageTimestamp: Math.floor(at.getTime() / 1000),
  message: { conversation: text },
  pushName: 'Contato Histórico',
});

const main = async () => {
  await prisma.account.create({
    data: { id: accountId, name: `Histórico ${suffix}`, plan: 'starter' },
  });
  await prisma.inbox.create({
    data: {
      id: inboxId,
      accountId,
      name: 'Caixa histórico',
      channel: 'whatsapp',
      identifier: chat.jid,
      status: 'conectado',
      provider: 'baileys',
      businessHours: asJson(defaultBusinessHours()),
      awayMessage: asJson({ enabled: false, message: '' }),
      greeting: asJson({ enabled: false, message: '' }),
    },
  });

  try {
    const now = new Date('2026-09-15T12:00:00.000Z');
    const importer = new HistoryImporter({
      accountId,
      inboxId,
      cutoff: new Date(now.getTime() - 7 * 86_400_000),
      now: () => now,
      resolveIdentity: async () => chat,
    });
    await importer.enqueue({
      syncType: proto.HistorySync.HistorySyncType.RECENT,
      progress: 100,
      messages: [
        waText('old', 'fora do corte', new Date(now.getTime() - 8 * 86_400_000)),
        waText('recent', 'mensagem recente', new Date(now.getTime() - 60 * 60_000)),
        { ...waText('group', 'grupo', now), key: { id: 'group', remoteJid: '120@g.us' } },
      ],
    });
    await importer.drain();

    const created = await prisma.conversation.findUnique({
      where: { id: chat.conversationId },
      include: { messages: true },
    });
    check('mensagem anterior ao corte foi descartada', importer.stats.foraDoPrazo === 1);
    check('grupo foi ignorado', importer.stats.grupos === 1);
    check('conversa nova ficou sem não lidas', created?.unreadCount === 0);
    check('conversa recente de entrada ficou aberta', created?.status === 'aberta');
    check('conversa foi marcada como importada', created?.importedAt?.getTime() === now.getTime());
    check(
      'nenhum protocolo foi aberto',
      Array.isArray(created?.protocols) && created.protocols.length === 0,
    );
    check('nenhum SLA foi criado', created?.slaDeadlineAt == null);
    check('somente uma mensagem foi persistida', created?.messages.length === 1);

    await importer.enqueue({
      syncType: proto.HistorySync.HistorySyncType.RECENT,
      progress: 100,
      messages: [waText('recent', 'mensagem recente', new Date(now.getTime() - 60 * 60_000))],
    });
    await importer.drain();
    check(
      'reprocessar o bloco não duplica mensagens',
      (await prisma.message.count({ where: { conversationId: chat.conversationId } })) === 1,
    );

    const mediaMessageId = `msg-wa-${chat.conversationId}-media`;
    const mediaProto = Buffer.from(
      proto.WebMessageInfo.encode(
        proto.WebMessageInfo.create({
          key: { id: 'media', remoteJid: chat.jid, fromMe: false },
          messageTimestamp: Math.floor(now.getTime() / 1000),
          message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 123 } },
        }),
      ).finish(),
    );
    await commitHistoryBatch(
      accountId,
      inboxId,
      [
        {
          chat,
          contactName: 'Contato Histórico',
          at: new Date(now.getTime() - 30 * 60_000),
          preview: 'Foto',
          message: {
            id: mediaMessageId,
            conversationId: chat.conversationId,
            externalId: 'media',
            author: 'contact',
            isPrivate: false,
            origin: 'historico',
            content: {
              type: 'pending_media',
              kind: 'image',
              mimeType: 'image/jpeg',
              sizeBytes: 123,
            },
            createdAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
            time: '11:30',
          },
          pendingMedia: {
            kind: 'image',
            mimeType: 'image/jpeg',
            sizeBytes: 123,
            ...seal(mediaProto, mediaMessageId),
          },
        },
      ],
      now,
    );
    const pending = await prisma.pendingMedia.findUnique({ where: { messageId: mediaMessageId } });
    check('mídia importada fica pendente sem download', pending?.status === 'pendente');
    check(
      'referência de mídia cifrada abre para o proto original',
      Boolean(
        pending &&
        open(Buffer.from(pending.cipher), Buffer.from(pending.iv), Buffer.from(pending.tag), {
          aad: mediaMessageId,
          keyId: pending.keyId,
        }).equals(mediaProto),
      ),
    );

    await prisma.conversation.update({
      where: { id: chat.conversationId },
      data: {
        status: 'resolvida',
        resolvedAt: now,
        csatScore: 5,
        unreadCount: 7,
        lastMessagePreview: 'atividade atual',
        lastActivityAt: now,
      },
    });
    const olderAt = new Date(now.getTime() - 2 * 60 * 60_000);
    await commitHistoryBatch(
      accountId,
      inboxId,
      [
        {
          chat,
          contactName: 'Nome que não deve substituir',
          at: olderAt,
          preview: 'mais velha',
          message: {
            id: `msg-wa-${chat.conversationId}-older`,
            conversationId: chat.conversationId,
            externalId: 'older',
            author: 'contact',
            isPrivate: false,
            authorName: 'Contato Histórico',
            origin: 'historico',
            content: { type: 'text', text: 'mais velha' },
            createdAt: olderAt.toISOString(),
            time: '10:00',
          },
        },
      ],
      now,
    );
    const unchanged = await prisma.conversation.findUnique({ where: { id: chat.conversationId } });
    check('histórico não reabre conversa existente', unchanged?.status === 'resolvida');
    check(
      'histórico preserva CSAT e resolução',
      unchanged?.csatScore === 5 && unchanged.resolvedAt?.getTime() === now.getTime(),
    );
    check('histórico preserva não lidas', unchanged?.unreadCount === 7);
    check(
      'mensagem mais velha não troca a prévia',
      unchanged?.lastMessagePreview === 'atividade atual',
    );
    check(
      'não cria webhook',
      (await prisma.webhookEventOutbox.count({ where: { accountId } })) === 0,
    );
    check(
      'não cria notificação',
      (await prisma.notification.count({ where: { accountId } })) === 0,
    );
  } finally {
    await prisma.account.deleteMany({ where: { id: accountId } });
    await prisma.$disconnect();
  }

  if (failures.length > 0) throw new Error(`Falharam: ${failures.join(', ')}`);
  console.log('Histórico: testes concluídos.');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
