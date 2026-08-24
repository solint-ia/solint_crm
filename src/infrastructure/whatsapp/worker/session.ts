import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type { Contact } from '@/core/domain/contact';
import type { Message, MessageContent } from '@/core/domain/message';
import { PhoneNumber } from '@/core/domain/contact';
import { prisma } from '@/infrastructure/db/prisma';
import { initPostgresAuthState } from '../auth/postgres-auth-state';
import {
  applyDeliveryUpdate,
  commitMessage,
  findSentMessage,
  findStoredContact,
  patchContact,
} from '../wa-store';
import {
  isSupportedChatJid,
  jidFromPhone,
  resolveChatIdentity,
  resolveSenderIdentity,
  userOf,
  type ChatIdentity,
} from '../wa-identity';
import {
  decodeWaMessage,
  deliveryStatusFrom,
  mediaContent,
  timestampOf,
  type MediaRef,
} from '../wa-message-content';
import { mediaStore, mediaUrlFor } from '../wa-media-store';
import { waEventBus, type WhatsAppStatusPayload } from '../whatsapp-events';

const GROUP_METADATA_TTL_MS = 10 * 60 * 1000;
const AVATAR_TTL_MS = 60 * 60 * 1000;
const MAX_TRACKED_SENT_IDS = 500;
const MAX_INLINE_MEDIA_BYTES = 16 * 1024 * 1024;

const AVATAR_TONES = ['#168cff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

const toneFor = (key: string): string => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] as string;
};

const timeLabel = (date: Date): string =>
  date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const extractStatusCode = (error: unknown): number | undefined => {
  if (!error) return undefined;
  const err = error as Record<string, unknown>;
  const output = err['output'] as Record<string, unknown> | undefined;
  if (output && typeof output['statusCode'] === 'number') {
    return output['statusCode'];
  }
  if (typeof err['statusCode'] === 'number') return err['statusCode'];
  if (typeof err['code'] === 'number') return err['code'];
  return undefined;
};

const fallbackPersonName = (phone: string, jid: string): string =>
  phone ? PhoneNumber.format(phone) : `Contato ${userOf(jid).slice(-6)}`;

export class WhatsAppSession {
  readonly inboxId: string;
  readonly accountId: string;

  private socket: WASocket | null = null;
  private isInitializing = false;
  private isAuthenticated = false;
  private retryCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentStatus: WhatsAppStatusPayload = {
    status: 'desconectado',
    updatedAt: new Date().toISOString(),
  };

  private readonly groupCache = new Map<string, { subject: string; size: number; at: number }>();
  private readonly avatarCache = new Map<string, { url?: string; at: number }>();
  private readonly crmSentIds = new Set<string>();
  private readonly lastInboundKey = new Map<string, WAMessageKey>();
  private readonly logger = pino({ level: 'silent' });

  constructor(inboxId: string, accountId: string) {
    this.inboxId = inboxId;
    this.accountId = accountId;
  }

  getStatus(): WhatsAppStatusPayload {
    return this.currentStatus;
  }

  private async updateStatus(patch: Partial<WhatsAppStatusPayload>) {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await prisma.whatsAppConnection.updateMany({
      where: { inboxId: this.inboxId },
      data: {
        status: this.currentStatus.status,
        lastError: this.currentStatus.error ?? null,
        qrPayload: this.currentStatus.qr ?? null,
        profileName: this.currentStatus.name ?? null,
        phoneJid: this.currentStatus.phone ?? null,
        ...(this.currentStatus.status === 'conectado'
          ? { lastConnectedAt: new Date(), retryCount: 0 }
          : {}),
      },
    });

    waEventBus.emitStatus(this.currentStatus);
  }

  async start(): Promise<WhatsAppStatusPayload> {
    if (this.socket && this.isAuthenticated) {
      return this.currentStatus;
    }
    if (this.isInitializing) {
      return this.currentStatus;
    }

    this.isInitializing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      await this.updateStatus({ status: 'conectando', error: undefined });

      const { state, saveCreds } = await initPostgresAuthState(this.inboxId);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({
        version: [2, 3000, 1043857760] as [number, number, number],
      }));

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        browser: Browsers.macOS('Desktop'),
        logger: this.logger,
        syncFullHistory: true,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        getMessage: async (key) => findSentMessage(this.inboxId, key),
        cachedGroupMetadata: async (jid) => {
          const cached = this.groupCache.get(jid);
          if (cached && Date.now() - cached.at < GROUP_METADATA_TTL_MS) {
            return cached as unknown as undefined;
          }
          return undefined;
        },
      });

      this.setupEventHandlers(saveCreds);
      return this.currentStatus;
    } catch (error) {
      this.isInitializing = false;
      const message = error instanceof Error ? error.message : 'Falha ao inicializar WhatsApp';
      await this.updateStatus({ status: 'desconectado', error: message });
      throw error;
    }
  }

  private setupEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;

    this.socket.ev.on('creds.update', async () => {
      await saveCreds();
    });

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.isInitializing = false;
        await this.updateStatus({
          status: 'aguardando_leitura',
          qr,
          error: undefined,
        });
      }

      if (connection === 'close') {
        this.isInitializing = false;
        this.isAuthenticated = false;

        const statusCode = extractStatusCode(lastDisconnect?.error);
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WhatsAppSession ${this.inboxId}] Conexão fechada. Código: ${statusCode}`);

        if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          console.log(`[WhatsAppSession ${this.inboxId}] Reinício pós-pareamento (515)...`);
          setTimeout(() => void this.start(), 500);
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440) {
          await this.updateStatus({
            status: 'desconectado',
            error: 'Conexão substituída por outra sessão ativa.',
            qr: undefined,
          });
          return;
        }

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          await prisma.whatsAppKey.deleteMany({ where: { inboxId: this.inboxId } });
          await prisma.whatsAppConnection.updateMany({
            where: { inboxId: this.inboxId },
            data: { credsCipher: null, credsIv: null, credsTag: null, status: 'desconectado' },
          });
          await this.updateStatus({
            status: 'desconectado',
            error: 'Desconectado no aparelho do WhatsApp.',
            qr: undefined,
          });
          return;
        }

        if (statusCode === DisconnectReason.badSession || statusCode === 500) {
          await prisma.whatsAppKey.deleteMany({ where: { inboxId: this.inboxId } });
        }

        if (shouldReconnect) {
          this.retryCount += 1;
          const delays = [3000, 8000, 20000, 60000];
          const delay = (delays[Math.min(this.retryCount - 1, delays.length - 1)] ?? 60000) + Math.random() * 1000;

          await this.updateStatus({
            status: 'conectando',
            error: `Conexão perdida. Reconectando em ${Math.round(delay / 1000)}s...`,
          });

          this.reconnectTimer = setTimeout(() => void this.start(), delay);
        } else {
          await this.updateStatus({ status: 'desconectado', qr: undefined });
        }
      }

      if (connection === 'open') {
        this.isInitializing = false;
        this.isAuthenticated = true;
        this.retryCount = 0;

        const userJid = this.socket?.user?.id ? jidNormalizedUser(this.socket.user.id) : undefined;
        const ownerName = this.socket?.user?.name ?? (userJid ? PhoneNumber.format(userOf(userJid)) : 'WhatsApp');

        await this.updateStatus({
          status: 'conectado',
          qr: undefined,
          error: undefined,
          name: ownerName,
          phone: userJid,
          connectedAt: new Date().toISOString(),
          owner: {
            userId: 'worker',
            userName: ownerName,
            accountId: this.accountId,
          },
        });

        console.log(`[WhatsAppSession ${this.inboxId}] Conectado com sucesso como ${ownerName}`);
      }
    });

    this.socket.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
      console.log(
        `[WhatsAppSession ${this.inboxId}] Histórico recebido: ${chats.length} conversas, ${contacts.length} contatos, ${messages.length} mensagens`,
      );
      for (const msg of messages) {
        if (msg.message && isSupportedChatJid(msg.key.remoteJid)) {
          try {
            await this.handleIncomingMessage(msg);
          } catch (err) {
            console.error(`[WhatsAppSession ${this.inboxId}] Erro ao salvar mensagem do histórico:`, err);
          }
        }
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages) {
        await this.handleIncomingMessage(msg);
      }
    });

    this.socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update.status && update.key.id) {
          const status = deliveryStatusFrom(update.update.status);
          if (status) {
            await applyDeliveryUpdate(update.key.id, status);
          }
        }
      }
    });
  }

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    const socket = this.socket;
    if (!socket || !msg.message || !isSupportedChatJid(msg.key.remoteJid)) return;

    const messageId = msg.key.id;
    if (!messageId) return;

    const fromMe = Boolean(msg.key.fromMe);
    if (fromMe && this.crmSentIds.has(messageId)) return;

    const decoded = decodeWaMessage(msg);
    if (!decoded) return;

    const chat = await resolveChatIdentity(socket, msg.key);
    if (!chat) return;

    const at = new Date(timestampOf(msg));
    const contact = await this.resolveContact(chat, msg, fromMe);
    const authorName = await this.resolveAuthorName(chat, msg, fromMe, contact.name);

    const content = decoded.media
      ? await this.materializeMedia(msg, messageId, decoded.media, decoded.content)
      : decoded.content;

    const appMessage: Message = {
      id: messageId,
      externalId: messageId,
      conversationId: chat.conversationId,
      author: fromMe ? 'agent' : 'contact',
      authorName,
      origin: fromMe ? 'canal' : undefined,
      content,
      time: timeLabel(at),
      deliveryStatus: fromMe ? (deliveryStatusFrom(msg.status) ?? 'enviado') : undefined,
      isPrivate: false,
    };

    if (!fromMe) {
      this.lastInboundKey.set(chat.conversationId, msg.key);
    }

    await commitMessage({
      accountId: this.accountId,
      inboxId: this.inboxId,
      chat,
      contact,
      message: appMessage,
      preview: decoded.preview,
      at,
      fromMe,
    });

    void this.hydrateAvatar(chat);
  }

  private async resolveContact(
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
  ): Promise<Contact> {
    const existing = await findStoredContact(this.accountId, chat);

    const base = {
      ...existing,
      id: chat.contactId,
      accountId: this.accountId,
      channel: 'whatsapp' as const,
      avatarTone: existing?.avatarTone ?? toneFor(chat.key),
      avatarUrl: existing?.avatarUrl ?? this.avatarCache.get(chat.jid)?.url,
      labels: existing?.labels ?? [],
      customFields: existing?.customFields ?? [],
      lastContactAt: new Date().toISOString(),
      lastContactLabel: 'Agora',
    };

    if (chat.isGroup) {
      const metadata = await this.fetchGroupMetadata(chat.jid);
      return {
        ...base,
        name: metadata?.subject || existing?.name || 'Grupo do WhatsApp',
        phone: '',
        kind: 'grupo',
        participantCount: metadata?.size ?? existing?.participantCount,
      };
    }

    const inboundName = fromMe ? undefined : msg.pushName?.trim();
    const name =
      inboundName ||
      existing?.name ||
      msg.verifiedBizName?.trim() ||
      fallbackPersonName(chat.phone, chat.jid);

    return {
      ...base,
      name,
      phone: chat.phone,
      kind: 'pessoa',
      participantCount: undefined,
    };
  }

  private async resolveAuthorName(
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
    contactName: string,
  ): Promise<string | undefined> {
    if (fromMe) {
      return this.currentStatus.name ?? 'Atendente';
    }
    if (!chat.isGroup) {
      return contactName;
    }
    if (this.socket) {
      const sender = await resolveSenderIdentity(this.socket, msg.key);
      return sender?.phone ? PhoneNumber.format(sender.phone) : 'Participante';
    }
    return 'Participante';
  }

  private async fetchGroupMetadata(jid: string): Promise<{ subject: string; size: number } | null> {
    const cached = this.groupCache.get(jid);
    if (cached && Date.now() - cached.at < GROUP_METADATA_TTL_MS) return cached;
    if (!this.socket) return null;

    try {
      const metadata = await this.socket.groupMetadata(jid);
      const entry = {
        subject: metadata.subject,
        size: metadata.participants?.length ?? 0,
        at: Date.now(),
      };
      this.groupCache.set(jid, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private async hydrateAvatar(chat: ChatIdentity): Promise<void> {
    if (!this.socket) return;
    const cached = this.avatarCache.get(chat.jid);
    if (cached && Date.now() - cached.at < AVATAR_TTL_MS) return;

    try {
      const url = await this.socket.profilePictureUrl(chat.jid, 'preview');
      this.avatarCache.set(chat.jid, { url: url || undefined, at: Date.now() });
      if (url) {
        await patchContact(chat.conversationId, { avatarUrl: url });
      }
    } catch {
      this.avatarCache.set(chat.jid, { url: undefined, at: Date.now() });
    }
  }

  private async materializeMedia(
    msg: WAMessage,
    messageId: string,
    media: MediaRef,
    fallback: MessageContent,
  ): Promise<MessageContent> {
    if (media.fileLength > MAX_INLINE_MEDIA_BYTES) return fallback;
    if (mediaStore.has(messageId)) return mediaContent(media, mediaUrlFor(messageId));
    const socket = this.socket;
    if (!socket) return fallback;

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: this.logger, reuploadRequest: socket.updateMediaMessage },
      );
      const url = await mediaStore.save(messageId, buffer, {
        mimeType: media.mimeType,
        fileName: media.fileName,
      });
      return url ? mediaContent(media, url) : fallback;
    } catch (error) {
      console.warn(`[WhatsAppSession ${this.inboxId}] Falha ao baixar mídia:`, error);
      return fallback;
    }
  }

  async sendMessage(
    recipient: { phone?: string; jid?: string },
    content: { text?: string },
    options: { paced?: boolean } = {},
  ): Promise<string> {
    if (!this.socket || !this.isAuthenticated) {
      throw new Error(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const targetJid = recipient.jid ?? (recipient.phone ? jidFromPhone(recipient.phone) : undefined);
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
    }

    const text = content.text ?? '';

    if (options.paced && text) {
      await this.socket.presenceSubscribe(targetJid);
      await this.socket.sendPresenceUpdate('composing', targetJid);

      const delay = Math.min(Math.max(text.length * 30, 1500), 5000) + Math.random() * 800;
      await new Promise((resolve) => setTimeout(resolve, delay));

      await this.socket.sendPresenceUpdate('paused', targetJid);
    }

    const result = await this.socket.sendMessage(targetJid, { text });
    const msgId = result?.key.id ?? `sent-${Date.now()}`;

    this.crmSentIds.add(msgId);
    if (this.crmSentIds.size > MAX_TRACKED_SENT_IDS) {
      const oldest = this.crmSentIds.values().next().value;
      if (oldest) this.crmSentIds.delete(oldest);
    }

    return msgId;
  }

  async markAsRead(conversationId: string): Promise<void> {
    const key = this.lastInboundKey.get(conversationId);
    if (this.socket && this.isAuthenticated && key) {
      try {
        await this.socket.readMessages([key]);
      } catch (err) {
        console.warn(`[WhatsAppSession ${this.inboxId}] Falha ao marcar lido:`, err);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch {
        // Ignora erro ao fechar socket
      }
      this.socket = null;
    }
    this.isAuthenticated = false;
    this.isInitializing = false;
    await this.updateStatus({ status: 'desconectado', qr: undefined });
  }
}
