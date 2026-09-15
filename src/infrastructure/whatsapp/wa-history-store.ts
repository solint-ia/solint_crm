import type { Message, MessageContent } from '@/core/domain/message';
import { asJson, prisma } from '@/infrastructure/db/prisma';
import type { ChatIdentity } from './wa-identity';
import { temNomeDeVerdade } from './wa-format';

export interface SealedPendingMedia {
  readonly kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly cipher: Buffer;
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly keyId: string;
}

export interface HistoryCommitItem {
  readonly chat: ChatIdentity;
  readonly contactName: string;
  /**
   * `contactName` identifica a pessoa (agenda, conversa ou perfil), e não é o
   * telefone de reserva. Só um nome de verdade substitui o de um cadastro que
   * ainda não tem nome.
   */
  readonly contactNameIsReal?: boolean;
  readonly message: Message;
  readonly preview: string;
  readonly at: Date;
  readonly pendingMedia?: SealedPendingMedia;
}

export interface HistoryCommitReport {
  readonly messages: number;
  readonly duplicates: number;
  readonly conversationsCreated: number;
  readonly conversationsUpdated: number;
  readonly conversationIds: readonly string[];
  readonly mediaPending: number;
}

const threadVariants = (chat: ChatIdentity): string[] => {
  const values = new Set([chat.jid]);
  const digits = chat.phone.replace(/\D/g, '');
  if (digits) values.add(`${digits}@s.whatsapp.net`);
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    values.add(`${digits.slice(0, 4)}${digits.slice(5)}@s.whatsapp.net`);
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    values.add(`${digits.slice(0, 4)}9${digits.slice(4)}@s.whatsapp.net`);
  }
  return [...values];
};

/**
 * Reaproveita uma conversa de outra caixa somente quando o próprio bloco prova
 * que ela é a mesma: ao menos um externalId já existe naquela timeline.
 */
export const resolveHistoryConversation = async (
  accountId: string,
  inboxId: string,
  chat: ChatIdentity,
  externalIds: readonly string[],
): Promise<{ id: string; contactId: string; exists: boolean }> => {
  const current = await prisma.conversation.findFirst({
    where: {
      accountId,
      inboxId,
      OR: [
        { id: chat.conversationId },
        { channelThreadId: { in: threadVariants(chat) } },
        ...(chat.phone ? [{ contact: { phone: chat.phone } }] : []),
      ],
    },
    select: { id: true, contactId: true },
    orderBy: { lastActivityAt: 'desc' },
  });
  if (current) return { ...current, exists: true };

  if (externalIds.length > 0) {
    const moved = await prisma.conversation.findFirst({
      where: {
        accountId,
        inboxId: { not: inboxId },
        OR: [
          { channelThreadId: { in: threadVariants(chat) } },
          ...(chat.phone ? [{ contact: { phone: chat.phone } }] : []),
        ],
        messages: { some: { externalId: { in: [...externalIds] } } },
      },
      select: { id: true, contactId: true },
      orderBy: { lastActivityAt: 'desc' },
    });
    if (moved) return { ...moved, exists: true };
  }

  const knownContact = chat.phone
    ? await prisma.contact.findFirst({
        where: {
          accountId,
          OR: [{ phone: chat.phone }, { extraPhones: { has: chat.phone } }],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    : null;
  return {
    id: chat.conversationId,
    contactId: knownContact?.id ?? chat.contactId,
    exists: false,
  };
};

const ensureContactFromHistory = async (
  accountId: string,
  chat: ChatIdentity,
  contactId: string,
  name: string,
  nameIsReal: boolean,
  newestAt: Date,
): Promise<void> => {
  const fallback = chat.phone || chat.key;
  const desiredName = name.trim() || fallback;
  const existing = await prisma.contact.findFirst({
    where: { id: contactId, accountId },
    select: { name: true, phone: true, lastContactAt: true },
  });
  if (!existing) {
    await prisma.contact.create({
      data: {
        id: contactId,
        accountId,
        name: desiredName,
        phone: chat.phone,
        channel: 'whatsapp',
        avatarTone: 'emerald',
        origin: 'whatsapp',
        kind: 'pessoa',
        lastContactAt: newestAt.toISOString(),
      },
    });
    return;
  }

  const priorAt = existing.lastContactAt ? new Date(existing.lastContactAt) : null;
  await prisma.contact.updateMany({
    where: { id: contactId, accountId },
    data: {
      // Histórico não ressuscita contato arquivado nem troca um nome escolhido.
      // Só preenche quem ainda não tem nome de verdade, e só com um nome de
      // verdade: trocar um número por outro número não informa nada.
      ...(nameIsReal && !temNomeDeVerdade(existing) ? { name: desiredName } : {}),
      ...(!priorAt || Number.isNaN(priorAt.getTime()) || priorAt < newestAt
        ? { lastContactAt: newestAt.toISOString() }
        : {}),
    },
  });
};

const insertIntoExisting = async (
  accountId: string,
  inboxId: string,
  conversationId: string,
  items: readonly HistoryCommitItem[],
): Promise<{ inserted: number; updated: boolean; mediaPending: number }> =>
  prisma.$transaction(async (tx) => {
    const newest = items[items.length - 1]!;
    const created = await tx.message.createMany({
      data: items.map(({ message, at }) => ({
        id: message.id,
        conversationId,
        author: message.author,
        authorName: message.authorName ?? null,
        contentType: message.content.type,
        content: asJson(message.content),
        time: message.time,
        createdAt: at,
        deliveryStatus: message.deliveryStatus ?? null,
        isPrivate: false,
        externalId: message.externalId ?? null,
        origin: 'historico',
        senderJid: message.senderJid ?? null,
      })),
      skipDuplicates: true,
    });
    const pendingCandidates = items.filter((item) => item.pendingMedia);
    const pendingRows =
      pendingCandidates.length > 0
        ? await tx.message.findMany({
            where: {
              id: { in: pendingCandidates.map((item) => item.message.id) },
              conversationId,
              origin: 'historico',
              content: { path: ['type'], equals: 'pending_media' },
              pendingMedia: null,
            },
            select: { id: true },
          })
        : [];
    const eligiblePending = new Set(pendingRows.map((row) => row.id));
    const pending = pendingCandidates.filter((item) => eligiblePending.has(item.message.id));
    const media = await tx.pendingMedia.createMany({
      data: pending.map((item) => ({
        messageId: item.message.id,
        accountId,
        inboxId,
        kind: item.pendingMedia!.kind,
        mimeType: item.pendingMedia!.mimeType,
        sizeBytes: item.pendingMedia!.sizeBytes,
        cipher: new Uint8Array(item.pendingMedia!.cipher),
        iv: new Uint8Array(item.pendingMedia!.iv),
        tag: new Uint8Array(item.pendingMedia!.tag),
        keyId: item.pendingMedia!.keyId,
      })),
      skipDuplicates: true,
    });
    const updated = await tx.conversation.updateMany({
      where: {
        id: conversationId,
        accountId,
        OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: newest.at } }],
      },
      data: {
        lastMessagePreview: newest.preview,
        lastMessageAt: newest.message.time,
        lastActivityAt: newest.at,
      },
    });
    return { inserted: created.count, updated: updated.count > 0, mediaPending: media.count };
  });

/**
 * Caminho deliberadamente calado. Não chama webhooks, automações, compliance,
 * respostas automáticas, SLA, protocolos, notificações nem eventos por mensagem.
 */
export const commitHistoryBatch = async (
  accountId: string,
  inboxId: string,
  input: readonly HistoryCommitItem[],
  now = new Date(),
): Promise<HistoryCommitReport> => {
  const groups = new Map<string, HistoryCommitItem[]>();
  for (const item of input) {
    const key = item.chat.jid;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  let messages = 0;
  let duplicates = 0;
  let conversationsCreated = 0;
  let conversationsUpdated = 0;
  let mediaPending = 0;
  const conversationIds = new Set<string>();

  for (const unsorted of groups.values()) {
    const items = [...unsorted].sort(
      (a, b) => a.at.getTime() - b.at.getTime() || a.message.id.localeCompare(b.message.id),
    );
    const first = items[0]!;
    const newest = items[items.length - 1]!;
    const externalIds = items.flatMap((item) =>
      item.message.externalId ? [item.message.externalId] : [],
    );
    const resolved = await resolveHistoryConversation(accountId, inboxId, first.chat, externalIds);
    // O nome vem do primeiro item que traga um de verdade, e não do mais antigo:
    // a mensagem mais antiga de uma conversa costuma ser nossa, e ela não tem
    // nome do contato nenhum.
    const nomeado = items.find((item) => item.contactNameIsReal) ?? first;
    await ensureContactFromHistory(
      accountId,
      first.chat,
      resolved.contactId,
      nomeado.contactName,
      Boolean(nomeado.contactNameIsReal),
      newest.at,
    );

    let exists = resolved.exists;
    if (!exists) {
      try {
        const newestIsRecentInbound =
          newest.message.author === 'contact' &&
          newest.at.getTime() >= now.getTime() - 24 * 60 * 60 * 1000;
        await prisma.conversation.create({
          data: {
            id: resolved.id,
            accountId,
            contactId: resolved.contactId,
            channel: 'whatsapp',
            inboxId,
            queue: 'Geral',
            status: newestIsRecentInbound ? 'aberta' : 'resolvida',
            statusLabel: newestIsRecentInbound ? 'Em andamento' : 'Histórico importado',
            createdAt: first.at,
            importedAt: now,
            priority: 'baixa',
            unreadCount: 0,
            lastMessagePreview: newest.preview,
            lastMessageAt: newest.message.time,
            lastActivityAt: newest.at,
            lastInboundAt: null,
            channelThreadId: first.chat.jid,
            protocols: asJson([]),
          },
        });
        conversationsCreated += 1;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'P2002') throw error;
        exists = true;
      }
    }

    const target = exists
      ? await resolveHistoryConversation(accountId, inboxId, first.chat, externalIds)
      : { id: resolved.id };
    const result = await insertIntoExisting(accountId, inboxId, target.id, items);
    messages += result.inserted;
    duplicates += items.length - result.inserted;
    mediaPending += result.mediaPending;
    if (exists && result.updated) conversationsUpdated += 1;
    conversationIds.add(target.id);
  }

  return {
    messages,
    duplicates,
    conversationsCreated,
    conversationsUpdated,
    conversationIds: [...conversationIds],
    mediaPending,
  };
};

export const pendingContent = (media: {
  readonly kind: SealedPendingMedia['kind'];
  readonly mimeType: string;
  readonly fileLength: number;
  readonly caption?: string;
  readonly fileName?: string;
  readonly duration?: string;
  readonly jpegThumbnail?: Uint8Array;
}): MessageContent => {
  const thumb =
    media.jpegThumbnail && media.jpegThumbnail.byteLength <= 6 * 1024
      ? `data:image/jpeg;base64,${Buffer.from(media.jpegThumbnail).toString('base64')}`
      : undefined;
  return {
    type: 'pending_media',
    kind: media.kind,
    mimeType: media.mimeType,
    sizeBytes: media.fileLength,
    ...(media.caption ? { caption: media.caption } : {}),
    ...(media.fileName ? { fileName: media.fileName } : {}),
    ...(media.duration ? { duration: media.duration } : {}),
    ...(thumb ? { thumb } : {}),
  };
};
