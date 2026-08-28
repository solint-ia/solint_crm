import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type Contact as WAContact,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type { Contact } from '@/core/domain/contact';
import type { Message, MessageContent } from '@/core/domain/message';
import { PhoneNumber, isGroupAllowedInChat } from '@/core/domain/contact';
import { DB_POOL_SIZE, asJson, prisma } from '@/infrastructure/db/prisma';
import { initPostgresAuthState, isPairedCreds } from '../auth/postgres-auth-state';
import {
  applyDeliveryUpdate,
  commitMessage,
  ensureContact,
  findSentMessage,
  findStoredContact,
  markMessageRevoked,
  patchContact,
  resolveStoredIds,
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
  revokedMessageId,
  timestampOf,
  adContextOf,
  type MediaRef,
} from '../wa-message-content';
import { mediaStore, mediaUrlFor } from '../wa-media-store';
import { deletionKey, quotedStub } from '../wa-quote';
import { baileysLogLevel, waLog } from '../wa-log';
import { waVersion } from '../wa-version';

import { waEventBus, type WhatsAppStatusPayload } from '../whatsapp-events';
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
} from '../wa-format';


/**
 * Teto da janela de silêncio da drenagem.
 *
 * Só existe para o caso de o aviso de fim nunca chegar. Passado esse tempo a
 * janela fecha sozinha, porque uma janela presa aberta faria as mensagens
 * seguintes pararem de aparecer em tempo real — um defeito pior que o que ela
 * conserta.
 */
const DRAIN_MAX_MS = 90_000;

/**
 * Teto de QR Codes emitidos numa tentativa de pareamento.
 *
 * O Baileys renova o QR sozinho a cada `qrTimeout` **sem fechar o socket**, e
 * `qrAttempts` só conta reconexão — então nada limitava esse ciclo: uma caixa
 * nunca pareada ficava emitindo QR para sempre, gravando no banco a cada volta,
 * muito depois de a tela que pediu o código ter sido fechada.
 *
 * Cinco códigos a um minuto cada é folga larga para alguém pegar o telefone e
 * escanear; passado isso, ninguém está olhando.
 */
const MAX_QR_CYCLES = 5;

/**
 * Limitador de concorrência mínimo.
 *
 * Uma fila de espera e um contador — não vale uma dependência nova. Quem chama
 * recebe uma promessa que só resolve quando houver vaga, e a vaga é devolvida
 * no `finally`, inclusive quando a tarefa falha.
 */
const createLimiter = (max: number) => {
  let running = 0;
  const waiting: (() => void)[] = [];

  return {
    run: async <T>(task: () => Promise<T>): Promise<T> => {
      if (running >= max) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      running += 1;
      try {
        return await task();
      } finally {
        running -= 1;
        waiting.shift()?.();
      }
    },
  };
};

/**
 * Teto de gravações simultâneas — **do worker, não de cada sessão**.
 *
 * O emissor do Baileys não aguarda um listener assíncrono, então uma fila
 * represada dispara nossos handlers todos de uma vez, sem limite. Cada um faz
 * várias idas ao Postgres, e o pool do worker tem dez conexões.
 *
 * O teto era por sessão, e essa era a conta errada: o pool é um só. Com uma
 * caixa, cinco gravações e dez conexões davam folga; com três caixas o mesmo
 * "cinco" virava quinze, o pool saturava e a fila de espera atingia justamente
 * as leituras de chave de que o Baileys precisa para decifrar a mensagem
 * seguinte — o sintoma aparecia como lentidão de mensagem, não de banco.
 *
 * `DB_POOL_SIZE` manda quando existe, porque é ele que define o denominador
 * desta conta; a folga que sobra é para as consultas do próprio Baileys e para
 * a fila de comandos, que dividem o mesmo pool.
 */
const limiteDeGravacao = createLimiter(Math.max(2, Math.floor(DB_POOL_SIZE / 2)));

export class WhatsAppSession {
  readonly inboxId: string;
  readonly accountId: string;

  private socket: WASocket | null = null;
  private isInitializing = false;
  private isAuthenticated = false;
  private retryCount = 0;
  private qrAttempts = 0;
  /**
   * QR Codes emitidos desde o último pareamento ou pedido explícito de conexão.
   *
   * Separado de `qrAttempts` porque conta outra coisa: aquele conta reconexão
   * após queda, este conta código mostrado — e é o segundo que corre solto
   * quando o socket fica de pé e o Baileys só troca o QR.
   */
  private qrCycles = 0;
  /**
   * A sessao ja foi pareada alguma vez?
   *
   * Lido das credenciais a cada `start()`. E o que separa dois casos que a
   * mesma queda de conexao produz: uma sessao pareada que caiu deve reconectar
   * sozinha; uma que nunca foi pareada nao tem o que reconectar — falta alguem
   * ler o QR, e insistir so gera ruido.
   */
  private isPaired = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentStatus: WhatsAppStatusPayload;

  private readonly groupCache = new Map<string, { subject: string; size: number; at: number }>();
  private readonly avatarCache = new Map<string, { url?: string; at: number }>();
  private readonly crmSentIds = new Set<string>();
  private readonly lastInboundKey = new Map<string, WAMessageKey>();
  /**
   * Chats de que já pedimos presença, e a conversa de cada um.
   *
   * O WhatsApp só manda "digitando" de quem se assinou explicitamente, e a
   * assinatura é por chat. O mapa serve às duas pontas: evita reassinar o mesmo
   * chat a cada mensagem e traduz o JID do evento de presença de volta para a
   * conversa, sem uma ida ao banco por tecla que o contato digita.
   */
  private readonly presenceByJid = new Map<string, string>();
  private readonly typingByConversation = new Map<string, boolean>();
  private readonly contactsStore = new Map<string, Partial<WAContact>>();
  /**
   * Silencioso por padrão, verboso sob demanda.
   *
   * Era `pino({ level: 'silent' })` fixo, e foi por isso que uma saturação do
   * keystore que atrasava os envios em minutos não deixou rastro nenhum — o
   * diagnóstico teve de ser feito lendo o banco por fora. A partir de
   * `WA_LOG_LEVEL=debug` o Baileys registra inclusive falha de decifra, que é o
   * que separa "a mensagem não chegou" de "chegou e não pôde ser lida".
   */
  private readonly logger = pino({ level: baileysLogLevel() });

  /**
   * Estado da drenagem da fila represada.
   *
   * Ao reconectar, o WhatsApp entrega de uma vez tudo o que reteve enquanto o
   * socket esteve fora. O Baileys processa esses nós **em série** (ver
   * `Utils/offline-node-processor.js`) e emite um `messages.upsert` por
   * mensagem — não um evento grande com várias.
   *
   * Enquanto isso corre, anunciar mensagem por mensagem faria a caixa de
   * entrada se redesenhar centenas de vezes, o que aparece na tela como um
   * carregamento lento e progressivo. As mensagens são gravadas caladas e, ao
   * final, cada conversa afetada é anunciada uma única vez — já no estado
   * final.
   */
  private drain: {
    active: boolean;
    closing: boolean;
    count: number;
    startedAt: number;
    touched: Set<string>;
    timer: NodeJS.Timeout | null;
  } = { active: false, closing: false, count: 0, startedAt: 0, touched: new Set(), timer: null };

  /**
   * Quantas mensagens **desta** sessão ainda estão sendo gravadas.
   *
   * O teto de concorrência é do worker inteiro (`limiteDeGravacao`), mas a
   * drenagem precisa saber quando *esta* caixa terminou — esperar as outras
   * atrasaria o anúncio de uma caixa calma por causa de uma movimentada.
   */
  private emVoo = 0;
  private readonly ociosos: (() => void)[] = [];

  constructor(inboxId: string, accountId: string) {
    this.inboxId = inboxId;
    this.accountId = accountId;
    this.currentStatus = {
      inboxId,
      status: 'desconectado',
      updatedAt: new Date().toISOString(),
    };
  }

  getStatus(): WhatsAppStatusPayload {
    return this.currentStatus;
  }

  private async updateStatus(patch: Partial<WhatsAppStatusPayload>) {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
      // Nunca sobrescrito por um patch: e a identidade da sessao, nao um estado.
      inboxId: this.inboxId,
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

    /**
     * O estado também é gravado na própria caixa.
     *
     * São duas colunas de propósito: `WhatsAppConnection.status` é o estado do
     * socket, com os cinco degraus do pareamento; `Inbox.status` é o que a tela
     * de Configurações lê, e fala de canal, não de socket. Só que o worker
     * atualizava a primeira e ignorava a segunda — o motor in-process já fazia
     * as duas. Em produção, onde quem roda é o worker, uma caixa recém-pareada
     * ficava "desconectado" na tela para sempre, com o identificador
     * `whatsapp-xxxxxx` no lugar do número.
     */
    await prisma.inbox.updateMany({
      where: { id: this.inboxId, accountId: this.accountId },
      data: {
        status: inboxStatusFrom(this.currentStatus.status),
        // O identificador só muda quando há número: um `undefined` a caminho
        // do desconectado apagaria o número que a caixa acabou de exibir.
        ...(this.currentStatus.status === 'conectado' && this.currentStatus.phone
          ? { identifier: this.currentStatus.phone }
          : {}),
      },
    });

    waEventBus.emitStatus(this.currentStatus);
  }

  async start(): Promise<WhatsAppStatusPayload> {
    // Sessão já de pé, ou já subindo: não há o que iniciar — mas há o que
    // corrigir. Quem enfileirou o `connect` gravou `conectando` na linha do
    // banco antes de mandar o comando, e sair daqui em silêncio deixava esse
    // `conectando` para sempre. O efeito aparecia longe: `getStatus` lia a
    // linha, via `conectando`, e a Server Action recusava todo envio com
    // "WhatsApp desconectado" numa sessão que estava conectada o tempo todo.
    if (this.socket && this.isAuthenticated) {
      await this.updateStatus({});
      return this.currentStatus;
    }
    if (this.isInitializing) {
      await this.updateStatus({});
      return this.currentStatus;
    }

    this.isInitializing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Fecha o socket anterior antes de abrir outro.
    this.teardownSocket();

    try {
      await this.updateStatus({ status: 'conectando', error: undefined });

      const { state, saveCreds } = await initPostgresAuthState(this.inboxId);
      // `registered` sozinho não responde a esta pergunta para quem pareou por
      // QR — ver a nota em `isPairedCreds`. Era por isso que uma sessão pareada
      // que caía ia parar no ramo do QR em vez de reconectar.
      this.isPaired = isPairedCreds(state.creds);
      const version = await waVersion();

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        browser: Browsers.macOS('Desktop'),

        logger: this.logger,
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60_000,
        /**
         * Um minuto era tempo demais para descobrir que uma consulta não vai
         * ser respondida. Como a fila de comandos é serial, cada espera dessas
         * segurava tudo o que viesse atrás — foi assim que um envio isolado
         * virou 300 segundos de atraso acumulado. Falhar em 20 s deixa a
         * mensagem ser marcada como falha e libera a fila.
         */
        defaultQueryTimeoutMs: 20_000,
        keepAliveIntervalMs: 25_000,
        qrTimeout: 60_000,


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

  /**
   * Envolve um listener do Baileys para que uma falha nele nunca derrube o
   * worker inteiro.
   *
   * O `EventEmitter` do Node não aguarda listeners assíncronos nem trata as
   * rejeições deles: sem isto, qualquer `await` que rejeitasse aqui dentro —
   * uma consulta ao Postgres, uma chamada de rede — virava uma rejeição não
   * tratada, e desde o Node 15 isso mata o processo por padrão. Foi assim que
   * uma falha pontual em `connection.update`, logo após um repareamento,
   * derrubou o worker inteiro e deixou a trava do banco presa até o TTL vencer
   * — o `restaurada na tentativa 2` que aparecia no boot seguinte.
   */
  private guarded<Args extends unknown[]>(
    event: string,
    handler: (...args: Args) => Promise<void>,
  ): (...args: Args) => Promise<void> {
    return async (...args: Args) => {
      try {
        await handler(...args);
      } catch (error) {
        console.error(`[WhatsAppSession ${this.inboxId}] Erro não tratado em '${event}':`, error);
      }
    };
  }

  private setupEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;

    this.socket.ev.on(
      'creds.update',
      this.guarded('creds.update', async () => {
        await saveCreds();
      }),
    );

    this.socket.ev.on(
      'connection.update',
      this.guarded('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.isInitializing = false;
        // Zerar `qrAttempts` aqui tornava o teto de 8 inalcançável: cada QR
        // recebido devolvia o orçamento inteiro, e o par QR→428→QR girava sem
        // fim. O contador pertence ao ciclo de reconexão, não ao QR.
        this.qrCycles += 1;

        if (this.qrCycles > MAX_QR_CYCLES) {
          console.log(
            `[WhatsAppSession ${this.inboxId}] ${MAX_QR_CYCLES} QR Codes emitidos sem leitura. ` +
              'Encerrando a tentativa de pareamento.',
          );
          this.teardownSocket();
          this.qrCycles = 0;
          await this.updateStatus({
            status: 'desconectado',
            qr: undefined,
            error: 'O QR expirou sem ser lido. Clique em conectar para gerar outro.',
          });
          return;
        }

        console.log(
          `[WhatsAppSession ${this.inboxId}] QR Code recebido (${this.qrCycles}/${MAX_QR_CYCLES}).`,
        );
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

        // Handshake transitório inicial do WebSocket WhatsApp para sessões não pareadas:
        // O servidor WhatsApp rotineiramente encerra o primeiro socket (código 428/515)
        // antes de despachar o QR. Reconectamos automaticamente para receber o código.
        if (!this.isPaired && !this.isAuthenticated) {
          if ((statusCode === 428 || statusCode === 515 || statusCode === DisconnectReason.restartRequired) && this.qrAttempts < 8) {
            this.qrAttempts += 1;
            console.log(
              `[WhatsAppSession ${this.inboxId}] Handshake transitório (${statusCode}). Tentativa ${this.qrAttempts}/8 gerando QR...`,
            );
            await this.updateStatus({ status: 'gerando_qr' });
            this.reconnectTimer = setTimeout(() => void this.start(), 1500);
            return;
          }

          // Os dois orçamentos voltam juntos: a mensagem acima manda clicar em
          // conectar, e a tentativa seguinte precisa começar inteira.
          this.qrAttempts = 0;
          this.qrCycles = 0;
          await this.updateStatus({
            status: 'desconectado',
            qr: undefined,
            error: 'O QR expirou sem ser lido. Clique em conectar para gerar outro.',
          });
          return;
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

      // O WhatsApp avisa quando terminou de entregar o que reteve enquanto
      // estivemos fora. É o sinal para anunciar de uma vez o que foi gravado
      // calado durante a drenagem.
      if (update.receivedPendingNotifications) {
        void this.finishDrain('fim da fila represada');
      }

      if (connection === 'open') {
        this.isInitializing = false;
        this.isAuthenticated = true;
        this.qrAttempts = 0;
        this.qrCycles = 0;
        this.retryCount = 0;
        this.beginDrain();

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
        void this.socket?.sendPresenceUpdate('available');
        void this.subscribeRecentPresences();
      }
      }),
    );


    this.socket.ev.on(
      'messaging-history.set',
      this.guarded('messaging-history.set', async (history) => {
        if ('contacts' in history && Array.isArray(history.contacts)) {
          for (const contact of history.contacts) {
            await this.handleContactSync(contact);
          }
        }
      }),
    );


    this.socket.ev.on(
      'messages.upsert',
      this.guarded('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        // O `await` aqui não serializa a fila represada: o Baileys emite um
        // evento por mensagem, então `messages` quase sempre tem um item só.
        // Quem controla o paralelismo real — entre invocações deste listener,
        // que o emissor do Baileys não aguarda — é o limitador.
        // O `guarded` de fora protege o listener, mas aborta o laço na
        // primeira exceção — e num lote represado isso descartaria todas as
        // mensagens seguintes por causa de uma. Cada mensagem responde só por
        // si.
        for (const msg of messages) {
          await limiteDeGravacao.run(async () => {
            this.emVoo += 1;
            try {
              await this.handleIncomingMessage(msg);
            } catch (error) {
              console.error(
                `[WhatsAppSession ${this.inboxId}] Falha ao processar a mensagem ` +
                  `${msg.key.id ?? '(sem id)'} de ${msg.key.remoteJid ?? '(sem jid)'}:`,
                error,
              );
            } finally {
              this.emVoo -= 1;
              if (this.emVoo === 0) for (const pronto of this.ociosos.splice(0)) pronto();
            }
          });
        }
      }),
    );

    this.socket.ev.on(
      'messages.update',
      this.guarded('messages.update', async (updates) => {
        for (const update of updates) {
          // O Baileys também traduz o revoke para cá (`message: null`), com
          // `update.key.id` já sendo o id da apagada. Redundante com o ramo de
          // `messages.upsert`, mas `markMessageRevoked` é idempotente e cobrir
          // os dois protege contra o Baileys mudar por qual caminho o entrega.
          if (update.update.message === null && update.key.id) {
            await markMessageRevoked(update.key.id);
            continue;
          }
          if (update.update.status && update.key.id) {
            const status = deliveryStatusFrom(update.update.status);
            if (status) {
              await applyDeliveryUpdate(update.key.id, status);
            }
          }
        }
      }),
    );

    this.socket.ev.on(
      'presence.update',
      this.guarded('presence.update', async ({ id, presences }) => {
        if (!id || !presences || isJidGroup(id) || id.endsWith('@g.us')) return;

        let conversationId =
          this.presenceByJid.get(id) ?? this.presenceByJid.get(jidNormalizedUser(id));

        if (!conversationId) {
          const userDigits = userOf(id);
          try {
            const conv = await prisma.conversation.findFirst({
              where: {
                accountId: this.accountId,
                inboxId: this.inboxId,
                channel: 'whatsapp',
                OR: [
                  { channelThreadId: id },
                  { channelThreadId: jidNormalizedUser(id) },
                  ...(userDigits ? [{ channelThreadId: `${userDigits}@s.whatsapp.net` }] : []),
                  ...(userDigits ? [{ contact: { phone: `+${userDigits}` } }] : []),
                ],
              },
              select: { id: true },
            });

            if (conv) {
              conversationId = conv.id;
              this.presenceByJid.set(id, conv.id);
              this.presenceByJid.set(jidNormalizedUser(id), conv.id);
            } else {
              this.presenceByJid.set(id, 'none');
              this.presenceByJid.set(jidNormalizedUser(id), 'none');
            }
          } catch {
            return;
          }
        }

        if (!conversationId || conversationId === 'none') return;

        const typing = Object.values(presences).some(
          (presence) =>
            presence?.lastKnownPresence === 'composing' ||
            presence?.lastKnownPresence === 'recording',
        );

        if (this.typingByConversation.get(conversationId) === typing) return;
        this.typingByConversation.set(conversationId, typing);

        waEventBus.emitConversation({
          type: 'typing',
          accountId: this.accountId,
          conversationId,
          inboxId: this.inboxId,
          isTyping: typing,
        });
      }),
    );

    this.socket.ev.on(
      'contacts.upsert',
      this.guarded('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
          await this.handleContactSync(contact);
        }
      }),
    );

    this.socket.ev.on(
      'contacts.update',
      this.guarded('contacts.update', async (updates) => {
        for (const update of updates) {
          await this.handleContactSync(update);
        }
      }),
    );
  }

  private async handleContactSync(contact: Partial<WAContact>): Promise<void> {
    const rawJid = contact.phoneNumber ?? contact.id;
    if (!rawJid || isJidGroup(rawJid) || rawJid.endsWith('@g.us') || rawJid.includes('@broadcast') || rawJid.includes('@newsletter')) return;

    if (this.socket?.user?.id && jidNormalizedUser(rawJid) === jidNormalizedUser(this.socket.user.id)) return;

    const jid = jidNormalizedUser(rawJid);
    const existingStored = this.contactsStore.get(jid);
    this.contactsStore.set(jid, { ...existingStored, ...contact });

    const phoneDigits = userOf(jid);
    if (!phoneDigits) return;

    const phone = PhoneNumber.normalize(`+${phoneDigits}`);
    if (!PhoneNumber.isValid(phone)) return;

    const addressBookName = contact.name?.trim();
    const pushName = contact.notify?.trim() || contact.verifiedName?.trim();
    const resolvedName = addressBookName || pushName || PhoneNumber.format(phone) || phone;
    const avatarUrl =
      typeof contact.imgUrl === 'string' && contact.imgUrl !== 'changed' ? contact.imgUrl : undefined;

    try {
      const existing = await prisma.contact.findFirst({
        where: {
          accountId: this.accountId,
          kind: { not: 'grupo' },
          OR: [
            { phone },
            { id: `ct-wa-${phoneDigits}` },
            { id: `ct-wa-${this.accountId}-${phoneDigits}` },
          ],
        },
      });

      if (existing) {
        const shouldUpdateName =
          (addressBookName && existing.name !== addressBookName) ||
          (pushName && (existing.name.startsWith('+') || existing.name === phone));

        if (shouldUpdateName || (avatarUrl && !existing.avatarUrl)) {
          await prisma.contact.update({
            where: { id: existing.id, accountId: this.accountId },
            data: {
              ...(shouldUpdateName ? { name: addressBookName || pushName } : {}),
              ...(avatarUrl && !existing.avatarUrl ? { avatarUrl } : {}),
            },
          });
        }
      } else {
        // Se for um contato salvo na agenda do celular (tem contact.name),
        // ou se já houver uma conversa direta existente com ele:
        const hasDirectConversation = await prisma.conversation.findFirst({
          where: {
            accountId: this.accountId,
            inboxId: this.inboxId,
            channel: 'whatsapp',
            channelThreadId: { not: { endsWith: '@g.us' } },
            OR: [
              { channelThreadId: jid },
              { channelThreadId: `${phoneDigits}@s.whatsapp.net` },
            ],
          },
          select: { id: true },
        });

        if (addressBookName || hasDirectConversation) {
          const contactId = `ct-wa-${this.accountId}-${phoneDigits}`;
          await prisma.contact.create({
            data: {
              id: contactId,
              accountId: this.accountId,
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
        }
      }
    } catch {
      // Ignora colisões concorrentes normais do Baileys
    }
  }

  async syncAllStoredContacts(): Promise<{ synced: number; created: number }> {
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
            accountId: this.accountId,
            kind: { not: 'grupo' },
            OR: [
              { phone },
              { id: `ct-wa-${phoneDigits}` },
              { id: `ct-wa-${this.accountId}-${phoneDigits}` },
            ],
          },
        });

        synced += 1;
        if (existing) {
          if (addressBookName && existing.name !== addressBookName) {
            await prisma.contact.update({
              where: { id: existing.id, accountId: this.accountId },
              data: { name: addressBookName, ...(avatarUrl && !existing.avatarUrl ? { avatarUrl } : {}) },
            });
          }
        } else if (addressBookName || pushName) {
          const contactId = `ct-wa-${this.accountId}-${phoneDigits}`;
          await prisma.contact.create({
            data: {
              id: contactId,
              accountId: this.accountId,
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
        // Ignora colisões concorrentes
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
      console.warn('[WhatsAppSession] Falha ao sincronizar grupos:', err);
      return { synced: 0, created: 0 };
    }
  }

  /**
   * Pede ao WhatsApp a presença deste chat.
   *
   * Sem a assinatura nenhum "digitando" chega — o servidor não a envia por
   * conta própria. Uma vez por chat basta: ela vale enquanto o socket viver, e
   * o mapa é esvaziado junto com ele em `teardownSocket`.
   *
   * A falha é engolida de propósito. Presença é enfeite; um chat cuja
   * assinatura o servidor recusou continua entregando mensagens normalmente, e
   * derrubar o processamento da mensagem por causa disso seria trocar o
   * essencial pelo acessório.
   */
  private watchPresence(jid: string, conversationId: string): void {
    if (this.presenceByJid.get(jid) === conversationId) return;
    const novo = !this.presenceByJid.has(jid);
    this.presenceByJid.set(jid, conversationId);
    if (!novo) return;

    void this.socket?.presenceSubscribe(jid).catch((error) => {
      waLog.debug(`[sessão ${this.inboxId}] Presença de ${jid} não assinada:`, error);
    });
  }

  private async subscribeRecentPresences(): Promise<void> {
    if (!this.socket) return;
    try {
      const recentConversations = await prisma.conversation.findMany({
        where: {
          accountId: this.accountId,
          inboxId: this.inboxId,
          channel: 'whatsapp',
          channelThreadId: { not: { endsWith: '@g.us' } },
        },
        select: { id: true, channelThreadId: true },
        take: 50,
        orderBy: { lastActivityAt: 'desc' },
      });

      for (const conv of recentConversations) {
        if (conv.channelThreadId && isSupportedChatJid(conv.channelThreadId)) {
          this.watchPresence(conv.channelThreadId, conv.id);
        }
      }
    } catch {
      // Ignora erro suave de subscrição inicial
    }
  }

  async sendPresence(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    status: 'composing' | 'paused' | 'recording',
  ): Promise<void> {
    if (!this.socket) return;
    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = raw ? (isSupportedChatJid(raw) ? raw : jidFromPhone(raw)) : undefined;
    if (!targetJid) return;

    try {
      await this.socket.presenceSubscribe(targetJid);
      await this.socket.sendPresenceUpdate(status, targetJid);
    } catch (error) {
      waLog.debug(`[sessão ${this.inboxId}] Falha ao emitir presença ${status} para ${targetJid}:`, error);
    }
  }

  /**
   * Abre a janela de silêncio ao conectar.
   *
   * Tudo que o WhatsApp reteve enquanto estivemos fora chega logo depois do
   * `open`. Não há como saber de antemão se são zero ou quinhentas mensagens,
   * então a janela abre sempre e fecha no aviso do servidor.
   */
  private beginDrain(): void {
    if (this.drain.timer) clearTimeout(this.drain.timer);

    // Rede de segurança: se o aviso de fim não vier — servidor que não o envia,
    // conexão que cai no meio —, a janela não pode ficar aberta para sempre,
    // ou as mensagens seguintes deixariam de aparecer na tela em tempo real.
    const timer = setTimeout(() => void this.finishDrain('tempo limite da janela'), DRAIN_MAX_MS);
    timer.unref?.();

    this.drain = {
      active: true,
      closing: false,
      count: 0,
      startedAt: Date.now(),
      touched: new Set(),
      timer,
    };
  }

  /**
   * Fecha a janela e anuncia o resultado.
   *
   * Um evento por **conversa afetada**, não por mensagem: numa fila de
   * quinhentas mensagens de vinte conversas, são vinte avisos em vez de
   * quinhentos, e cada um já carrega o estado final. O payload leva só
   * identificadores; quem recebe do outro lado do `NOTIFY` carrega a conversa.
   */
  private async finishDrain(motivo: string): Promise<void> {
    if (!this.drain.active || this.drain.closing) return;
    // O aviso do servidor e o tempo limite podem chegar os dois; e entre a
    // espera abaixo e a reinicialização do estado existe uma janela em que uma
    // segunda chamada entraria de novo.
    this.drain.closing = true;

    // As gravações ainda em voo precisam terminar antes do anúncio — senão o
    // evento descreveria uma conversa que ainda não está inteira no banco.
    await this.aguardarGravacoes();

    const { count, startedAt, touched } = this.drain;
    if (this.drain.timer) clearTimeout(this.drain.timer);
    this.drain = {
      active: false,
      closing: false,
      count: 0,
      startedAt: 0,
      touched: new Set(),
      timer: null,
    };

    if (count > 0) {
      console.log(
        `[WhatsAppSession ${this.inboxId}] Fila represada drenada: ${count} mensagem(ns) em ` +
          `${touched.size} conversa(s), ${Date.now() - startedAt}ms (${motivo}).`,
      );
    } else {
      waLog.debug(`[sessão ${this.inboxId}] Nenhuma mensagem represada (${motivo}).`);
    }

    for (const conversationId of touched) {
      waEventBus.emitConversation({
        type: 'conversation_updated',
        accountId: this.accountId,
        conversationId,
        inboxId: this.inboxId,
      });
    }
  }

  /** Resolve quando as mensagens desta caixa terminarem de ser gravadas. */
  private aguardarGravacoes(): Promise<void> {
    return this.emVoo === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => this.ociosos.push(resolve));
  }

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    const socket = this.socket;
    if (!socket || !msg.message || !isSupportedChatJid(msg.key.remoteJid)) return;

    const messageId = msg.key.id;
    if (!messageId) return;

    const fromMe = Boolean(msg.key.fromMe);

    // Apagar "para todos" chega como uma mensagem nova cujo conteúdo é a ordem
    // de revogar outra. Vem antes da checagem de eco: quando *nós* apagamos, a
    // linha já foi marcada e `markMessageRevoked` sai sem fazer nada — mas
    // quando o contato apaga, `crmSentIds` não tem o id e o `return` seguinte
    // engoliria o aviso.
    const revogada = revokedMessageId(msg);
    if (revogada) {
      await markMessageRevoked(revogada);
      return;
    }

    if (fromMe && this.crmSentIds.has(messageId)) return;

    const decoded = decodeWaMessage(msg);
    if (!decoded) return;

    const identity = await resolveChatIdentity(socket, msg.key, {
      accountId: this.accountId,
      inboxId: this.inboxId,
    });
    if (!identity) return;

    // Os ids que vieram da identidade sao sugestoes; os que valem sao os que
    // esta conta ja usa para este chat. Resolver aqui, uma vez, faz com que
    // tudo abaixo — gravacao, eventos de tempo real, drenagem — fale do mesmo
    // id que esta no banco.
    const chat = await resolveStoredIds(this.accountId, this.inboxId, identity);

    // A mensagem é a prova de que este chat está vivo — e o gancho para pedir a
    // presença dele. Só aqui: assinar tudo o que existe na agenda encheria o
    // socket de tráfego de presença de conversas que ninguém tem aberta.
    this.watchPresence(chat.jid, chat.conversationId);
    // Quem mandou a mensagem parou de digitar. Zerar a marca faz o próximo
    // "digitando" contar como mudança e voltar a ser anunciado.
    this.typingByConversation.delete(chat.conversationId);

    const at = new Date(timestampOf(msg));
    const contact = await this.resolveContact(chat, msg, fromMe);

    // Se for grupo, cadastra/atualiza o contato do grupo no banco
    if (chat.isGroup) {
      await ensureContact(this.accountId, contact, true);
      // Se o grupo não estiver autorizado pelo administrador, descarta a mensagem
      if (!isGroupAllowedInChat(contact)) {
        return;
      }
    }

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

    // Durante a drenagem a gravação é calada e a conversa entra na lista do
    // anúncio final. Fora dela, cada mensagem é anunciada na hora — é disso que
    // o tempo real depende.
    const draining = this.drain.active;
    if (draining) {
      this.drain.count += 1;
      this.drain.touched.add(chat.conversationId);
    }

    const medir = waLog.timer(`[sessão ${this.inboxId}] commitMessage`);
    await commitMessage({
      accountId: this.accountId,
      inboxId: this.inboxId,
      chat,
      contact,
      message: appMessage,
      preview: decoded.preview,
      at,
      fromMe,
      // So faz sentido no que o contato enviou: o eco do que nos mandamos
      // carrega o mesmo bloco e nao significa clique nenhum.
      ...(fromMe ? {} : (() => { const a = adContextOf(msg); return a ? { anuncio: a } : {}; })()),
      ...(draining ? { silent: true } : {}),
    });
    medir(`${fromMe ? 'saída' : 'entrada'} em ${chat.conversationId}`);

    // A foto só é buscada de quem ainda não tem uma.
    //
    // Antes isto rodava a cada mensagem recebida, e `profilePictureUrl` é uma
    // consulta ao servidor do WhatsApp pelo mesmo socket que entrega as
    // mensagens: numa conversa ativa, cada mensagem disputava a linha com o
    // próprio tráfego que a trouxe. O cache negativo dentro de `hydrateAvatar`
    // cobre quem não tem foto; esta condição cobre quem já tem.
    if (!contact.avatarUrl) void this.hydrateAvatar(chat);
  }

  private async resolveContact(
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
  ): Promise<Contact> {
    const existing = await findStoredContact(this.accountId, chat);

    const base = {
      ...existing,
      // O contato que ja existe mantem o id dele. `chat.contactId` so vale
      // quando nao ha nenhum — um contato cadastrado a mao no CRM tem id
      // proprio, e sobrescreve-lo criaria um duplicado com o mesmo telefone.
      id: existing?.id ?? chat.contactId,
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

    const mediaId = `pp-${userOf(chat.jid) || 'me'}`;

    try {
      // Teto próprio, menor que o da sessão: uma foto de perfil não vale
      // segurar recurso do socket. Quem não responder rápido cai no cache
      // negativo abaixo e será tentado de novo só depois do TTL.
      const remoteUrl = await Promise.race([
        this.socket.profilePictureUrl(chat.jid, 'image'),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8_000)),
      ]);
      if (!remoteUrl) {
        this.avatarCache.set(chat.jid, { url: undefined, at: Date.now() });
        return;
      }

      // Copia a imagem em vez de guardar a URL do WhatsApp: aquela e assinada e
      // expira em horas, entao o `avatarUrl` gravado quebraria sozinho no dia
      // seguinte. O motor in-process ja fazia isso; era a ultima divergencia.
      const response = await fetch(remoteUrl);
      const ownUrl = response.ok
        ? await mediaStore.save(
            mediaId,
            Buffer.from(await response.arrayBuffer()),
            { mimeType: response.headers.get('content-type') ?? 'image/jpeg' },
            { accountId: this.accountId, kind: 'avatar' },
          )
        : undefined;

      // Pela mesma razao, a falha da copia nao cai para `remoteUrl`: seria
      // gravar justamente aquela URL, e o avatar quebrado so mudaria de data.
      // Ficar sem foto preserva o que ja estiver no banco e refaz a tentativa
      // no proximo TTL.
      if (!ownUrl) {
        this.avatarCache.set(chat.jid, { url: undefined, at: Date.now() });
        return;
      }

      this.avatarCache.set(chat.jid, { url: ownUrl, at: Date.now() });
      await patchContact(chat.conversationId, { avatarUrl: ownUrl });
    } catch {
      // Foto privada ou indisponivel: mantem a copia que ja existir.
      const fallback = (await mediaStore.has(mediaId)) ? mediaUrlFor(mediaId) : undefined;
      this.avatarCache.set(chat.jid, { url: fallback, at: Date.now() });
    }
  }

  private async materializeMedia(
    msg: WAMessage,
    messageId: string,
    media: MediaRef,
    fallback: MessageContent,
  ): Promise<MessageContent> {
    if (media.fileLength > MAX_INLINE_MEDIA_BYTES) return fallback;
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
        { accountId: this.accountId, inboxId: this.inboxId, kind: 'mensagem' },
      );
      return url ? mediaContent(media, url) : fallback;
    } catch (error) {
      console.warn(`[WhatsAppSession ${this.inboxId}] Falha ao baixar mídia:`, error);
      return fallback;
    }
  }

  async sendMessage(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    content: { text?: string },
    options: {
      paced?: boolean;
      quote?: { externalId: string; fromMe: boolean; text: string };
    } = {},
  ): Promise<string> {
    if (!this.socket || !this.isAuthenticated) {
      throw new Error(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = raw ? (isSupportedChatJid(raw) ? raw : jidFromPhone(raw)) : undefined;
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

    // Cronometrado à parte de propósito: é o que separa "o Baileys está lento"
    // de "a fila está lenta". Sem esta medida, um envio de 3 minutos podia ser
    // qualquer um dos dois, e a diferença muda inteiramente onde se procura.
    const medir = waLog.timer(`[sessão ${this.inboxId}] socket.sendMessage`);
    const result = await this.socket.sendMessage(
      targetJid,
      { text },
      options.quote ? { quoted: quotedStub(targetJid, options.quote) } : {},
    );
    medir(`texto de ${text.length} caractere(s) para ${targetJid}`);

    const msgId = result?.key.id ?? `sent-${Date.now()}`;

    this.trackSentId(msgId);
    return msgId;
  }

  /**
   * Apaga a mensagem para todos.
   *
   * `{ delete: chave }` é o protocolo do WhatsApp: a mensagem some do aparelho
   * do contato e vira o aviso cinza. Apagar só no CRM esconderia de nós o que
   * continua visível para quem recebeu — que é o pior dos dois resultados.
   */
  async deleteMessage(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    externalId: string,
  ): Promise<void> {
    if (!this.socket || !this.isAuthenticated) {
      throw new Error(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = raw ? (isSupportedChatJid(raw) ? raw : jidFromPhone(raw)) : undefined;
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
    }

    await this.socket.sendMessage(targetJid, { delete: deletionKey(targetJid, externalId) });
  }

  /**
   * Envio de anexo.
   *
   * Os bytes vem do deposito local (`wa-media-store`), nao da fila: um video em
   * base64 dentro de uma coluna JSON incharia a tabela de comandos sem ganho
   * nenhum. O `mimetype` vai explicito porque o Baileys nao o deduz do buffer, e
   * o WhatsApp recusa o anexo se o tipo nao bater com o conteudo.
   */
  async sendMediaMessage(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    media: {
      kind: 'image' | 'video' | 'audio' | 'document';
      data: Buffer;
      mimeType: string;
      fileName?: string;
      caption?: string;
      voice?: boolean;
    },
  ): Promise<string> {
    if (!this.socket || !this.isAuthenticated) {
      throw new Error(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = raw ? (isSupportedChatJid(raw) ? raw : jidFromPhone(raw)) : undefined;
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
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

    const medir = waLog.timer(`[sessão ${this.inboxId}] socket.sendMessage (anexo)`);
    const result = await this.socket.sendMessage(targetJid, payload);
    medir(`${media.kind} de ${media.data.length} byte(s) para ${targetJid}`);

    const msgId = result?.key.id ?? `sent-${Date.now()}`;
    this.trackSentId(msgId);
    return msgId;
  }

  /** Janela deslizante: so o passado recente de envios precisa ser deduplicado. */
  private trackSentId(msgId: string): void {
    this.crmSentIds.add(msgId);
    if (this.crmSentIds.size > MAX_TRACKED_SENT_IDS) {
      const oldest = this.crmSentIds.values().next().value;
      if (oldest) this.crmSentIds.delete(oldest);
    }
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

  /** Encerra o socket corrente e solta os listeners presos a ele. */
  private teardownSocket(): void {
    if (!this.socket) return;
    try {
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.ev.removeAllListeners('messages.update');
      this.socket.ev.removeAllListeners('messaging-history.set');
      this.socket.ev.removeAllListeners('presence.update');
      this.socket.end(undefined);
    } catch {
      // Ignora erro ao fechar socket
    }
    this.socket = null;
    // As assinaturas de presença morrem com o socket: guardá-las faria a sessão
    // seguinte achar que já assinou o que ninguém assinou, e o "digitando"
    // simplesmente pararia de chegar depois da primeira reconexão.
    this.presenceByJid.clear();
    this.typingByConversation.clear();
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Fecha a janela de silêncio antes de sair: o que foi gravado calado ainda
    // não foi anunciado, e desligar sem isso deixaria as telas abertas sem
    // saber das mensagens que acabaram de entrar.
    await this.finishDrain('sessão encerrada');
    this.teardownSocket();
    this.isAuthenticated = false;
    this.isInitializing = false;
    // Encerramento explícito zera os orçamentos de pareamento: quem desconectar
    // e voltar a conectar começa do zero, não do que sobrou da tentativa antiga.
    this.qrAttempts = 0;
    this.qrCycles = 0;
    await this.updateStatus({ status: 'desconectado', qr: undefined });
  }
}
