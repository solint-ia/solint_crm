import {
  isJidGroup,
  isLidUser,
  normalizeMessageContent,
  proto,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Message } from '@/core/domain/message';
import { seal } from '../auth/crypto';
import { isSupportedChatJid, type ChatIdentity } from '../wa-identity';
import {
  decodeWaMessage,
  deliveryStatusFrom,
  timestampOf,
  type MediaRef,
} from '../wa-message-content';
import { timeLabel } from '../wa-format';
import {
  commitHistoryBatch,
  pendingContent,
  type HistoryCommitItem,
  type HistoryCommitReport,
} from '../wa-history-store';

export interface HistoryImportStats {
  conversasCriadas: number;
  conversasAtualizadas: number;
  mensagens: number;
  duplicadas: number;
  foraDoPrazo: number;
  grupos: number;
  lidSemTelefone: number;
  midiasPendentes: number;
  progresso: number;
  falhas: number;
}

export interface HistoryBlock {
  readonly chats?: readonly {
    readonly id?: string | null;
    readonly pnJid?: string | null;
    readonly lidJid?: string | null;
    readonly name?: string | null;
    readonly displayName?: string | null;
  }[];
  readonly messages?: readonly WAMessage[];
  readonly syncType?: number | null;
  readonly progress?: number | null;
  readonly peerDataRequestSessionId?: string | null;
}

export interface HistoryImporterDependencies {
  readonly accountId: string;
  readonly inboxId: string;
  readonly cutoff: Date;
  readonly resolveIdentity: (message: WAMessage) => Promise<ChatIdentity | null>;
  readonly decode?: typeof decodeWaMessage;
  readonly now?: () => Date;
  readonly onBatch?: (
    report: HistoryCommitReport,
    stats: Readonly<HistoryImportStats>,
  ) => Promise<void> | void;
}

const acceptedSyncType = (syncType: number | null | undefined): boolean =>
  syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP ||
  syncType === proto.HistorySync.HistorySyncType.RECENT ||
  syncType === proto.HistorySync.HistorySyncType.FULL;

const mediaSubmessage = (message: WAMessage, kind: MediaRef['kind']) => {
  const content = normalizeMessageContent(message.message);
  if (!content) return undefined;
  switch (kind) {
    case 'image':
      return content.imageMessage ? { imageMessage: content.imageMessage } : undefined;
    case 'video':
      return content.videoMessage ? { videoMessage: content.videoMessage } : undefined;
    case 'audio':
      return content.audioMessage ? { audioMessage: content.audioMessage } : undefined;
    case 'document':
      return content.documentMessage ? { documentMessage: content.documentMessage } : undefined;
    case 'sticker':
      return content.stickerMessage ? { stickerMessage: content.stickerMessage } : undefined;
  }
};

const initialStats = (): HistoryImportStats => ({
  conversasCriadas: 0,
  conversasAtualizadas: 0,
  mensagens: 0,
  duplicadas: 0,
  foraDoPrazo: 0,
  grupos: 0,
  lidSemTelefone: 0,
  midiasPendentes: 0,
  progresso: 0,
  falhas: 0,
});

export class HistoryImporter {
  private readonly dependencies: HistoryImporterDependencies;
  private readonly decode: typeof decodeWaMessage;
  private readonly now: () => Date;
  private lane: Promise<void> = Promise.resolve();
  private pendingBlocks = 0;
  private stopped = false;
  private statsValue = initialStats();

  constructor(dependencies: HistoryImporterDependencies) {
    this.dependencies = dependencies;
    this.decode = dependencies.decode ?? decodeWaMessage;
    this.now = dependencies.now ?? (() => new Date());
  }

  get stats(): Readonly<HistoryImportStats> {
    return this.statsValue;
  }

  stop(): void {
    this.stopped = true;
  }

  async drain(): Promise<void> {
    await this.lane;
  }

  async enqueue(block: HistoryBlock, options: { onDemand?: boolean } = {}): Promise<void> {
    const onDemand = options.onDemand === true;
    if (
      this.stopped ||
      (!onDemand && !acceptedSyncType(block.syncType)) ||
      (onDemand && block.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND)
    )
      return;
    // Teto real de memória: ao atingir vinte blocos, o listener espera a raia
    // esvaziar antes de aceitar mais um.
    const filtered: WAMessage[] = [];
    for (const message of block.messages ?? []) {
      const jid = message.key.remoteJid;
      if (!message.message || !isSupportedChatJid(jid)) continue;
      if (isJidGroup(jid) || jid.endsWith('@g.us')) {
        this.statsValue = { ...this.statsValue, grupos: this.statsValue.grupos + 1 };
        continue;
      }
      if (!onDemand && new Date(timestampOf(message)) < this.dependencies.cutoff) {
        this.statsValue = { ...this.statsValue, foraDoPrazo: this.statsValue.foraDoPrazo + 1 };
        continue;
      }
      filtered.push(message);
    }
    const prepared = { ...block, messages: filtered };

    if (this.pendingBlocks >= 20) await this.lane;
    if (this.stopped) return;
    this.pendingBlocks += 1;
    this.lane = this.lane
      .then(() => this.processBlock(prepared))
      .catch((error) => {
        this.statsValue = { ...this.statsValue, falhas: this.statsValue.falhas + 1 };
        console.error('[HistoryImporter] Falha em bloco:', error);
      })
      .finally(() => {
        this.pendingBlocks -= 1;
      });
  }

  private async processBlock(block: HistoryBlock): Promise<void> {
    if (this.stopped) return;
    const names = new Map<string, string>();
    for (const chat of block.chats ?? []) {
      const name = chat.name?.trim() || chat.displayName?.trim();
      if (!name) continue;
      if (chat.id) names.set(chat.id, name);
      if (chat.pnJid) names.set(chat.pnJid, name);
      if (chat.lidJid) names.set(chat.lidJid, name);
    }

    const accepted = [...(block.messages ?? [])].sort((a, b) => timestampOf(a) - timestampOf(b));
    for (let offset = 0; offset < accepted.length; offset += 200) {
      if (this.stopped) return;
      const input: HistoryCommitItem[] = [];
      for (const raw of accepted.slice(offset, offset + 200)) {
        const externalId = raw.key.id;
        if (!externalId) continue;
        const chat = await this.dependencies.resolveIdentity(raw);
        if (!chat || chat.isGroup) continue;
        if (!chat.phone && (isLidUser(chat.jid) || chat.jid.endsWith('@lid'))) {
          this.statsValue = {
            ...this.statsValue,
            lidSemTelefone: this.statsValue.lidSemTelefone + 1,
          };
          continue;
        }
        const decoded = this.decode(raw);
        if (!decoded) continue;
        const at = new Date(timestampOf(raw));
        const fromMe = raw.key.fromMe === true;
        const messageId = `msg-wa-${chat.conversationId}-${externalId}`;
        let pendingMedia: HistoryCommitItem['pendingMedia'];
        let content = decoded.content;
        if (decoded.media) {
          const submessage = mediaSubmessage(raw, decoded.media.kind);
          if (!submessage) continue;
          const minimum = proto.WebMessageInfo.create({
            key: raw.key,
            messageTimestamp: raw.messageTimestamp,
            message: submessage,
          });
          const sealed = seal(
            Buffer.from(proto.WebMessageInfo.encode(minimum).finish()),
            messageId,
          );
          pendingMedia = {
            kind: decoded.media.kind,
            mimeType: decoded.media.mimeType,
            sizeBytes: decoded.media.fileLength,
            ...sealed,
          };
          content = pendingContent(decoded.media);
        }
        const message: Message = {
          id: messageId,
          conversationId: chat.conversationId,
          externalId,
          author: fromMe ? 'agent' : 'contact',
          authorName: fromMe
            ? 'Atendente'
            : raw.pushName?.trim() || names.get(chat.jid) || chat.phone,
          origin: 'historico',
          content,
          createdAt: at.toISOString(),
          time: timeLabel(at),
          ...(fromMe
            ? { deliveryStatus: deliveryStatusFrom(raw.status) ?? ('enviado' as const) }
            : {}),
          isPrivate: false,
        };
        input.push({
          chat,
          contactName: names.get(chat.jid) || raw.pushName?.trim() || chat.phone,
          message,
          preview: decoded.preview,
          at,
          ...(pendingMedia ? { pendingMedia } : {}),
        });
      }
      if (input.length > 0) {
        const report = await commitHistoryBatch(
          this.dependencies.accountId,
          this.dependencies.inboxId,
          input,
          this.now(),
        );
        this.statsValue = {
          ...this.statsValue,
          conversasCriadas: this.statsValue.conversasCriadas + report.conversationsCreated,
          conversasAtualizadas: this.statsValue.conversasAtualizadas + report.conversationsUpdated,
          mensagens: this.statsValue.mensagens + report.messages,
          duplicadas: this.statsValue.duplicadas + report.duplicates,
          midiasPendentes: this.statsValue.midiasPendentes + report.mediaPending,
          progresso: Math.max(this.statsValue.progresso, Number(block.progress ?? 0)),
        };
        await this.dependencies.onBatch?.(report, this.statsValue);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
