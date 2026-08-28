import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  Browsers,
  isJidGroup,
  jidNormalizedUser,
  type Contact as WAContact,
  type WASocket,
  type WAMessage,
  type WAMessageKey,
} from '@whiskeysockets/baileys';
import { asJson, prisma } from '../db/prisma';
import { initPostgresAuthState } from './auth/postgres-auth-state';

import type { Contact } from '@/core/domain/contact';
import type { Message, MessageContent } from '@/core/domain/message';
import { PhoneNumber, isGroupAllowedInChat } from '@/core/domain/contact';
import {
  applyDeliveryUpdate as persistDeliveryUpdate,
  commitMessage as persistMessage,
  conversationExists,
  ensureContact as ensureStoredContact,
  findStoredContact as loadStoredContact,
  markMessageRevoked,
  patchContact,
  patchContactByThread,
  resolveStoredIds,
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
  revokedMessageId,
  timestampOf,
  adContextOf,
  type MediaRef,
} from './wa-message-content';
import { mediaStore, mediaUrlFor } from './wa-media-store';
import { deletionKey, quotedStub } from './wa-quote';
import { waVersion } from './wa-version';

import {
  AVATAR_TTL_MS,
  extractStatusCode,
  fallbackPersonName,
  GROUP_METADATA_TTL_MS,
  inboxStatusFrom,
  MAX_INLINE_MEDIA_BYTES,
  MAX_TRACKED_SENT_IDS,
  timeLabel,
  toneFor,
} from './wa-format';

const SESSIONS_DIR = path.resolve(process.cwd(), '.sessions', 'whatsapp-default');

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
  /** Caixa de entrada por conta — ver `activeInboxId()`. */
  private readonly inboxIdCache = new Map<string, string>();
  private readonly groupCache = new Map<string, { subject: string; size: number; at: number }>();
  private readonly avatarCache = new Map<string, { url?: string; at: number }>();
  /** Ids de mensagens despachadas por esta plataforma — usados para ignorar o eco. */
  private readonly crmSentIds = new Set<string>();
  /** Última mensagem recebida por conversa: base para confirmar leitura no celular. */
  private readonly lastInboundKey = new Map<string, WAMessageKey>();
  /**
   * Chats de que já pedimos presença — ver a nota gêmea em `worker/session.ts`.
   *
   * Guarda conta e conversa porque o evento de presença chega com o JID e nada
   * mais, e ir ao banco a cada tecla do contato para descobrir o resto seria
   * pagar uma consulta por caractere digitado.
   */
  private readonly presenceByJid = new Map<
    string,
    { readonly accountId: string; readonly inboxId: string; readonly conversationId: string }
  >();
  private readonly typingByConversation = new Map<string, boolean>();
  private readonly contactsStore = new Map<string, Partial<WAContact>>();
  private readonly logger = pino({ level: 'silent' });

  constructor() {
    // O store de conversas e volatil, o disco não: descarta midia orfa antiga.
    void mediaStore.prune();

    // Restaura automaticamente no boot se houver credenciais salvas no Postgres.
    //
    // A escolha e deterministica (a conexao mais recente) porque este servico
    // mantem **uma** sessao por processo. Com `findFirst` sem ordem, duas contas
    // com WhatsApp salvo faziam o banco decidir qual delas seria atendida — e a
    // resposta podia mudar a cada reinicio, sem aviso. Atender varias caixas ao
    // mesmo tempo e o papel do worker (`src/worker.ts`), nao deste servico.
    if (process.env.VERCEL || process.env.NEXT_RUNTIME) {
      return;
    }

    setTimeout(async () => {
      try {
        const saved = await prisma.whatsAppConnection.findMany({
          where: { credsCipher: { not: null } },
          include: { inbox: true },
          orderBy: { updatedAt: 'desc' },
        });

        if (saved.length > 1) {
          console.warn(
            `[WhatsAppService] ${saved.length} conexoes salvas e este servico atende uma so. ` +
              'Restaurando a mais recente; para atender todas, use o worker.',
          );
        }

        const conn = saved[0];
        if (conn?.inbox) {
          // A conta vem da `Inbox` da propria conexao — e um fato do banco, nao
          // um palpite. O dono lido do disco so prevalece se for da mesma conta.
          const accountId = conn.inbox.accountId;
          this.owner =
            this.owner?.accountId === accountId
              ? this.owner
              : {
                  userId: conn.pairedByUserId ?? 'system',
                  userName: conn.profileName ?? 'Administrador',
                  accountId,
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
   *
   * Sem dono resolvido, devolve `undefined` — nunca um palpite. O padrao
   * anterior era cair em `'acc-solint'`, a conta de demonstracao do seed: uma
   * sessao que reconectasse antes de o dono ser lido gravaria conversa real de
   * cliente na conta errada, e nada no sistema acusaria o engano. Quem chama
   * agora precisa decidir o que fazer sem conta, e a decisao certa e recusar.
   *
   * E a mesma regra que `wa-owner.ts` ja aplicava ao ler o arquivo do dono:
   * recusar e melhor do que adivinhar.
   */
  private accountId(): string | undefined {
    return this.owner?.accountId;
  }

  /**
   * Caixa de entrada associada à conta ativa.
   *
   * Memorizado por conta: isto era consultado no banco **a cada mensagem
   * recebida**, e a caixa de uma conta não muda entre reconexões. A um custo de
   * ~130ms por ida ao Supabase, era a query mais cara do caminho quente pelo que
   * ela entregava. O cache é limpo no `disconnect`/`resetCaches`.
   */
  private async activeInboxId(): Promise<string | undefined> {
    const accId = this.accountId();
    if (!accId) return undefined;

    const cached = this.inboxIdCache.get(accId);
    if (cached) return cached;

    const inbox = await prisma.inbox.findFirst({
      where: { accountId: accId, channel: 'whatsapp' },
      select: { id: true },
    });
    const resolved = inbox?.id ?? `ibx-${accId}`;
    // Só memoriza o que veio do banco: o palpite `ibx-<conta>` é um fallback de
    // emergência e não deve congelar caso a caixa apareça depois.
    if (inbox?.id) this.inboxIdCache.set(accId, resolved);
    return resolved;
  }

  private updateStatus(patch: Partial<WhatsAppStatusPayload>) {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    waEventBus.emitStatus(this.currentStatus);
    // Espelha no banco sem bloquear: quem observa o status pela rota por caixa
    // (e qualquer outra instância) lê a linha, não a memória deste processo.
    // Fica fora do `await` de propósito — o status é informativo e não deve
    // somar ~130ms a cada transição de conexão.
    void this.persistStatus();
  }

  /**
   * Grava o status corrente na `WhatsAppConnection`.
   *
   * Nunca toca nas colunas de credencial: `updateMany` com campos nomeados, e
   * não `upsert`, justamente para que uma transição de status não possa apagar
   * o `credsCipher` de uma sessão válida.
   */
  private async persistStatus(): Promise<void> {
    try {
      const inboxId = await this.activeInboxId();
      if (!inboxId) return;
      // Carimba a caixa no status corrente: quem escuta por caixa precisa saber
      // de quem e o evento (ver `WhatsAppStatusPayload.inboxId`).
      if (this.currentStatus.inboxId !== inboxId) {
        this.currentStatus = { ...this.currentStatus, inboxId };
      }

      await prisma.whatsAppConnection.updateMany({
        where: { inboxId },
        data: {
          status: this.currentStatus.status,
          lastError: this.currentStatus.error ?? null,
          qrPayload: this.currentStatus.qr ?? null,
        },
      });

      // A caixa acompanha o socket em toda transição, e não só ao conectar.
      // O `Inbox.status` era escrito uma vez, no pareamento, e nunca mais:
      // uma caixa que caía continuava "conectado" na tela de Configurações.
      const accountId = this.accountId();
      if (accountId) {
        await prisma.inbox.updateMany({
          where: { id: inboxId, accountId },
          data: { status: inboxStatusFrom(this.currentStatus.status) },
        });
      }
    } catch {
      // O status é dado auxiliar: não vale derrubar a conexão porque o
      // espelhamento no banco falhou.
    }
  }

  /**
   * @param forceFresh descarta a sessão salva e força um novo pareamento.
   *   Só quem sabe que a credencial não presta deve pedir isso — ver abaixo.
   */
  async startSession(
    options: { owner?: WhatsAppOwner; resetAttempts?: boolean; forceFresh?: boolean } = {},
  ): Promise<WhatsAppStatusPayload> {
    const { owner, resetAttempts = true, forceFresh = false } = options;
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
      if (!inboxId) {
        throw new Error(
          'Nao foi possivel identificar a caixa de entrada: conecte a partir de uma sessao do CRM.',
        );
      }

      // `forceFresh` é explícito e nunca derivado de `isAuthenticated`.
      //
      // A regra anterior (`resetAttempts && !this.isAuthenticated`) tornava
      // destrutivo o caso mais comum de todos: `resetAttempts` é o padrão de
      // `startSession()`, e `isAuthenticated` volta a `false` a cada reinício do
      // processo — inclusive num hot-reload do `next dev`. Ou seja, clicar em
      // "Conectar" depois de editar um arquivo apagava as credenciais e as
      // chaves de uma sessão perfeitamente válida.
      //
      // Sessão não pareada já é tratada sem ajuda: `initPostgresAuthState`
      // devolve credenciais novas quando não há material decifrável no banco.
      const { state, saveCreds } = await initPostgresAuthState(inboxId, { forceFresh });

      const version = await waVersion();

      const sock = makeWASocket({
        version,
        logger: this.logger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        browser: Browsers.macOS('Desktop'),

        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: true,
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

      sock.ev.on('messaging-history.set', async () => {
        // Ignora histórico antigo recebido do celular — apenas mensagens novas pós-conexão
        console.log('[WhatsAppService] Histórico antigo ignorado (processando apenas novas mensagens privadas 1x1).');
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
          // Revoke: o Baileys manda `message: null` com `key.id` já apontando
          // para a apagada. Redundante com o ramo de `messages.upsert`, mas
          // `markMessageRevoked` é idempotente.
          if (update.update?.message === null && update.key.id) {
            void markMessageRevoked(update.key.id);
            continue;
          }
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

      sock.ev.on('presence.update', ({ id, presences }) => {
        void this.applyPresenceUpdate(id, presences);
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
      // Guarda a string crua. A imagem é gerada na borda que responde ao
      // navegador (`qr-image.ts`) — ver a explicação do teto do `pg_notify` lá.
      this.updateStatus({ status: 'aguardando_leitura', qr, error: undefined });
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
      const accountId = this.accountId();
      if (!inboxId || !accountId) {
        console.error('[WhatsAppService] Conectado sem dono resolvido — nada foi gravado.');
        return;
      }

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
        where: { id: inboxId, accountId },
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
        const avatarUrl = await this.fetchAvatar(accountId, jidNormalizedUser(userJid));
        if (avatarUrl) this.updateStatus({ avatarUrl });
      }

      void sock.sendPresenceUpdate('available');
      void this.subscribeRecentPresences();
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
  // Presença ("digitando")
  // ---------------------------------------------------------------------------

  /**
   * Pede ao WhatsApp a presença deste chat.
   *
   * A assinatura é obrigatória: o servidor não envia presença de quem não foi
   * pedido. Uma vez por chat basta — ela vale enquanto o socket viver, e o mapa
   * é esvaziado junto com ele.
   *
   * Falhar aqui não interrompe nada. Presença é enfeite; a mensagem que trouxe
   * este chat até aqui continua sendo gravada normalmente.
   */
  private watchPresence(
    jid: string,
    scope: { readonly accountId: string; readonly inboxId: string; readonly conversationId: string },
  ): void {
    const novo = !this.presenceByJid.has(jid);
    this.presenceByJid.set(jid, scope);
    this.presenceByJid.set(jidNormalizedUser(jid), scope);
    if (!novo) return;

    void this.socket?.presenceSubscribe(jid).catch(() => {
      // Chat que não aceita assinatura de presença: segue sem "digitando".
    });
  }

  private async subscribeRecentPresences(): Promise<void> {
    if (!this.socket) return;
    const accountId = this.accountId();
    const inboxId = await this.activeInboxId();
    if (!accountId || !inboxId) return;

    try {
      const recentConversations = await prisma.conversation.findMany({
        where: {
          accountId,
          inboxId,
          channel: 'whatsapp',
          channelThreadId: { not: { endsWith: '@g.us' } },
        },
        select: { id: true, channelThreadId: true },
        take: 50,
        orderBy: { lastActivityAt: 'desc' },
      });

      for (const conv of recentConversations) {
        if (conv.channelThreadId && isSupportedChatJid(conv.channelThreadId)) {
          this.watchPresence(conv.channelThreadId, { accountId, inboxId, conversationId: conv.id });
        }
      }
    } catch {
      // Ignora erro suave
    }
  }

  private async applyPresenceUpdate(
    jid: string,
    presences: Record<string, { lastKnownPresence?: string } | undefined> | undefined,
  ): Promise<void> {
    if (!jid || !presences || isJidGroup(jid) || jid.endsWith('@g.us')) return;

    let scope = this.presenceByJid.get(jid) ?? this.presenceByJid.get(jidNormalizedUser(jid));

    const accountId = this.accountId();
    const inboxId = await this.activeInboxId();

    if (!scope && accountId && inboxId) {
      const userDigits = userOf(jid);
      const conv = await prisma.conversation.findFirst({
        where: {
          accountId,
          inboxId,
          channel: 'whatsapp',
          OR: [
            { channelThreadId: jid },
            { channelThreadId: jidNormalizedUser(jid) },
            ...(userDigits ? [{ channelThreadId: `${userDigits}@s.whatsapp.net` }] : []),
            ...(userDigits ? [{ contact: { phone: `+${userDigits}` } }] : []),
          ],
        },
        select: { id: true },
      });

      if (conv) {
        scope = { accountId, inboxId, conversationId: conv.id };
        this.presenceByJid.set(jid, scope);
        this.presenceByJid.set(jidNormalizedUser(jid), scope);
      }
    }

    if (!scope) return;

    // `recording` é o áudio sendo gravado — para quem espera, é a mesma
    // informação que `composing`: o contato está respondendo agora.
    const typing = Object.values(presences).some(
      (presence) =>
        presence?.lastKnownPresence === 'composing' ||
        presence?.lastKnownPresence === 'recording',
    );

    if (this.typingByConversation.get(scope.conversationId) === typing) return;
    this.typingByConversation.set(scope.conversationId, typing);

    waEventBus.emitConversation({
      type: 'typing',
      accountId: scope.accountId,
      conversationId: scope.conversationId,
      inboxId: scope.inboxId,
      isTyping: typing,
    });
  }

  // ---------------------------------------------------------------------------
  // Entrada de mensagens
  // ---------------------------------------------------------------------------

  private async handleIncomingMessage(msg: WAMessage) {
    const socket = this.socket;
    if (!socket || !msg.message || !isSupportedChatJid(msg.key.remoteJid)) return;

    const messageId = msg.key.id;
    if (!messageId) return;

    // Sem conta resolvida a mensagem e descartada, de proposito.
    //
    // Gravar exige saber de quem e a conversa, e a unica fonte disso e o dono da
    // sessao. Antes existia um padrao (`acc-solint`, do seed) que fazia a
    // mensagem ser gravada de qualquer jeito — na conta errada, em silencio.
    // Perder uma mensagem e ruim; escrever a conversa de um cliente na conta de
    // outra empresa e pior, e muito mais dificil de descobrir.
    const accountId = this.accountId();
    const inboxId = await this.activeInboxId();
    if (!accountId || !inboxId) {
      console.warn(
        '[WhatsAppService] Mensagem recebida sem dono de sessao resolvido — descartada.',
      );
      return;
    }

    const fromMe = Boolean(msg.key.fromMe);

    // Apagar "para todos" chega como uma mensagem nova cujo conteúdo manda
    // revogar outra. Vem antes da checagem de eco: quando nós apagamos a linha
    // já foi marcada e `markMessageRevoked` sai sem fazer nada; quando o contato
    // apaga, o id não está em `crmSentIds` e o `return` seguinte engoliria tudo.
    const revogada = revokedMessageId(msg);
    if (revogada) {
      await markMessageRevoked(revogada);
      return;
    }

    // Mensagem despachada por esta plataforma: ja esta na timeline e o eco so
    // duplicaria a bolha. O status de entrega chega por `messages.update`.
    if (fromMe && this.crmSentIds.has(messageId)) return;

    const decoded = decodeWaMessage(msg);
    if (!decoded) return;

    const identity = await resolveChatIdentity(socket, msg.key, { accountId, inboxId });
    if (!identity) return;

    // Ver `resolveStoredIds`: os ids da identidade valem para chat novo; os de
    // um chat que ja existe sao os que o banco tem.
    const chat = await resolveStoredIds(accountId, inboxId, identity);

    // A mensagem é o gancho para assinar a presença deste chat: sem assinatura
    // o WhatsApp não manda "digitando" nenhum. Ver `watchPresence`.
    this.watchPresence(chat.jid, { accountId, inboxId, conversationId: chat.conversationId });
    this.typingByConversation.delete(chat.conversationId);

    console.log(`[WhatsAppService] Nova mensagem de ${chat.phone || chat.jid} (ID: ${messageId})`);

    const at = new Date(timestampOf(msg));
    const contact = await this.resolveContact(accountId, chat, msg, fromMe);

    // Se for grupo, cadastra/atualiza o contato do grupo no banco
    if (chat.isGroup) {
      await ensureStoredContact(accountId, contact, true);
      // Se o grupo não estiver autorizado pelo administrador, descarta a mensagem
      if (!isGroupAllowedInChat(contact)) {
        const dbContact = await prisma.contact.findFirst({
          where: { id: contact.id, accountId },
          select: { customFields: true },
        });
        const fields = Array.isArray(dbContact?.customFields)
          ? (dbContact.customFields as { label: string; value: string }[])
          : [];
        const isAllowed = fields.some(
          (f) =>
            (f.label === 'group_chat_enabled' || f.label === 'Permitido no Chat') &&
            f.value === 'true',
        );
        if (!isAllowed) {
          return;
        }
      }
    }

    const authorName = await this.resolveAuthorName(chat, msg, fromMe, contact.name);
    // A midia do WhatsApp e criptografada: sem decifrar e gravar localmente,
    // o navegador não tem como exibir foto, figurinha, GIF ou áudio.
    const content = decoded.media
      ? await this.materializeMedia(accountId, inboxId, msg, messageId, decoded.media, decoded.content)
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
      accountId,
      inboxId,
      chat,
      contact,
      message: appMessage,
      preview: decoded.preview,
      at,
      fromMe,
      // Ver a nota equivalente em `worker/session.ts`.
      ...(fromMe ? {} : (() => { const a = adContextOf(msg); return a ? { anuncio: a } : {}; })()),
    });

    console.log(`[WhatsAppService] Conversa ${chat.conversationId} persistida com sucesso!`);

    // A foto de perfil chega depois: atualiza a conversa quando resolver.
    void this.hydrateAvatar(accountId, chat);
  }

  /**
   * Decifra a midia e devolve o conteúdo definitivo.
   * Falhas nunca derrubam a mensagem: o texto descritivo continua valendo como
   * fallback, entao a conversa nunca perde um evento por causa de um download.
   */
  private async materializeMedia(
    accountId: string,
    inboxId: string,
    msg: WAMessage,
    messageId: string,
    media: MediaRef,
    fallback: MessageContent,
  ): Promise<MessageContent> {
    if (media.fileLength > MAX_INLINE_MEDIA_BYTES) return fallback;

    // Reprocessamento da mesma mensagem (reconexão, `append`) reusa o arquivo.
    if (await mediaStore.has(messageId)) return mediaContent(media, mediaUrlFor(messageId));

    const socket = this.socket;
    if (!socket) return fallback;

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: this.logger, reuploadRequest: socket.updateMediaMessage },
      );
      const url = await mediaStore.save(
        messageId,
        buffer,
        { mimeType: media.mimeType, ...(media.fileName ? { fileName: media.fileName } : {}) },
        { accountId, inboxId, kind: 'mensagem' },
      );
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
    accountId: string,
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
  ): Promise<Contact> {
    const existing = await loadStoredContact(accountId, chat);

    // O que ja existe no CRM (empresa, e-mail, etiquetas, notas) e preservado:
    // o canal so contribui com o que ele realmente conhece.
    const base = {
      ...existing,
      // O contato que ja existe mantem o id dele — ver a mesma nota no worker.
      id: existing?.id ?? chat.contactId,
      accountId,
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

    const inboundName = fromMe
      ? undefined
      : msg.pushName?.trim() || msg.verifiedBizName?.trim();
    const storedName = this.contactsStore.get(jidNormalizedUser(chat.jid))?.name?.trim();
    const name =
      inboundName ||
      storedName ||
      existing?.name ||
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
    if (!jid || isJidGroup(jid) || jid.endsWith('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) return;

    const normalized = jidNormalizedUser(jid);
    const existingStored = this.contactsStore.get(normalized);
    this.contactsStore.set(normalized, { ...existingStored, ...update });

    const phoneDigits = userOf(normalized);
    if (!phoneDigits) return;

    const phone = PhoneNumber.normalize(`+${phoneDigits}`);
    if (!PhoneNumber.isValid(phone)) return;

    const addressBookName = update.name?.trim();
    const pushName = update.notify?.trim() || update.verifiedName?.trim();
    const resolvedName = addressBookName || pushName || PhoneNumber.format(phone) || phone;
    const imgUrl =
      typeof update.imgUrl === 'string' && update.imgUrl !== 'changed' ? update.imgUrl : undefined;

    if (imgUrl) this.avatarCache.set(normalized, { url: imgUrl, at: Date.now() });

    const accountId = this.accountId();
    const inboxId = await this.activeInboxId();
    if (!accountId || !inboxId) return;

    try {
      const existing = await prisma.contact.findFirst({
        where: {
          accountId,
          kind: { not: 'grupo' },
          OR: [
            { phone },
            { id: `ct-wa-${phoneDigits}` },
            { id: `ct-wa-${accountId}-${phoneDigits}` },
          ],
        },
      });

      if (existing) {
        const shouldUpdateName =
          (addressBookName && existing.name !== addressBookName) ||
          (pushName && (existing.name.startsWith('+') || existing.name === phone));

        if (shouldUpdateName || (imgUrl && !existing.avatarUrl)) {
          await prisma.contact.update({
            where: { id: existing.id, accountId },
            data: {
              ...(shouldUpdateName ? { name: addressBookName || pushName } : {}),
              ...(imgUrl && !existing.avatarUrl ? { avatarUrl: imgUrl } : {}),
            },
          });
        }
      } else if (addressBookName) {
        // Contato com nome salvo na agenda do celular
        const contactId = `ct-wa-${accountId}-${phoneDigits}`;
        await prisma.contact.create({
          data: {
            id: contactId,
            accountId,
            name: resolvedName,
            phone,
            channel: 'whatsapp',
            avatarTone: 'blue',
            kind: 'pessoa',
            avatarUrl: imgUrl ?? null,
            customFields: asJson([]),
            timeline: asJson([]),
          },
        });
      }
    } catch {
      // Ignora colisões concorrentes
    }

    await patchContactByThread(accountId, inboxId, normalized, {
      ...(addressBookName || pushName ? { name: addressBookName || pushName } : {}),
      ...(imgUrl ? { avatarUrl: imgUrl } : {}),
    });
  }

  async syncAllStoredContacts(accountId: string): Promise<{ synced: number; created: number }> {
    let synced = 0;
    let created = 0;

    for (const [rawJid, contact] of this.contactsStore.entries()) {
      if (!rawJid || isJidGroup(rawJid) || rawJid.endsWith('@g.us') || rawJid.includes('@broadcast') || rawJid.includes('@newsletter')) continue;
      if (this.socket?.user?.id && jidNormalizedUser(rawJid) === jidNormalizedUser(this.socket.user.id)) continue;

      const phoneDigits = userOf(rawJid);
      if (!phoneDigits) continue;
      const phone = PhoneNumber.normalize(`+${phoneDigits}`);
      if (!PhoneNumber.isValid(phone)) continue;

      const addressBookName = contact.name?.trim();
      const pushName = contact.notify?.trim() || contact.verifiedName?.trim();
      const resolvedName = addressBookName || pushName || PhoneNumber.format(phone) || phone;
      const avatarUrl = typeof contact.imgUrl === 'string' && contact.imgUrl !== 'changed' ? contact.imgUrl : undefined;

      try {
        const existing = await prisma.contact.findFirst({
          where: {
            accountId,
            kind: { not: 'grupo' },
            OR: [
              { phone },
              { id: `ct-wa-${phoneDigits}` },
              { id: `ct-wa-${accountId}-${phoneDigits}` },
            ],
          },
        });

        synced += 1;
        if (existing) {
          if (addressBookName && existing.name !== addressBookName) {
            await prisma.contact.update({
              where: { id: existing.id, accountId },
              data: { name: addressBookName, ...(avatarUrl && !existing.avatarUrl ? { avatarUrl } : {}) },
            });
          }
        } else if (addressBookName || pushName) {
          const contactId = `ct-wa-${accountId}-${phoneDigits}`;
          await prisma.contact.create({
            data: {
              id: contactId,
              accountId,
              name: resolvedName,
              phone,
              channel: 'whatsapp',
              avatarTone: 'blue',
              kind: 'pessoa',
              avatarUrl: avatarUrl ?? null,
              customFields: asJson([]),
              timeline: asJson([]),
            },
          });
          created += 1;
        }
      } catch {
        // Ignora
      }
    }

    return { synced, created };
  }

  public async syncAllGroups(accountId: string): Promise<{ synced: number; created: number }> {
    const socket = this.socket;
    if (!socket) return { synced: 0, created: 0 };
    try {
      const groups = await socket.groupFetchAllParticipating();
      let synced = 0;
      let created = 0;
      for (const [jid, group] of Object.entries(groups)) {
        if (!jid.endsWith('@g.us')) continue;
        synced += 1;
        const key = `g-${userOf(jid)}`;
        const contactId = `ct-wa-${accountId}-${key}`;
        const existing = await prisma.contact.findFirst({
          where: { accountId, id: contactId },
        });
        if (!existing) {
          await prisma.contact.create({
            data: {
              id: contactId,
              accountId,
              name: group.subject || 'Grupo do WhatsApp',
              phone: '',
              channel: 'whatsapp',
              avatarTone: 'blue',
              kind: 'grupo',
              participantCount: group.size ?? group.participants?.length ?? 0,
              customFields: asJson([{ label: 'group_chat_enabled', value: 'false' }]),
              timeline: asJson([]),
            },
          });
          created += 1;
        } else {
          await prisma.contact.update({
            where: { id: existing.id, accountId },
            data: {
              name: group.subject || existing.name,
              participantCount: group.size ?? group.participants?.length ?? existing.participantCount,
            },
          });
        }
      }
      return { synced, created };
    } catch (err) {
      console.warn('[WhatsAppService] Falha ao sincronizar grupos:', err);
      return { synced: 0, created: 0 };
    }
  }

  private async renameGroupChat(jid: string, subject: string, size?: number) {
    const accountId = this.accountId();
    const inboxId = await this.activeInboxId();
    if (!accountId || !inboxId) return;

    await patchContactByThread(accountId, inboxId, jid, {
      name: subject,
      ...(size ? { participantCount: size } : {}),
    });
  }

  private async hydrateAvatar(accountId: string, chat: ChatIdentity) {
    const cached = this.avatarCache.get(chat.jid);
    if (cached && Date.now() - cached.at < AVATAR_TTL_MS) return;

    const url = await this.fetchAvatar(accountId, chat.jid);
    if (!url) return;
    if (!(await conversationExists(accountId, chat.conversationId))) return;
    await patchContact(chat.conversationId, { avatarUrl: url });
  }

  /**
   * Foto de perfil do contato, do grupo ou da propria conta.
   *
   * A URL que o WhatsApp devolve e assinada e expira em algumas horas — usa-la
   * direto faria os avatares quebrarem sozinhos com o tempo. Por isso a imagem
   * e copiada uma vez para o deposito local e servida pela aplicacao.
   */
  private async fetchAvatar(accountId: string, jid: string): Promise<string | undefined> {
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

      // Sem cópia própria, o `avatarUrl` gravado seria a URL assinada do
      // WhatsApp: ela expira em horas e o avatar quebra sozinho no banco.
      const ownUrl = await this.mirrorAvatar(accountId, mediaId, remoteUrl);

      // Por isso a falha da cópia não cai para `remoteUrl`: seria gravar
      // exatamente aquela URL, e o avatar quebrado só mudaria de data. Deixar
      // sem foto mantém o que já estiver no banco e refaz a tentativa no
      // próximo TTL.
      this.avatarCache.set(jid, { url: ownUrl, at: Date.now() });
      return ownUrl;
    } catch {
      // Foto privada ou indisponível: mantém a cópia que já existir.
      const fallback = (await mediaStore.has(mediaId)) ? mediaUrlFor(mediaId) : undefined;
      this.avatarCache.set(jid, { url: fallback, at: Date.now() });
      return fallback;
    }
  }

  /** Copia a foto assinada para o deposito local; devolve a URL estavel. */
  private async mirrorAvatar(
    accountId: string,
    mediaId: string,
    remoteUrl: string,
  ): Promise<string | undefined> {
    try {
      const response = await fetch(remoteUrl);
      if (!response.ok) return undefined;
      const buffer = Buffer.from(await response.arrayBuffer());
      return await mediaStore.save(
        mediaId,
        buffer,
        { mimeType: response.headers.get('content-type') ?? 'image/jpeg' },
        { accountId, kind: 'avatar' },
      );
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
    quote?: { readonly externalId: string; readonly fromMe: boolean; readonly text: string },
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
      const sent = await socket.sendMessage(
        jid,
        { text },
        quote ? { quoted: quotedStub(jid, quote) } : {},
      );
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
   * Apaga a mensagem para todos.
   *
   * `{ delete: chave }` é o protocolo do WhatsApp para "apagar para todos": a
   * mensagem some do aparelho do contato e vira o aviso cinza. Sem isto, apagar
   * no CRM seria só esconder de nós mesmos.
   */
  async deleteMessage(
    target: { readonly channelThreadId?: string; readonly phone?: string },
    externalId: string,
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
      await socket.sendMessage(jid, { delete: deletionKey(jid, externalId) });
      return { ok: true };
    } catch (error) {
      console.error('[WhatsAppService] Erro ao apagar mensagem:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao apagar a mensagem',
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

  /** Espelha no celular a leitura feita no CRM e subscreve a presença do contato. */
  async markConversationAsRead(conversationId: string): Promise<void> {
    if (!this.socket || this.currentStatus.status !== 'conectado') return;

    const key = this.lastInboundKey.get(conversationId);
    if (key) {
      try {
        await this.socket.readMessages([key]);
        this.lastInboundKey.delete(conversationId);
      } catch (error) {
        console.warn('[WhatsAppService] Não foi possível confirmar leitura:', error);
      }
    }

    const accountId = this.accountId();
    const inboxId = await this.activeInboxId();
    if (!accountId || !inboxId) return;

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId },
      select: { channelThreadId: true, contact: { select: { phone: true } } },
    });
    if (!conv) return;

    const raw = conv.channelThreadId ?? conv.contact?.phone;
    const targetJid = raw ? (isSupportedChatJid(raw) ? raw : jidFromPhone(raw)) : undefined;
    if (!targetJid) return;

    try {
      await this.socket.presenceSubscribe(targetJid);
      this.watchPresence(targetJid, { accountId, inboxId, conversationId });
    } catch {
      // Ignora falha suave
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
      this.socket.ev.removeAllListeners('presence.update');
      this.socket.end(undefined);
    } catch {
      // Ignora
    }
    this.socket = null;
    // As assinaturas de presença morrem com o socket. Mantê-las faria a sessão
    // seguinte julgar que já assinou o que ninguém assinou — e o "digitando"
    // pararia de chegar depois da primeira reconexão.
    this.presenceByJid.clear();
    this.typingByConversation.clear();
  }

  private resetCaches() {
    this.inboxIdCache.clear();
    this.groupCache.clear();
    this.avatarCache.clear();
    this.crmSentIds.clear();
    this.lastInboundKey.clear();
    this.presenceByJid.clear();
    this.typingByConversation.clear();
  }

  async sendPresence(
    rawTarget: string,
    status: 'composing' | 'paused' | 'recording',
  ): Promise<void> {
    if (!this.socket) return;
    const targetJid = isSupportedChatJid(rawTarget) ? rawTarget : jidFromPhone(rawTarget);
    if (!targetJid) return;
    try {
      await this.socket.presenceSubscribe(targetJid);
      await this.socket.sendPresenceUpdate(status, targetJid);
    } catch {
      // Ignora falha suave de presença
    }
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
