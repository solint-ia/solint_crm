import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  Browsers,
  isJidGroup,
  jidNormalizedUser,
  type Contact as WAContact,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
} from '@whiskeysockets/baileys';
import { prisma } from '../db/prisma';
import { initPostgresAuthState } from './auth/postgres-auth-state';

import type { Contact } from '@/core/domain/contact';
import type { Message, MessageContent } from '@/core/domain/message';
import { PhoneNumber } from '@/core/domain/contact';
import {
  applyDeliveryUpdate as persistDeliveryUpdate,
  commitMessage as persistMessage,
  conversationExists,
  findStoredContact as loadStoredContact,
  patchContact,
} from './wa-store';
import { clearOwner, readOwner, writeOwner } from './wa-owner';
import { waEventBus, type WhatsAppOwner, type WhatsAppStatusPayload } from './whatsapp-events';
import {
  isSupportedChatJid,
  jidFromPhone,
  resolveChatIdentity,
  resolveSenderIdentity,
  userOf,
  type ChatIdentity,
} from './wa-identity';
import {
  decodeWaMessage,
  deliveryStatusFrom,
  mediaContent,
  timestampOf,
  type MediaRef,
} from './wa-message-content';
import { mediaStore, mediaUrlFor } from './wa-media-store';

const SESSIONS_DIR = path.resolve(process.cwd(), '.sessions', 'whatsapp-default');

const AVATAR_TONES = ['#168cff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

/** Tom estavel por chave: o mesmo contato mantem a mesma cor entre reinicios. */
const toneFor = (key: string): string => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] as string;
};

const GROUP_METADATA_TTL_MS = 10 * 60 * 1000;
const AVATAR_TTL_MS = 60 * 60 * 1000;
const MAX_TRACKED_SENT_IDS = 500;
/** Acima disso a midia não e baixada: a conversa não pode ficar esperando um vídeo enorme. */
const MAX_INLINE_MEDIA_BYTES = 16 * 1024 * 1024;

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

/** Nome legivel de um contato pessoal quando o proprio pushName não esta disponível. */
const fallbackPersonName = (phone: string, jid: string): string =>
  phone ? PhoneNumber.format(phone) : `Contato ${userOf(jid).slice(-6)}`;

export class WhatsAppService {
  private socket: WASocket | null = null;
  private isInitializing = false;
  private isAuthenticated = false;
  private qrAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentStatus: WhatsAppStatusPayload = {
    status: 'desconectado',
    updatedAt: new Date().toISOString(),
  };

  /**
   * Usuario do CRM que pareou este número — exibido no perfil e nas mensagens,
   * e **fonte da conta** em que as mensagens recebidas são gravadas.
   *
   * Recuperado do disco no boot: uma sessão salva reconecta sozinha, e sem o
   * dono não haveria como saber de qual conta é a conversa que acabou de
   * chegar. Antes isso era uma constante do seed, e toda mensagem real ia para
   * a conta de demonstração.
   */
  private owner: WhatsAppOwner | undefined = readOwner(SESSIONS_DIR);
  private readonly groupCache = new Map<string, { subject: string; size: number; at: number }>();
  private readonly avatarCache = new Map<string, { url?: string; at: number }>();
  /** Ids de mensagens despachadas por esta plataforma — usados para ignorar o eco. */
  private readonly crmSentIds = new Set<string>();
  /** Última mensagem recebida por conversa: base para confirmar leitura no celular. */
  private readonly lastInboundKey = new Map<string, WAMessageKey>();
  private readonly logger = pino({ level: 'silent' });

  constructor() {
    // O store de conversas e volatil, o disco não: descarta midia orfa antiga.
    void mediaStore.prune();

    // Restaura automaticamente no boot se houver credenciais salvas no Postgres
    setTimeout(async () => {
      try {
        const conn = await prisma.whatsAppConnection.findFirst({
          where: {
            credsCipher: { not: null },
          },
          include: { inbox: true },
        });
        if (conn?.credsCipher && conn.inbox) {
          this.owner = {
            userId: conn.pairedByUserId ?? 'system',
            userName: conn.profileName ?? 'Administrador',
            accountId: conn.inbox.accountId,
          };
          await this.startSession({ owner: this.owner, resetAttempts: false });
        }
      } catch (err) {
        console.error('[WhatsAppService] Erro ao restaurar sessão salva:', err);
      }
    }, 1500);
  }

  getStatus(): WhatsAppStatusPayload {
    return this.currentStatus;
  }

  /**
   * Conta em que gravar o que chega do canal.
   */
  private accountId(): string {
    return this.owner?.accountId ?? 'acc-solint';
  }

  /**
   * Caixa de entrada associada à conta ativa.
   */
  private async activeInboxId(): Promise<string> {
    const accId = this.accountId();
    const inbox = await prisma.inbox.findFirst({
      where: { accountId: accId, channel: 'whatsapp' },
      select: { id: true },
    });
    return inbox?.id ?? `ibx-${accId}`;
  }

  private updateStatus(patch: Partial<WhatsAppStatusPayload>) {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    waEventBus.emitStatus(this.currentStatus);
  }

  async startSession(
    options: { owner?: WhatsAppOwner; resetAttempts?: boolean } = {},
  ): Promise<WhatsAppStatusPayload> {
    const { owner, resetAttempts = true } = options;
    if (owner) {
      this.owner = owner;
      // Gravado junto das credenciais para sobreviver a reinício: é o par
      // sessão + dono que define de qual conta é a conversa.
      void writeOwner(SESSIONS_DIR, owner);
    }

    if (resetAttempts) {
      this.qrAttempts = 0;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket && this.isAuthenticated) {
      return this.currentStatus;
    }

    if (this.isInitializing) {
      return this.currentStatus;
    }

    this.isInitializing = true;
    this.updateStatus({ status: 'gerando_qr', error: undefined, owner: this.owner });

    // Limpa socket e listeners anteriores antes de abrir um novo
    this.teardownSocket();

    try {
      const inboxId = await this.activeInboxId();
      const { state, saveCreds } = await initPostgresAuthState(inboxId, {
        forceFresh: resetAttempts && !this.isAuthenticated,
      });

      const { version } = await fetchLatestBaileysVersion().catch(() => ({
        version: [2, 3000, 1043857760] as [number, number, number],
      }));

      const sock = makeWASocket({
        version,
        logger: this.logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: Boolean(state.creds.registered),
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        qrTimeout: 60000,
      });

      this.socket = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update) => {
        void this.handleConnectionUpdate(sock, update);
      });

      sock.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
        console.log(
          `[WhatsAppService] Histórico inicial recebido: ${chats.length} conversas, ${contacts.length} contatos, ${messages.length} mensagens`,
        );
        for (const msg of messages) {
          if (msg.message && isSupportedChatJid(msg.key.remoteJid)) {
            await this.handleIncomingMessage(msg).catch((err) => {
              console.error('[WhatsAppService] Erro ao sincronizar mensagem histórica:', err);
            });
          }
        }
      });

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        for (const msg of messages) {
          this.handleIncomingMessage(msg).catch((err) => {
            console.error('[WhatsAppService] Erro ao processar mensagem recebida:', err);
          });
        }
      });

      sock.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          void this.applyDeliveryUpdate(update.key, update.update?.status);
        }
      });

      sock.ev.on('groups.update', (updates) => {
        for (const update of updates) {
          if (!update.id || !update.subject) continue;
          this.groupCache.set(update.id, {
            subject: update.subject,
            size: update.size ?? this.groupCache.get(update.id)?.size ?? 0,
            at: Date.now(),
          });
          void this.renameGroupChat(update.id, update.subject, update.size);
        }
      });

      sock.ev.on('contacts.update', (updates) => {
        for (const update of updates) void this.applyContactUpdate(update);
      });

      sock.ev.on('contacts.upsert', (contacts) => {
        for (const contact of contacts) void this.applyContactUpdate(contact);
      });

      return this.currentStatus;
    } catch (error) {
      this.isInitializing = false;
      const errorMsg = error instanceof Error ? error.message : 'Falha ao iniciar WhatsApp';
      this.updateStatus({ status: 'desconectado', error: errorMsg });
      throw error;
    }
  }

  private async handleConnectionUpdate(
    sock: WASocket,
    update: {
      connection?: string;
      lastDisconnect?: { error?: Error | unknown } | null;
      qr?: string;
    },
  ) {
    if (this.socket !== sock) {
      return;
    }

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.qrAttempts = 0;
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
        this.updateStatus({
          status: 'aguardando_leitura',
          qr: qrDataUrl,
          error: undefined,
        });
      } catch (qrErr) {
        console.error('[WhatsAppService] Erro ao gerar QR Code DataURL:', qrErr);
      }
    }

    if (connection === 'connecting') {
      this.updateStatus({ status: 'conectando' });
    }

    if (connection === 'open') {
      this.isInitializing = false;
      this.isAuthenticated = true;
      this.qrAttempts = 0;
      const userJid = sock.user?.id || '';
      const phone = userOf(userJid);
      const name = sock.user?.name || 'WhatsApp Conectado';

      console.log(`[WhatsAppService] Conectado com sucesso ao número: ${phone}`);

      const inboxId = await this.activeInboxId();
      await prisma.whatsAppConnection.upsert({
        where: { inboxId },
        create: {
          inboxId,
          phoneJid: userJid,
          profileName: name,
          pairedByUserId: this.owner?.userId,
          status: 'conectado',
        },
        update: {
          phoneJid: userJid,
          profileName: name,
          pairedByUserId: this.owner?.userId,
          status: 'conectado',
          lastError: null,
        },
      });

      await prisma.inbox.updateMany({
        where: { id: inboxId, accountId: this.accountId() },
        data: {
          status: 'conectado',
          identifier: phone ? `+${phone}` : 'whatsapp-connected',
        },
      });

      this.updateStatus({
        status: 'conectado',
        qr: undefined,
        phone: phone ? `+${phone}` : undefined,
        name,
        owner: this.owner,
        connectedAt: new Date().toISOString(),
        error: undefined,
      });

      // Foto de perfil da conta conectada, exibida no perfil do usuário do CRM.
      if (userJid) {
        const avatarUrl = await this.fetchAvatar(jidNormalizedUser(userJid));
        if (avatarUrl) this.updateStatus({ avatarUrl });
      }
    }

    if (connection === 'close') {
      this.isInitializing = false;
      const statusCode = extractStatusCode(lastDisconnect?.error);
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isReplaced = statusCode === DisconnectReason.connectionReplaced;
      const errObj = lastDisconnect?.error as Error | undefined;
      const errorDetail = errObj?.message ?? '';

      console.log(
        `[WhatsAppService] Conexão encerrada. Código: ${statusCode}. Detalhe: ${errorDetail}. Autenticado: ${this.isAuthenticated}. Tentativas QR: ${this.qrAttempts}`,
      );

      if (isLoggedOut) {
        this.isAuthenticated = false;
        this.socket = null;
        this.cleanSessionFolder();
        this.resetCaches();
        this.owner = undefined;
        this.updateStatus({
          status: 'desconectado',
          qr: undefined,
          phone: undefined,
          name: undefined,
          avatarUrl: undefined,
          owner: undefined,
          connectedAt: undefined,
          error: 'Sessão desconectada no WhatsApp',
        });
      } else if (isReplaced) {
        // Outro dispositivo assumiu a sessão. As credenciais continuam validas,
        // entao apagar a pasta obrigaria um novo QR sem necessidade.
        this.isAuthenticated = false;
        this.socket = null;
        this.updateStatus({
          status: 'desconectado',
          qr: undefined,
          error: 'Esta sessão foi aberta em outro lugar. Reconecte para voltar a atender.',
        });
      } else if (this.isAuthenticated) {
        // Estava autenticado e a conexao caiu: tenta restabelecer.
        this.updateStatus({ status: 'conectando' });
        this.reconnectTimer = setTimeout(() => {
          this.startSession({ resetAttempts: false }).catch(console.error);
        }, 3000);
      } else if (statusCode === 428 || statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
        // Handshake transitório do WebSocket WhatsApp: reconecta automaticamente para obter o QR
        this.updateStatus({ status: 'gerando_qr' });
        this.reconnectTimer = setTimeout(() => {
          this.startSession({ resetAttempts: false }).catch(console.error);
        }, 1500);
      } else if (this.qrAttempts < 8) {
        // Handshake inicial do Baileys: próxima tentativa para receber o QR Code.
        this.qrAttempts += 1;
        this.updateStatus({ status: 'gerando_qr' });
        this.reconnectTimer = setTimeout(() => {
          this.startSession({ resetAttempts: false }).catch(console.error);
        }, 1500);
      } else {
        this.socket = null;
        this.cleanSessionFolder();
        this.updateStatus({
          status: 'desconectado',
          qr: undefined,
          error: 'Não foi possível carregar o QR Code. Tente novamente.',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Entrada de mensagens
  // ---------------------------------------------------------------------------

  private async handleIncomingMessage(msg: WAMessage) {
    const socket = this.socket;
    if (!socket || !msg.message || !isSupportedChatJid(msg.key.remoteJid)) return;

    const messageId = msg.key.id;
    if (!messageId) return;

    const fromMe = Boolean(msg.key.fromMe);

    // Mensagem despachada por esta plataforma: ja esta na timeline e o eco so
    // duplicaria a bolha. O status de entrega chega por `messages.update`.
    if (fromMe && this.crmSentIds.has(messageId)) return;

    const decoded = decodeWaMessage(msg);
    if (!decoded) return;

    const chat = await resolveChatIdentity(socket, msg.key);
    if (!chat) return;

    console.log(`[WhatsAppService] Nova mensagem de ${chat.phone || chat.jid} (ID: ${messageId})`);

    const at = new Date(timestampOf(msg));
    const contact = await this.resolveContact(chat, msg, fromMe);
    const authorName = await this.resolveAuthorName(chat, msg, fromMe, contact.name);
    // A midia do WhatsApp e criptografada: sem decifrar e gravar localmente,
    // o navegador não tem como exibir foto, figurinha, GIF ou áudio.
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

    await persistMessage({
      accountId: this.accountId(),
      inboxId: await this.activeInboxId(),
      chat,
      contact,
      message: appMessage,
      preview: decoded.preview,
      at,
      fromMe,
    });

    console.log(`[WhatsAppService] Conversa ${chat.conversationId} persistida com sucesso!`);

    // A foto de perfil chega depois: atualiza a conversa quando resolver.
    void this.hydrateAvatar(chat);
  }

  /**
   * Decifra a midia e devolve o conteúdo definitivo.
   * Falhas nunca derrubam a mensagem: o texto descritivo continua valendo como
   * fallback, entao a conversa nunca perde um evento por causa de um download.
   */
  private async materializeMedia(
    msg: WAMessage,
    messageId: string,
    media: MediaRef,
    fallback: MessageContent,
  ): Promise<MessageContent> {
    if (media.fileLength > MAX_INLINE_MEDIA_BYTES) return fallback;

    // Reprocessamento da mesma mensagem (reconexão, `append`) reusa o arquivo.
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
      console.warn('[WhatsAppService] Não foi possível baixar a mídia:', error);
      return fallback;
    }
  }

  /**
   * Resolve o contato (ou grupo) dono da conversa.
   *
   * Regra critica: `pushName` e o nome de *quem enviou*. Em mensagens proprias
   * (`fromMe`) ele e o nome da conta conectada e, em grupos, o nome do
   * participante. Usa-lo como nome da conversa foi a origem dos titulos errados:
   * conversa nova com o meu proprio nome e grupo nomeado por quem falou.
   */
  private async resolveContact(
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
  ): Promise<Contact> {
    const existing = await loadStoredContact(this.accountId(), chat);

    // O que ja existe no CRM (empresa, e-mail, etiquetas, notas) e preservado:
    // o canal so contribui com o que ele realmente conhece.
    const base = {
      ...existing,
      id: chat.contactId,
      accountId: this.accountId(),
      channel: 'whatsapp',
      avatarTone: existing?.avatarTone ?? toneFor(chat.key),
      avatarUrl: existing?.avatarUrl ?? this.avatarCache.get(chat.jid)?.url,
      labels: existing?.labels ?? [],
      customFields: existing?.customFields ?? [],
      lastContactAt: new Date().toISOString(),
      lastContactLabel: 'Agora',
    } satisfies Partial<Contact>;

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

    // O pushName so vale quando quem escreveu foi o proprio contato.
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
      location: existing?.location ?? 'Brasil',
      timezone: existing?.timezone ?? 'GMT-3 (Brasília)',
    };
  }

  /** Autor exibido na bolha: participante em grupos, conta conectada em `fromMe`. */
  private async resolveAuthorName(
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
    contactName: string,
  ): Promise<string> {
    if (fromMe) {
      return this.currentStatus.name ?? this.owner?.userName ?? 'Você';
    }
    if (!chat.isGroup) return contactName;

    const pushName = msg.pushName?.trim();
    if (pushName) return pushName;

    const socket = this.socket;
    if (!socket) return 'Participante';
    const sender = await resolveSenderIdentity(socket, msg.key);
    if (!sender?.phone) return 'Participante';
    return PhoneNumber.format(sender.phone);
  }

  // ---------------------------------------------------------------------------
  // Atualizacoes assincronas (entrega, nome, foto)
  //
  // A gravacao vive em `wa-store.ts`: aqui fica so a traducao do evento do
  // Baileys para a intencao de dominio.
  // ---------------------------------------------------------------------------

  private async applyDeliveryUpdate(key: WAMessageKey, status: number | null | undefined) {
    const deliveryStatus = deliveryStatusFrom(status);
    if (!deliveryStatus || !key.id) return;
    await persistDeliveryUpdate(key.id, deliveryStatus);
  }

  private async applyContactUpdate(update: Partial<WAContact>) {
    const jid = update.phoneNumber ?? update.id;
    if (!jid || isJidGroup(jid)) return;

    const name = update.name?.trim() || update.notify?.trim() || update.verifiedName?.trim();
    const imgUrl =
      typeof update.imgUrl === 'string' && update.imgUrl !== 'changed' ? update.imgUrl : undefined;
    if (!name && !imgUrl) return;

    const normalized = jidNormalizedUser(jid);
    if (imgUrl) this.avatarCache.set(normalized, { url: imgUrl, at: Date.now() });

    await patchContact(`cv-wa-${userOf(normalized)}`, {
      ...(name ? { name } : {}),
      ...(imgUrl ? { avatarUrl: imgUrl } : {}),
    });
  }

  private async renameGroupChat(jid: string, subject: string, size?: number) {
    await patchContact(`cv-wa-g-${userOf(jid)}`, {
      name: subject,
      ...(size ? { participantCount: size } : {}),
    });
  }

  private async hydrateAvatar(chat: ChatIdentity) {
    const cached = this.avatarCache.get(chat.jid);
    if (cached && Date.now() - cached.at < AVATAR_TTL_MS) return;

    const url = await this.fetchAvatar(chat.jid);
    if (!url) return;
    if (!(await conversationExists(this.accountId(), chat.conversationId))) return;
    await patchContact(chat.conversationId, { avatarUrl: url });
  }

  /**
   * Foto de perfil do contato, do grupo ou da propria conta.
   *
   * A URL que o WhatsApp devolve e assinada e expira em algumas horas — usa-la
   * direto faria os avatares quebrarem sozinhos com o tempo. Por isso a imagem
   * e copiada uma vez para o deposito local e servida pela aplicacao.
   */
  private async fetchAvatar(jid: string): Promise<string | undefined> {
    const cached = this.avatarCache.get(jid);
    if (cached && Date.now() - cached.at < AVATAR_TTL_MS) return cached.url;

    const mediaId = `pp-${userOf(jid) || 'me'}`;

    try {
      const remoteUrl = await this.socket?.profilePictureUrl(jid, 'image');
      if (!remoteUrl) {
        // Sem foto (ou oculta pela privacidade): memoriza para não reconsultar.
        this.avatarCache.set(jid, { url: undefined, at: Date.now() });
        return undefined;
      }

      const localUrl = await this.mirrorAvatar(mediaId, remoteUrl);
      const url = localUrl ?? remoteUrl;
      this.avatarCache.set(jid, { url, at: Date.now() });
      return url;
    } catch {
      // Foto privada ou indisponivel: mantem a copia local se ja houver uma.
      const fallback = mediaStore.has(mediaId) ? mediaUrlFor(mediaId) : undefined;
      this.avatarCache.set(jid, { url: fallback, at: Date.now() });
      return fallback;
    }
  }

  /** Copia a foto assinada para o deposito local; devolve a URL estavel. */
  private async mirrorAvatar(mediaId: string, remoteUrl: string): Promise<string | undefined> {
    try {
      const response = await fetch(remoteUrl);
      if (!response.ok) return undefined;
      const buffer = Buffer.from(await response.arrayBuffer());
      return await mediaStore.save(mediaId, buffer, {
        mimeType: response.headers.get('content-type') ?? 'image/jpeg',
      });
    } catch {
      return undefined;
    }
  }

  private async fetchGroupMetadata(jid: string) {
    const cached = this.groupCache.get(jid);
    if (cached && Date.now() - cached.at < GROUP_METADATA_TTL_MS) return cached;
    try {
      const metadata = await this.socket?.groupMetadata(jid);
      if (!metadata) return cached;
      const entry = {
        subject: metadata.subject,
        size: metadata.size ?? metadata.participants.length,
        at: Date.now(),
      };
      this.groupCache.set(jid, entry);
      return entry;
    } catch {
      // Metadados indisponiveis (ex.: saiu do grupo): mantem o último nome conhecido.
      return cached;
    }
  }

  // ---------------------------------------------------------------------------
  // Saida
  // ---------------------------------------------------------------------------

  /**
   * Envia para a thread correta do canal.
   * `channelThreadId` tem prioridade: e o unico valor que enderecca grupos e
   * contatos identificados por LID sem precisar inventar um número.
   */
  async sendTextMessage(
    target: { readonly channelThreadId?: string; readonly phone?: string },
    text: string,
  ): Promise<{ ok: boolean; externalId?: string; error?: string }> {
    const socket = this.socket;
    if (!socket || this.currentStatus.status !== 'conectado') {
      return { ok: false, error: 'WhatsApp não está conectado' };
    }

    const jid = target.channelThreadId ?? (target.phone ? jidFromPhone(target.phone) : undefined);
    if (!jid) {
      return { ok: false, error: 'Conversa sem destino de WhatsApp definido' };
    }

    try {
      const sent = await socket.sendMessage(jid, { text });
      const externalId = sent?.key.id ?? undefined;
      if (externalId) this.trackSentId(externalId);
      return { ok: true, externalId };
    } catch (error) {
      console.error('[WhatsAppService] Erro ao enviar mensagem WhatsApp:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao enviar mensagem',
      };
    }
  }

  /**
   * Envio de anexo.
   *
   * O `mimetype` vai explícito porque o Baileys não adivinha a partir do buffer,
   * e o WhatsApp recusa o anexo se o tipo não bater com o conteúdo. Áudio de
   * push-to-talk vai com `ptt: true` — é o que faz o app mostrar a onda sonora
   * em vez de um player de arquivo.
   */
  async sendMediaMessage(
    target: { readonly channelThreadId?: string; readonly phone?: string },
    media: {
      readonly kind: 'image' | 'video' | 'audio' | 'document';
      readonly data: Buffer;
      readonly mimeType: string;
      readonly fileName?: string;
      readonly caption?: string;
      readonly voice?: boolean;
    },
  ): Promise<{ ok: boolean; externalId?: string; error?: string }> {
    const socket = this.socket;
    if (!socket || this.currentStatus.status !== 'conectado') {
      return { ok: false, error: 'WhatsApp não está conectado' };
    }

    const jid = target.channelThreadId ?? (target.phone ? jidFromPhone(target.phone) : undefined);
    if (!jid) {
      return { ok: false, error: 'Conversa sem destino de WhatsApp definido' };
    }

    const caption = media.caption?.trim() || undefined;

    const payload =
      media.kind === 'image'
        ? { image: media.data, mimetype: media.mimeType, ...(caption ? { caption } : {}) }
        : media.kind === 'video'
          ? { video: media.data, mimetype: media.mimeType, ...(caption ? { caption } : {}) }
          : media.kind === 'audio'
            ? { audio: media.data, mimetype: media.mimeType, ptt: media.voice === true }
            : {
                document: media.data,
                mimetype: media.mimeType,
                fileName: media.fileName ?? 'arquivo',
                ...(caption ? { caption } : {}),
              };

    try {
      const sent = await socket.sendMessage(jid, payload);
      const externalId = sent?.key.id ?? undefined;
      if (externalId) this.trackSentId(externalId);
      return { ok: true, externalId };
    } catch (error) {
      console.error('[WhatsAppService] Erro ao enviar mídia:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao enviar o anexo',
      };
    }
  }

  private trackSentId(externalId: string) {
    this.crmSentIds.add(externalId);
    // Janela deslizante: so o passado recente de envios precisa ser deduplicado.
    while (this.crmSentIds.size > MAX_TRACKED_SENT_IDS) {
      const oldest = this.crmSentIds.values().next().value;
      if (!oldest) break;
      this.crmSentIds.delete(oldest);
    }
  }

  /** Espelha no celular a leitura feita no CRM. */
  async markConversationAsRead(conversationId: string): Promise<void> {
    const key = this.lastInboundKey.get(conversationId);
    if (!key || !this.socket || this.currentStatus.status !== 'conectado') return;
    try {
      await this.socket.readMessages([key]);
      this.lastInboundKey.delete(conversationId);
    } catch (error) {
      console.warn('[WhatsAppService] Não foi possível confirmar leitura:', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isAuthenticated = false;
    this.isInitializing = false;

    if (this.socket) {
      try {
        await this.socket.logout();
      } catch {
        // Ignora erro de logout caso o socket ja esteja fechado
      }
    }
    this.teardownSocket();

    this.cleanSessionFolder();
    await clearOwner(SESSIONS_DIR);
    await mediaStore.clear();
    this.resetCaches();
    this.owner = undefined;
    this.updateStatus({
      status: 'desconectado',
      qr: undefined,
      phone: undefined,
      name: undefined,
      avatarUrl: undefined,
      owner: undefined,
      connectedAt: undefined,
      error: undefined,
    });
  }

  private teardownSocket() {
    if (!this.socket) return;
    try {
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.ev.removeAllListeners('messages.update');
      this.socket.ev.removeAllListeners('groups.update');
      this.socket.ev.removeAllListeners('contacts.update');
      this.socket.ev.removeAllListeners('contacts.upsert');
      this.socket.end(undefined);
    } catch {
      // Ignora
    }
    this.socket = null;
  }

  private resetCaches() {
    this.groupCache.clear();
    this.avatarCache.clear();
    this.crmSentIds.clear();
    this.lastInboundKey.clear();
  }

  private cleanSessionFolder() {
    try {
      if (fs.existsSync(SESSIONS_DIR)) {
        fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[WhatsAppService] Erro ao limpar pasta da sessão:', err);
    }
  }
}

const globalRef = globalThis as typeof globalThis & { __solintWhatsAppService?: WhatsAppService };

/**
 * Instancia unica por processo — inclusive em desenvolvimento.
 * Recriar o serviço a cada hot-reload abria sockets Baileys concorrentes,
 * que o WhatsApp derruba em loop com `connectionReplaced`.
 */
export const whatsappService: WhatsAppService = (globalRef.__solintWhatsAppService ??=
  new WhatsAppService());
