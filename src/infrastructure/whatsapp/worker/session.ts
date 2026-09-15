import {
  DisconnectReason,
  downloadMediaMessage,
  isJidGroup,
  isLidUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
  type Contact as WAContact,
  type BaileysEventMap,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type { Contact } from '@/core/domain/contact';
import type { Message, MessageContent } from '@/core/domain/message';
import {
  PhoneNumber,
  isGroupAllowedInChat,
  groupInboxIds,
  GROUP_ALLOWED_FIELD_LABEL,
  GROUP_INBOXES_FIELD_LABEL,
  type CustomField,
} from '@/core/domain/contact';
import { DB_POOL_SIZE, asJson, prisma } from '@/infrastructure/db/prisma';
import { initPostgresAuthState, isPairedCreds, wipeAuthState } from '../auth/postgres-auth-state';
import { open } from '../auth/crypto';
import { SessaoIndisponivelError } from './errors';
import {
  applyDeliveryUpdate,
  applyReaction,
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
  normalizeTargetJid,
  phoneFromJid,
  resolveChatIdentity,
  resolvePhoneJid,
  resolveSenderIdentity,
  userOf,
  type ChatIdentity,
} from '../wa-identity';
import {
  decodeWaMessage,
  deliveryStatusFrom,
  mediaContent,
  mentionedJidsOf,
  revokedMessageId,
  timestampOf,
  type MediaRef,
} from '../wa-message-content';
import { base64ParaWebhook, buildUpsertPayload, mediaUrlAbsoluta } from '../wa-webhook-payload';
import { isApiTokenActor } from '@/core/domain/user';
import { dispararWebhooks } from '@/infrastructure/webhooks/webhook-dispatch';
import { isSafeMediaId, mediaStore, mediaUrlFor } from '../wa-media-store';
import { deletionKey, quotedStub } from '../wa-quote';
import { baileysLogLevel, waLog } from '../wa-log';
import { waVersion } from '../wa-version';
import { HistoryImporter, type HistoryImportStats } from './history-import';
import {
  ADDRESS_BOOK_FLUSH_MS,
  ADDRESS_BOOK_RETRY_MS,
  loadAddressBookNames,
  saveAddressBookNames,
} from '../wa-address-book';

import { waEventBus, type WhatsAppStatusPayload } from '../whatsapp-events';
import {
  AVATAR_TTL_MS,
  extractStatusCode,
  fallbackPersonName,
  GROUP_METADATA_TTL_MS,
  inboxStatusFrom,
  MAX_INLINE_MEDIA_BYTES,
  MAX_TRACKED_SENT_IDS,
  nomeDoContato,
  nomeUtilizavel,
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
const DRAIN_MAX_MS = 12_000;

/**
 * Silêncio máximo sem mensagem nova antes de fechar a janela.
 *
 * A drenagem existe para agrupar uma rajada, e uma rajada se reconhece por
 * continuidade: enquanto chegam mensagens, ela está acontecendo; três segundos
 * sem nenhuma e ela acabou. Fechar por ociosidade é o que impede uma mensagem
 * solta — a que chega logo depois de conectar, sem rajada nenhuma atrás dela —
 * de ficar retida até o teto da janela.
 */
const DRAIN_IDLE_MS = 3_000;

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
 * Quantas substituições seguidas (440) tolerar antes de desistir.
 *
 * Um deploy produz uma, no máximo duas: o worker antigo encerra e some. Um
 * WhatsApp Web aberto de verdade produz uma a cada tentativa, para sempre — e é
 * esse caso que o teto existe para interromper, com uma mensagem que diz o que
 * fazer em vez de reconectar em laço.
 */
const MAX_REPLACED_RETRIES = 4;

/** Recuo entre tentativas após 440, em milissegundos. */
const REPLACED_BACKOFF_MS = [3_000, 8_000, 20_000, 45_000];

/** Recuo entre reconexões após queda comum ou falha ao reabrir, em milissegundos. */
const RECONNECT_BACKOFF_MS = [3_000, 8_000, 20_000, 60_000];

/** Quanto esperar o WhatsApp aceitar a desvinculação antes de apagar o vínculo mesmo assim. */
const LOGOUT_TIMEOUT_MS = 10_000;

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

const createKeyedLimiter = (max: number) => {
  const global = createLimiter(max);
  const chains = new Map<string, Promise<void>>();

  return {
    run: <T>(key: string, task: () => Promise<T>): Promise<T> => {
      const previous = chains.get(key) ?? Promise.resolve();
      const execution = previous.catch(() => undefined).then(() => global.run(task));
      const tail = execution.then(
        () => undefined,
        () => undefined,
      );
      chains.set(key, tail);
      void tail.finally(() => {
        if (chains.get(key) === tail) chains.delete(key);
      });
      return execution;
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
const limiteDeGravacao = createKeyedLimiter(Math.max(2, Math.floor(DB_POOL_SIZE / 2)));

export class WhatsAppSession {
  readonly inboxId: string;
  readonly accountId: string;
  readonly lockVersion: number;
  private readonly workerId: string;

  private socket: WASocket | null = null;
  private socketGeneration = 0;
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
  /** E.164 sem o sinal de + enquanto o pareamento por codigo esta ativo. */
  private pairingPhone: string | undefined;
  /**
   * O código já foi pedido **neste socket**?
   *
   * O Baileys emite `qr` a cada rotação de referência, e cada pedido de código
   * invalida o anterior no servidor. Sem a trava, o código na tela mudaria a
   * cada ~20 s enquanto a pessoa ainda o digita no celular. Volta a `false` a
   * cada socket novo, em `start()`.
   */
  private pairingCodeRequested = false;
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
  /**
   * `stop()` ou `logout()` já rodaram: este objeto não abre mais socket.
   *
   * Um `start()` que estava no meio da inicialização quando a sessão foi
   * encerrada — esperando o banco, por exemplo — terminaria abrindo um socket
   * numa sessão que o gerenciador já descartou, e ninguém mais o fecharia.
   */
  private encerrada = false;
  /** Número da chamada mais recente de `start()`; as anteriores desistem ao ver outro. */
  private tentativaDeInicio = 0;
  /**
   * Quantas vezes seguidas esta sessão foi substituída por outra (440).
   *
   * Zerado a cada conexão bem-sucedida. Serve só para espaçar as tentativas:
   * duas sessões brigando pelo mesmo número se derrubam em laço, e reconectar
   * na hora transforma a briga em tempestade.
   */
  private replacedCount = 0;
  private currentStatus: WhatsAppStatusPayload;
  private historyImporter: HistoryImporter | null = null;
  private readonly onDemandHistory = new Map<
    string,
    { conversationId: string; importer: HistoryImporter; timer: NodeJS.Timeout }
  >();
  private historyConfig: {
    days: number;
    cutoff: Date;
    status: 'aguardando' | 'importando' | 'concluida' | 'parcial';
    ownerPhoneJid: string | null;
    startedAt: Date | null;
  } | null = null;
  private historyIdleTimer: NodeJS.Timeout | null = null;
  private historyStatsWrittenAt = 0;

  private readonly groupCache = new Map<string, { subject: string; size: number; at: number }>();
  private readonly avatarCache = new Map<string, { url?: string; at: number }>();
  /**
   * Nome da caixa, lido do banco uma vez por sessão.
   *
   * É o `instance` do corpo entregue aos webhooks, e a sessão só conhece o id.
   * Uma consulta por mensagem recebida seria uma ida ao banco a mais no caminho
   * mais quente do sistema, para um valor que só muda quando alguém renomeia a
   * caixa — e aí a sessão já vai ser reiniciada.
   */
  private inboxName: string | null = null;
  /**
   * Ids que o próprio CRM mandou por este socket, cada um com o id da linha do
   * CRM que o originou (quando se sabe).
   *
   * O id da linha é o que permite ao eco achar a mensagem sem depender do
   * `externalId`: esse só é gravado pelo consumidor da fila depois de o envio
   * voltar, e o eco pode chegar antes da gravação.
   */
  private readonly crmSentIds = new Map<string, string | undefined>();
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
  /**
   * Indicadores que esta sessao esta enviando para contatos.
   *
   * Cada JID tem seu proprio relogio. Assim, sustentar "digitando" nao segura a
   * raia de comandos da caixa e dois chats podem ter janelas independentes.
   * `outboundPresenceOnline` e separado porque `available` e global para a
   * conta: so voltamos a `unavailable` depois que o ultimo chat terminar.
   */
  private readonly outboundPresenceTimers = new Map<string, NodeJS.Timeout>();
  private readonly outboundPresenceOnline = new Set<string>();
  private readonly contactsStore = new Map<string, Partial<WAContact>>();
  /** A agenda completa já passou por esta sessão ou ainda exige resync manual? */
  private hasAddressBookSnapshot = false;
  /**
   * Nomes da agenda ainda não gravados no banco, por contato.
   *
   * Acumulados e gravados em lote: o pareamento entrega a agenda inteira de uma
   * vez, em milhares de eventos, e uma ida ao banco por contato disputaria o
   * pool com as mensagens. Ver `wa-address-book.ts`.
   */
  private readonly pendingAddressBook = new Map<string, string>();
  private addressBookTimer: NodeJS.Timeout | null = null;
  private addressBookFlush: Promise<void> | null = null;
  /** Número cuja agenda já voltou do banco nesta sessão. */
  private addressBookLoadedFor: string | null = null;
  /**
   * Nome já resolvido de cada participante de grupo.
   *
   * Um grupo ativo entrega dezenas de mensagens da mesma pessoa em sequência, e
   * sem esta memória cada uma repetiria a consulta ao cadastro do CRM. Vive com
   * o socket e é esvaziada com ele, porque é dele que vem o mapeamento LID→PN
   * que produziu a chave.
   */
  private readonly groupSenderNames = new Map<string, string>();
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
    idle: NodeJS.Timeout | null;
  } = {
    active: false,
    closing: false,
    count: 0,
    startedAt: 0,
    touched: new Set(),
    timer: null,
    idle: null,
  };

  /**
   * O servidor já avisou que terminou de entregar a fila represada?
   *
   * A pergunta parece redundante com a janela de drenagem, e não é — o aviso
   * chega **antes** de `connection: 'open'`. O Baileys emite
   * `receivedPendingNotifications` em `CB:ib,,offline`, que é onde ele descarrega
   * o buffer de eventos acumulado; só depois disso a conexão é anunciada como
   * aberta. Como `beginDrain` roda no `open`, a ordem real era: aviso de fim
   * (ignorado, porque nenhuma janela estava aberta ainda) → janela aberta →
   * ninguém para fechá-la.
   *
   * O resultado foi o defeito mais visível do produto: **toda** mensagem que
   * chegasse nos 90 segundos seguintes à conexão era gravada calada e só
   * aparecia na tela quando o tempo limite estourava. No log do Render isso
   * aparece como `Fila represada drenada: 1 mensagem(ns) ... 89999ms (tempo
   * limite da janela)` — uma mensagem só, retida um minuto e meio.
   *
   * Guardando o aviso, `beginDrain` sabe que não há nada a drenar e nem abre a
   * janela. O campo é zerado junto com o socket, porque ele descreve aquela
   * conexão e não a sessão.
   */
  private pendingNotificationsDone = false;

  /**
   * Quantas mensagens **desta** sessão ainda estão sendo gravadas.
   *
   * O teto de concorrência é do worker inteiro (`limiteDeGravacao`), mas a
   * drenagem precisa saber quando *esta* caixa terminou — esperar as outras
   * atrasaria o anúncio de uma caixa calma por causa de uma movimentada.
   */
  private emVoo = 0;
  private readonly ociosos: (() => void)[] = [];

  /**
   * Quem está esperando esta sessão ficar de pé.
   *
   * O envio não tinha como esperar: `start()` devolve assim que o socket é
   * construído — muito antes de `connection: 'open'` —, então quem mandasse uma
   * mensagem na janela de reconexão batia na guarda de `sendMessage` e via a
   * bolha virar "falha" em definitivo, mesmo que a sessão subisse dois segundos
   * depois. Esta lista é o que permite esperar a abertura em vez de desistir
   * dela. Ver `waitUntilConnected`.
   */
  private readonly prontos: ((abriu: boolean) => void)[] = [];

  constructor(
    inboxId: string,
    accountId: string,
    ownership: { readonly workerId: string; readonly lockVersion: number },
  ) {
    this.inboxId = inboxId;
    this.accountId = accountId;
    this.workerId = ownership.workerId;
    this.lockVersion = ownership.lockVersion;
    this.currentStatus = {
      inboxId,
      status: 'desconectado',
      updatedAt: new Date().toISOString(),
    };
  }

  getStatus(): WhatsAppStatusPayload {
    return this.currentStatus;
  }

  async fetchEarlierHistory(conversationId: string): Promise<void> {
    if (process.env.WA_HISTORY_ON_DEMAND !== '1') {
      throw new Error('Busca de histórico no celular está desabilitada.');
    }
    const socket = this.socket;
    if (!socket?.user || !this.isConnected) {
      throw new SessaoIndisponivelError('Conecte a caixa para buscar mensagens no celular.');
    }
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId: this.accountId, inboxId: this.inboxId },
      select: {
        channelThreadId: true,
        contact: { select: { kind: true } },
        messages: {
          where: { externalId: { not: null } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { externalId: true, author: true, createdAt: true },
        },
      },
    });
    const oldest = conversation?.messages[0];
    if (
      !conversation ||
      conversation.contact.kind === 'grupo' ||
      !conversation.channelThreadId ||
      !oldest?.externalId
    ) {
      throw new Error('Não há uma mensagem de referência para buscar o histórico anterior.');
    }

    const requestId = await socket.fetchMessageHistory(
      50,
      {
        remoteJid: conversation.channelThreadId,
        id: oldest.externalId,
        fromMe: oldest.author !== 'contact',
      },
      oldest.createdAt.getTime(),
    );
    const importer = new HistoryImporter({
      accountId: this.accountId,
      inboxId: this.inboxId,
      cutoff: new Date(0),
      resolveIdentity: (message) =>
        resolveChatIdentity(socket, message.key, {
          accountId: this.accountId,
          inboxId: this.inboxId,
        }),
      onBatch: (report) => {
        if (report.conversationIds.length > 0) {
          waEventBus.emitConversationsImported(
            this.accountId,
            this.inboxId,
            report.conversationIds,
          );
        }
      },
    });
    const timer = setTimeout(() => {
      const pending = this.onDemandHistory.get(requestId);
      if (!pending) return;
      pending.importer.stop();
      this.onDemandHistory.delete(requestId);
      waEventBus.emitConversation({
        type: 'history_fetch_status',
        accountId: this.accountId,
        inboxId: this.inboxId,
        conversationId,
        operationStatus: 'failed',
        error: 'O celular não respondeu. Mantenha o WhatsApp aberto no celular e tente de novo.',
      });
    }, 30_000);
    timer.unref?.();
    this.onDemandHistory.set(requestId, { conversationId, importer, timer });
  }

  private async receiveOnDemandHistory(
    history: BaileysEventMap['messaging-history.set'],
  ): Promise<boolean> {
    if (history.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) return false;
    const requestId = history.peerDataRequestSessionId;
    const pending = requestId ? this.onDemandHistory.get(requestId) : undefined;
    if (!pending) return true;
    clearTimeout(pending.timer);
    await pending.importer.enqueue(history, { onDemand: true });
    await pending.importer.drain();
    pending.importer.stop();
    this.onDemandHistory.delete(requestId!);
    waEventBus.emitConversation({
      type: 'history_fetch_status',
      accountId: this.accountId,
      inboxId: this.inboxId,
      conversationId: pending.conversationId,
      operationStatus: 'completed',
    });
    return true;
  }

  private historyImportWantsFull(): boolean {
    return Boolean(
      process.env.WA_HISTORY_IMPORT === '1' &&
      this.historyConfig &&
      this.historyConfig.days === 90 &&
      (this.historyConfig.status === 'aguardando' || this.historyConfig.status === 'importando'),
    );
  }

  private async writeHistoryStats(stats: Readonly<HistoryImportStats>, force = false) {
    if (!force && Date.now() - this.historyStatsWrittenAt < 5_000) return;
    this.historyStatsWrittenAt = Date.now();
    await prisma.whatsAppConnection.updateMany({
      where: { inboxId: this.inboxId, lockOwner: this.workerId, lockVersion: this.lockVersion },
      data: { historyImportStats: asJson(stats) },
    });
    this.currentStatus = {
      ...this.currentStatus,
      historyImport: {
        status: this.historyConfig?.status ?? 'importando',
        progresso: stats.progresso,
        mensagens: stats.mensagens,
        conversas: stats.conversasCriadas + stats.conversasAtualizadas,
      },
      updatedAt: new Date().toISOString(),
    };
    waEventBus.emitStatus(this.currentStatus);
  }

  private armHistoryIdle(generation: number): void {
    if (this.historyIdleTimer) clearTimeout(this.historyIdleTimer);
    this.historyIdleTimer = setTimeout(() => {
      if (generation === this.socketGeneration) void this.finishHistoryImport();
    }, 3 * 60_000);
    this.historyIdleTimer.unref?.();
  }

  private async finishHistoryImport(): Promise<void> {
    const importer = this.historyImporter;
    if (!importer || !this.historyConfig) return;
    await importer.drain();
    const status = importer.stats.falhas > 0 ? 'parcial' : 'concluida';
    this.historyConfig = { ...this.historyConfig, status };
    await this.writeHistoryStats(importer.stats, true);
    await prisma.whatsAppConnection.updateMany({
      where: { inboxId: this.inboxId, lockOwner: this.workerId, lockVersion: this.lockVersion },
      data: { historyImportStatus: status, historyImportEndedAt: new Date() },
    });
    if (this.historyIdleTimer) clearTimeout(this.historyIdleTimer);
    this.historyIdleTimer = null;
  }

  private async receiveHistory(
    history: BaileysEventMap['messaging-history.set'],
    generation: number,
  ): Promise<void> {
    if (await this.receiveOnDemandHistory(history)) return;
    if (
      generation !== this.socketGeneration ||
      !this.historyConfig ||
      !['aguardando', 'importando', 'concluida'].includes(this.historyConfig.status)
    )
      return;
    if (
      this.historyConfig.status === 'concluida' &&
      (!this.historyConfig.startedAt ||
        Date.now() - this.historyConfig.startedAt.getTime() > 24 * 60 * 60 * 1000)
    )
      return;
    const socket = this.socket;
    if (!socket) return;
    const ownJid = socket.user?.id ? jidNormalizedUser(socket.user.id) : null;
    if (
      ownJid &&
      this.historyConfig.ownerPhoneJid &&
      ownJid !== jidNormalizedUser(this.historyConfig.ownerPhoneJid)
    ) {
      await prisma.whatsAppConnection.updateMany({
        where: { inboxId: this.inboxId, lockOwner: this.workerId, lockVersion: this.lockVersion },
        data: { historyImportStatus: 'numero_diferente', historyImportEndedAt: new Date() },
      });
      this.historyConfig = null;
      return;
    }

    if (this.historyConfig.status === 'aguardando') {
      const startedAt = new Date();
      await prisma.whatsAppConnection.updateMany({
        where: { inboxId: this.inboxId, lockOwner: this.workerId, lockVersion: this.lockVersion },
        data: {
          historyImportStatus: 'importando',
          historyImportStartedAt: startedAt,
          ...(ownJid ? { historyOwnerPhoneJid: ownJid } : {}),
        },
      });
      this.historyConfig = {
        ...this.historyConfig,
        status: 'importando',
        startedAt,
        ownerPhoneJid: ownJid ?? this.historyConfig.ownerPhoneJid,
      };
    }

    if (!this.historyImporter) {
      this.historyImporter = new HistoryImporter({
        accountId: this.accountId,
        inboxId: this.inboxId,
        cutoff: this.historyConfig.cutoff,
        resolveIdentity: (message) =>
          resolveChatIdentity(socket, message.key, {
            accountId: this.accountId,
            inboxId: this.inboxId,
          }),
        onBatch: async (report, stats) => {
          await this.writeHistoryStats(stats);
          if (report.conversationIds.length > 0) {
            waEventBus.emitConversationsImported(
              this.accountId,
              this.inboxId,
              report.conversationIds,
            );
          }
        },
      });
    }
    await this.historyImporter.enqueue(history);
    this.armHistoryIdle(generation);
  }

  /**
   * O socket está de pé e autenticado?
   *
   * A pergunta que o banco **não** responde. `WhatsAppConnection.status` é um
   * valor gravado, e ele só é verdade enquanto a gravação seguinte acontecer;
   * isto aqui é o objeto vivo. Quando os dois divergem, quem manda é este.
   */
  get isConnected(): boolean {
    return Boolean(this.socket) && this.isAuthenticated;
  }

  /**
   * Já existe uma tentativa de conexão em curso ou agendada?
   *
   * Serve para distinguir os dois motivos de uma sessão não estar de pé, que
   * pedem respostas opostas: se ela está subindo, o certo é esperar; se está
   * parada e ninguém vai levantá-la, o certo é chamar `start()`. Sem essa
   * distinção, todo envio na janela de reconexão reiniciaria o socket por
   * cima de uma tentativa que já estava andando — e o recuo do 440, que existe
   * para não brigar com um WhatsApp Web aberto, seria atropelado.
   */
  get isReconnecting(): boolean {
    return this.isInitializing || this.reconnectTimer !== null;
  }

  /**
   * Espera a sessão abrir, até `timeoutMs`. `false` se o prazo vencer.
   *
   * Não dispara conexão nenhuma — só observa. Quem decide levantar a sessão é
   * quem chama, porque essa decisão depende de `isReconnecting`.
   */
  async waitUntilConnected(timeoutMs: number): Promise<boolean> {
    if (this.isConnected) return true;

    return new Promise<boolean>((resolve) => {
      // `avisar` só é chamado depois de entrar na lista, o que acontece abaixo
      // da criação do prazo: quando ele roda, `prazo` já existe.
      const avisar = (abriu: boolean) => {
        clearTimeout(prazo);
        resolve(abriu);
      };

      const prazo = setTimeout(() => {
        const posicao = this.prontos.indexOf(avisar);
        if (posicao !== -1) this.prontos.splice(posicao, 1);
        resolve(false);
      }, timeoutMs);
      prazo.unref?.();

      this.prontos.push(avisar);
    });
  }

  /** Libera quem espera pela abertura. */
  private liberarEspera(abriu: boolean): void {
    for (const avisar of this.prontos.splice(0)) avisar(abriu);
  }

  /**
   * Solta quem espera a abertura, sem mexer no socket.
   *
   * Usado no desligamento do worker: um envio parado em `waitUntilConnected`
   * seguraria a fila por até trinta segundos esperando uma reconexão que o
   * encerramento vai impedir de qualquer jeito. Solto, ele volta para a fila e o
   * worker seguinte o executa.
   */
  cancelarEsperas(): void {
    this.liberarEspera(false);
  }

  /**
   * Agenda a volta da sessão.
   *
   * É método próprio — e é chamado **antes** de qualquer gravação no banco —
   * porque o agendamento é a única coisa do tratador de queda que não pode ser
   * perdida. O tratador inteiro roda dentro de `guarded`, que engole exceções:
   * quando `updateStatus` falhava (e ele falha justamente sob a pressão de
   * pooler que já derrubou este worker antes), a queda tomava o caminho
   * `isAuthenticated = false` → exceção → **nada**. Sobrava uma sessão zumbi:
   * socket morto, banco preso em `conectado`, tela verde, todo envio recusado,
   * e nenhuma reconexão a caminho. Só um clique em "Conectar" ou um reinício do
   * worker tiravam a caixa daquilo.
   *
   * Armado primeiro, o pior caso de uma falha de banco passa a ser um estado
   * desatualizado por alguns segundos — que a própria reconexão corrige ao
   * gravar `conectando` e depois `conectado`.
   */
  private agendarReconexao(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      // `start()` relança a falha para quem o chamou pedir. Aqui não há quem
      // peça: solta, a rejeição derrubaria o worker inteiro — todas as caixas —
      // por uma consulta que falhou na reconexão de uma só.
      this.start().catch((error: unknown) => this.reconexaoFalhou(error));
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  /**
   * A reabertura agendada falhou antes de o socket existir — em geral, o banco.
   *
   * Desistir aqui deixava a caixa parada até alguém clicar em "Conectar". A
   * falha é da infraestrutura, não da sessão, então a resposta é tentar de novo
   * com recuo. As exceções são a posse perdida para outro worker, que o
   * heartbeat vai tratar, e a sessão já encerrada.
   */
  private reconexaoFalhou(error: unknown): void {
    if (error instanceof SessaoIndisponivelError || this.encerrada) return;
    this.retryCount += 1;
    const espera =
      RECONNECT_BACKOFF_MS[Math.min(this.retryCount - 1, RECONNECT_BACKOFF_MS.length - 1)] ??
      60_000;
    console.error(
      `[WhatsAppSession ${this.inboxId}] Falha ao reabrir a sessão. ` +
        `Nova tentativa em ${Math.round(espera / 1000)}s:`,
      error,
    );
    this.agendarReconexao(espera);
  }

  /**
   * Grava o estado sem deixar a falha escapar.
   *
   * Usado no tratador de queda, onde uma exceção não custaria só a linha do
   * banco: ela abortaria o resto do tratador. O erro é registrado — perder a
   * gravação em silêncio seria trocar um defeito visível por um invisível.
   */
  /**
   * Pede o código de 8 caracteres, uma vez por socket.
   *
   * Só é chamado a partir do primeiro `qr`: antes dele o WebSocket não está
   * aberto e o Baileys recusa o envio (ver o comentário em `start()`). As
   * chaves que o pedido gera são salvas pelo handler de `creds.update`.
   *
   * A falha não é relançada: quem pediu a conexão já recebeu a resposta do
   * `start()`. Ela vira estado — `desconectado` com o motivo —, que é o que a
   * tela acompanha.
   */
  private async solicitarCodigoDePareamento(): Promise<void> {
    const socket = this.socket;
    if (this.pairingCodeRequested || !this.pairingPhone || !socket) return;
    this.pairingCodeRequested = true;

    try {
      const code = await socket.requestPairingCode(this.pairingPhone);
      // O socket pode ter sido trocado enquanto o pedido estava em voo: o
      // código pertence ao socket antigo e não vale mais nada.
      if (this.socket !== socket) return;
      this.isInitializing = false;
      await this.registrarEstado({
        status: 'aguardando_codigo',
        pairingCode: code.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
        qr: undefined,
        error: undefined,
      });
    } catch (error) {
      if (this.socket !== socket) return;
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      console.error(
        `[WhatsAppSession ${this.inboxId}] Falha ao pedir o código de pareamento:`,
        error,
      );
      this.isInitializing = false;
      this.pairingPhone = undefined;
      this.teardownSocket();
      await this.registrarEstado({
        status: 'desconectado',
        qr: undefined,
        pairingCode: undefined,
        error: `Não foi possível gerar o código de pareamento (${message}). Tente novamente.`,
      });
    }
  }

  private async registrarEstado(
    patch: Partial<WhatsAppStatusPayload>,
    opcoes: { readonly autoConnect?: boolean } = {},
  ): Promise<void> {
    try {
      await this.updateStatus(patch, opcoes);
    } catch (error) {
      console.error(
        `[WhatsAppSession ${this.inboxId}] Falha ao gravar o estado ` +
          `'${patch.status ?? this.currentStatus.status}':`,
        error,
      );
    }
  }

  /**
   * Grava o estado do socket e, quando `opcoes.autoConnect` vem, a intenção de
   * conexão junto — na mesma escrita cercada pela posse, para as duas nunca
   * divergirem.
   */
  private async updateStatus(
    patch: Partial<WhatsAppStatusPayload>,
    opcoes: { readonly autoConnect?: boolean } = {},
  ) {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
      // Nunca sobrescrito por um patch: e a identidade da sessao, nao um estado.
      inboxId: this.inboxId,
      updatedAt: new Date().toISOString(),
    };
    if (this.currentStatus.status !== 'aguardando_codigo') {
      this.currentStatus = { ...this.currentStatus, pairingCode: undefined };
    }
    if (this.currentStatus.status !== 'aguardando_leitura') {
      this.currentStatus = { ...this.currentStatus, qr: undefined };
    }

    /**
     * Estado terminal solta quem espera na hora.
     *
     * `desconectado` é o único que ninguém vai desfazer sozinho: os demais são
     * degraus a caminho de `conectado`. Sem isto, um envio enfileirado contra
     * uma caixa deslogada ou substituída em definitivo ficaria os trinta
     * segundos inteiros esperando uma abertura que já se sabe que não vem.
     *
     * Antes das gravações de propósito: a informação já é verdadeira aqui, e
     * ela não pode depender de o Postgres responder.
     */
    if (this.currentStatus.status === 'desconectado') this.liberarEspera(false);

    const { count } = await prisma.whatsAppConnection.updateMany({
      where: {
        inboxId: this.inboxId,
        lockOwner: this.workerId,
        lockVersion: this.lockVersion,
      },
      data: {
        status: this.currentStatus.status,
        lastError: this.currentStatus.error ?? null,
        qrPayload: this.currentStatus.qr ?? null,
        pairingCode: this.currentStatus.pairingCode ?? null,
        profileName: this.currentStatus.name ?? null,
        phoneJid: this.currentStatus.phone ?? null,
        ...(this.currentStatus.status === 'conectado'
          ? { lastConnectedAt: new Date(), retryCount: 0 }
          : {}),
        ...(opcoes.autoConnect !== undefined ? { autoConnect: opcoes.autoConnect } : {}),
      },
    });
    if (count !== 1) {
      this.isAuthenticated = false;
      this.teardownSocket();
      throw new SessaoIndisponivelError(
        `A posse da sessão ${this.inboxId} mudou para outro worker.`,
      );
    }

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

  /** O pedido escolhe um método de pareamento diferente do que está em curso? */
  private trocaDeMetodo(options: { pairingMethod?: 'qr' | 'phone'; pairingPhone?: string }) {
    if (options.pairingMethod === 'phone') return options.pairingPhone !== this.pairingPhone;
    if (options.pairingMethod === 'qr') return this.pairingPhone !== undefined;
    return false;
  }

  async start(
    options: { pairingMethod?: 'qr' | 'phone'; pairingPhone?: string } = {},
  ): Promise<WhatsAppStatusPayload> {
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
    // Subindo, mas com outro método de pareamento pedido: o pedido novo vence.
    // Sem isto, escolher "código" enquanto o QR ainda estava sendo gerado não
    // fazia nada, e o código nunca chegava.
    if (this.isInitializing && !this.trocaDeMetodo(options)) {
      await this.updateStatus({});
      return this.currentStatus;
    }

    // Reconexoes internas chamam start() sem opcoes e preservam o telefone.
    // Apenas um comando explicito escolhe ou troca o metodo de pareamento.
    if (options.pairingMethod === 'phone') {
      this.pairingPhone = options.pairingPhone;
    } else if (options.pairingMethod === 'qr') {
      this.pairingPhone = undefined;
    }

    this.isInitializing = true;
    const tentativa = ++this.tentativaDeInicio;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Fecha o socket anterior antes de abrir outro.
    this.teardownSocket();
    this.pairingCodeRequested = false;

    try {
      await this.updateStatus({
        status: 'conectando',
        error: undefined,
        qr: undefined,
        pairingCode: undefined,
      });

      const { state, saveCreds } = await initPostgresAuthState(this.inboxId, {
        workerId: this.workerId,
        lockVersion: this.lockVersion,
      });
      // A agenda volta do banco antes do socket abrir. Sem isto, a fila represada
      // chegaria com a memória vazia e o nome salvo no celular perderia para o
      // nome do perfil até alguém sincronizar os contatos de novo.
      await this.loadAddressBook(state.creds.me?.id);
      const historyRow =
        process.env.WA_HISTORY_IMPORT === '1'
          ? await prisma.whatsAppConnection.findUnique({
              where: { inboxId: this.inboxId },
              select: {
                historyImportDays: true,
                historyImportCutoff: true,
                historyImportStatus: true,
                historyOwnerPhoneJid: true,
                historyImportStartedAt: true,
              },
            })
          : null;
      const historyStatus = historyRow?.historyImportStatus;
      this.historyConfig =
        historyRow?.historyImportDays &&
        historyRow.historyImportCutoff &&
        (historyStatus === 'aguardando' ||
          historyStatus === 'importando' ||
          historyStatus === 'concluida' ||
          historyStatus === 'parcial')
          ? {
              days: historyRow.historyImportDays,
              cutoff: historyRow.historyImportCutoff,
              status: historyStatus,
              ownerPhoneJid: historyRow.historyOwnerPhoneJid,
              startedAt: historyRow.historyImportStartedAt,
            }
          : null;
      if (
        this.historyConfig?.status === 'aguardando' &&
        Number(state.creds.accountSyncCounter ?? 0) > 0
      ) {
        await prisma.whatsAppConnection.updateMany({
          where: { inboxId: this.inboxId, lockOwner: this.workerId, lockVersion: this.lockVersion },
          data: { historyImportStatus: 'nao_disponivel', historyImportEndedAt: new Date() },
        });
        this.historyConfig = null;
      }
      // `registered` sozinho não responde a esta pergunta para quem pareou por
      // QR — ver a nota em `isPairedCreds`. Era por isso que uma sessão pareada
      // que caía ia parar no ramo do QR em vez de reconectar.
      this.isPaired = isPairedCreds(state.creds);
      const version = await waVersion();

      // Encerrada, ou atropelada por um `start()` mais novo, enquanto esperava o
      // banco ou a rede: abrir o socket agora criaria uma conexão que ninguém
      // mais fecharia. A tentativa mais nova é a que vale.
      if (this.encerrada || tentativa !== this.tentativaDeInicio) {
        if (tentativa === this.tentativaDeInicio) this.isInitializing = false;
        return this.currentStatus;
      }

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        /**
         * O aparelho vinculado se apresenta como o que é.
         *
         * A tupla é `[os, navegador, versão]`, e o WhatsApp usa cada posição:
         *
         *   - `browser[0]` vira `os` no registro (`Utils/validate-connection.js`),
         *     e é o texto que aparece no aviso de segurança do celular. Com
         *     `Browsers.macOS(...)` a notificação dizia "Você acessou o WhatsApp
         *     Business em um macOS" — o dono não tem Mac nenhum, e não havia
         *     como saber que aquilo era o próprio CRM.
         *   - `browser[1] === 'Desktop'` combinado com um `os` conhecido faz o
         *     Baileys preencher `webSubPlatform`, registrando a sessão como o
         *     **aplicativo nativo de desktop**. Um app nativo é um cliente de
         *     primeira classe para o WhatsApp; uma sessão de navegador, como a
         *     do WhatsApp Web, não é. Como o celular continua notificando
         *     normalmente quando só o WhatsApp Web está aberto, vale registrar
         *     como navegador.
         *
         * `'Solint CRM'` não está no `PLATFORM_MAP`, então as duas coisas se
         * resolvem de uma vez: o aviso passa a nomear o CRM e o registro deixa
         * de se passar por app nativo.
         */
        browser: ['Solint CRM', 'Chrome', '1.0.0'],

        logger: this.logger,
        syncFullHistory: this.historyImportWantsFull(),
        // Declarar o callback evita que versões rc do Baileys descartem também
        // os blocos RECENT necessários aos mapeamentos LID. FULL só será aceito
        // quando a importação explícita de 90 dias estiver ativa.
        shouldSyncHistoryMessage: ({ syncType }) =>
          syncType !== proto.HistorySync.HistorySyncType.FULL || this.historyImportWantsFull(),
        generateHighQualityLinkPreview: true,
        /**
         * O CRM é um aparelho vinculado, não a pessoa.
         *
         * Com `true`, o Baileys manda `presence: 'available'` assim que a
         * conexão abre (ver `sendPresenceUpdate(markOnlineOnConnect ?
         * 'available' : 'unavailable')` em `Socket/chats.js`). Para o servidor
         * do WhatsApp isso significa "o dono está online neste aparelho" — e a
         * regra dele é entregar a notificação *push* onde a pessoa está. Com o
         * worker declarando-se online 24 horas por dia, o celular deixava de
         * receber notificação de mensagem nova: o servidor entendia que já
         * havia alguém lendo aqui.
         *
         * O README do próprio Baileys registra isto em "Receive Notifications
         * in Whatsapp App": para o aplicativo do celular continuar notificando,
         * `markOnlineOnConnect` tem que ser `false`.
         *
         * Nada se perde no recebimento: `unavailable` descreve a presença do
         * aparelho, não a assinatura do socket. As mensagens continuam chegando
         * por `messages.upsert` exatamente como antes — o que muda é o celular
         * voltar a tocar.
         */
        markOnlineOnConnect: false,
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
        // O cache local guarda apenas nome/tamanho para o CRM, não o objeto
        // completo que o Baileys exige para cifrar mensagens de grupo.
        cachedGroupMetadata: async () => undefined,
      });

      this.setupEventHandlers(saveCreds);

      // O código de pareamento NÃO é pedido aqui: o socket acabou de nascer e o
      // WebSocket ainda não abriu. O `requestPairingCode` do Baileys envia um nó
      // pelo socket, e `sendRawMessage` recusa com `Connection Closed` enquanto
      // `ws.isOpen` é falso — pedir neste ponto falhava em toda tentativa. O
      // pedido sai no primeiro `qr` de `connection.update`, que é o sinal de que
      // o handshake terminou. Ver `solicitarCodigoDePareamento`.
      return this.currentStatus;
    } catch (error) {
      // Uma tentativa já superada não mexe no estado: ele pertence à mais nova.
      if (this.encerrada || tentativa !== this.tentativaDeInicio) return this.currentStatus;
      this.isInitializing = false;
      this.pairingPhone = undefined;
      this.teardownSocket();
      const message = error instanceof Error ? error.message : 'Falha ao inicializar WhatsApp';
      await this.updateStatus({
        status: 'desconectado',
        error: message,
        qr: undefined,
        pairingCode: undefined,
      });
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
    const generation = this.socketGeneration;
    return async (...args: Args) => {
      if (generation !== this.socketGeneration) return;
      try {
        await handler(...args);
      } catch (error) {
        console.error(`[WhatsAppSession ${this.inboxId}] Erro não tratado em '${event}':`, error);
      }
    };
  }

  private setupEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;
    const generation = this.socketGeneration;

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

        // No fluxo por telefone o `qr` não é exibido: ele só sinaliza que o
        // socket ficou pronto para o pedido do código.
        if (qr && this.pairingPhone && !this.isPaired) {
          await this.solicitarCodigoDePareamento();
        }

        // O Baileys tambem pode emitir QR enquanto prepara o socket. No fluxo
        // por telefone ele nao deve substituir o codigo que o usuario pediu.
        if (qr && !this.pairingPhone) {
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
            await this.registrarEstado({
              status: 'desconectado',
              qr: undefined,
              pairingCode: undefined,
              error: 'O QR expirou sem ser lido. Clique em conectar para gerar outro.',
            });
            return;
          }

          console.log(
            `[WhatsAppSession ${this.inboxId}] QR Code recebido (${this.qrCycles}/${MAX_QR_CYCLES}).`,
          );
          await this.registrarEstado({
            status: 'aguardando_leitura',
            qr,
            pairingCode: undefined,
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
            // Pelo agendador, e não por um `setTimeout` solto: um timer que a
            // sessão não conhece não pode ser cancelado, e voltava meio segundo
            // depois para abrir um socket numa sessão que `stop()` já encerrou.
            this.agendarReconexao(500);
            return;
          }

          /**
           * 440 — outra sessão assumiu este número.
           *
           * Isto era terminal: marcava `desconectado` e parava ali. Só que a
           * causa mais comum não é o cliente ter aberto o WhatsApp Web — é o
           * **nosso próprio deploy**. Enquanto o worker antigo encerra e o novo
           * sobe, os dois podem ter socket aberto no mesmo número por alguns
           * segundos, e o WhatsApp derruba um deles com 440. O que caía ficava
           * caído até alguém clicar em "Conectar", e como qual das caixas
           * colidia dependia do tempo de cada uma, o efeito parecia aleatório:
           * num deploy caía uma, no outro caía outra.
           *
           * Reconectar é o certo porque a condição é temporária por
           * construção: o processo que roubou o número está encerrando. O
           * recuo cresce a cada substituição seguida para o caso em que a
           * outra ponta **não** vai embora — o WhatsApp Web aberto de verdade,
           * onde insistir seria um cabo de guerra infinito. Depois de
           * `MAX_REPLACED_RETRIES` a sessão para e espera intervenção, que aí
           * sim é o diagnóstico correto.
           */
          if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440) {
            this.replacedCount += 1;

            if (this.replacedCount > MAX_REPLACED_RETRIES) {
              // A intenção desliga junto: sem isso, o próximo envio ou o próximo
              // boot religava a caixa e recomeçava o cabo de guerra que este teto
              // existe para encerrar.
              await this.registrarEstado(
                {
                  status: 'desconectado',
                  error:
                    'Outro dispositivo assumiu este número. Feche o WhatsApp Web e conecte novamente.',
                  qr: undefined,
                },
                { autoConnect: false },
              );
              return;
            }

            const espera = REPLACED_BACKOFF_MS[this.replacedCount - 1] ?? 30_000;
            console.warn(
              `[WhatsAppSession ${this.inboxId}] Sessão substituída (440). ` +
                `Reconectando em ${Math.round(espera / 1000)}s ` +
                `(${this.replacedCount}/${MAX_REPLACED_RETRIES}).`,
            );
            this.agendarReconexao(espera);
            await this.registrarEstado({
              status: 'conectando',
              error: 'Reconectando: outra sessão assumiu o número.',
              qr: undefined,
            });
            return;
          }

          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            // A limpeza vai num `try` próprio: ela é irrelevante para o estado
            // que a tela precisa mostrar, e não pode ser o que impede a caixa de
            // ser marcada como desconectada.
            try {
              await wipeAuthState(this.inboxId, {
                workerId: this.workerId,
                lockVersion: this.lockVersion,
              });
            } catch (error) {
              console.error(
                `[WhatsAppSession ${this.inboxId}] Falha ao limpar as credenciais revogadas:`,
                error,
              );
            }
            await this.registrarEstado(
              {
                status: 'desconectado',
                error: 'Desconectado no aparelho do WhatsApp.',
                qr: undefined,
              },
              { autoConnect: false },
            );
            return;
          }

          /**
           * 403 — o servidor do WhatsApp recusou o login deste número.
           *
           * É a resposta a uma conta restringida ou banida, não a uma queda. Ela
           * caía no ramo genérico de reconexão, e o worker insistia no login a
           * cada minuto, por horas — o que não ajuda e pode pesar contra o
           * número —, enquanto a tela dizia "Conexão perdida. Reconectando...",
           * escondendo a causa. As credenciais ficam: se a restrição for
           * temporária, "Conectar" volta sem QR depois que ela acabar.
           */
          if (statusCode === DisconnectReason.forbidden) {
            console.warn(
              `[WhatsAppSession ${this.inboxId}] O WhatsApp recusou o login deste número (403). ` +
                'Tentativas automáticas encerradas.',
            );
            await this.registrarEstado(
              {
                status: 'desconectado',
                qr: undefined,
                pairingCode: undefined,
                error:
                  'O WhatsApp recusou a conexão deste número (código 403). Abra o WhatsApp no ' +
                  'celular para ver se a conta foi restringida ou banida.',
              },
              { autoConnect: false },
            );
            return;
          }

          // 500 (`badSession`) segue o caminho das quedas comuns, sem apagar
          // nada. O Baileys dá esse código a qualquer `stream:error` de motivo
          // que ele não reconhece, e apagar as chaves do Signal por causa de um
          // erro transitório corrompia uma sessão saudável — com o dano
          // escondido pelo cache em memória até o reinício seguinte. Uma sessão
          // de fato inválida se resolve desconectando e pareando de novo.

          // Handshake transitório inicial do WebSocket WhatsApp para sessões não pareadas:
          // O servidor WhatsApp rotineiramente encerra o primeiro socket (código 428/515)
          // antes de despachar o QR. Reconectamos automaticamente para receber o código.
          if (!this.isPaired && !this.isAuthenticated) {
            const pairingByPhone = Boolean(this.pairingPhone);
            if (
              (statusCode === 428 ||
                statusCode === 515 ||
                statusCode === DisconnectReason.restartRequired) &&
              this.qrAttempts < 8
            ) {
              this.qrAttempts += 1;
              console.log(
                `[WhatsAppSession ${this.inboxId}] Handshake transitório (${statusCode}). Tentativa ${this.qrAttempts}/8 gerando QR...`,
              );
              this.agendarReconexao(1500);
              await this.registrarEstado({
                status: pairingByPhone ? 'conectando' : 'gerando_qr',
              });
              return;
            }

            // Os dois orçamentos voltam juntos: a mensagem acima manda clicar em
            // conectar, e a tentativa seguinte precisa começar inteira.
            this.qrAttempts = 0;
            this.qrCycles = 0;
            this.pairingPhone = undefined;
            await this.registrarEstado({
              status: 'desconectado',
              qr: undefined,
              error: pairingByPhone
                ? 'Não foi possível concluir o pareamento por telefone. Gere um novo código.'
                : 'O QR expirou sem ser lido. Clique em conectar para gerar outro.',
            });
            return;
          }

          if (shouldReconnect) {
            this.retryCount += 1;
            const delay =
              (RECONNECT_BACKOFF_MS[
                Math.min(this.retryCount - 1, RECONNECT_BACKOFF_MS.length - 1)
              ] ?? 60_000) +
              Math.random() * 1000;

            // Armado antes da gravação, e não depois: ver `agendarReconexao`.
            // Era exatamente aqui que uma falha de banco deixava a sessão sem
            // volta e a caixa verde na tela para sempre.
            this.agendarReconexao(delay);

            await this.registrarEstado({
              status: 'conectando',
              error: `Conexão perdida. Reconectando em ${Math.round(delay / 1000)}s...`,
            });
          } else {
            await this.registrarEstado({ status: 'desconectado', qr: undefined });
          }
        }

        // O WhatsApp avisa quando terminou de entregar o que reteve enquanto
        // estivemos fora. É o sinal para anunciar de uma vez o que foi gravado
        // calado durante a drenagem.
        if (update.receivedPendingNotifications) {
          this.pendingNotificationsDone = true;
          void this.finishDrain('fim da fila represada');
        }

        if (connection === 'open') {
          // A sessão vingou: o orçamento de substituições volta inteiro.
          this.replacedCount = 0;
          this.isInitializing = false;
          this.isAuthenticated = true;
          this.qrAttempts = 0;
          this.qrCycles = 0;
          this.retryCount = 0;
          this.pairingPhone = undefined;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.beginDrain();

          // Antes da gravação, de propósito. O socket **está** aberto neste
          // ponto; o banco é escrituração. Fazer o envio que espera depender de
          // uma ida ao Postgres seria devolver ao caminho crítico justamente a
          // dependência que a queda mostrou ser frágil.
          this.liberarEspera(true);

          const userJid = this.socket?.user?.id
            ? jidNormalizedUser(this.socket.user.id)
            : undefined;

          const ownerName =
            this.socket?.user?.name ?? (userJid ? PhoneNumber.format(userOf(userJid)) : 'WhatsApp');

          await this.registrarEstado({
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
          /**
           * Reafirma "offline" depois que a poeira da conexão baixa.
           *
           * `markOnlineOnConnect: false` já manda um `unavailable` ao abrir, mas
           * ele não é necessariamente a última palavra. O Baileys tem um caminho
           * próprio, em `Socket/socket.js`, que dispara sozinho quando o
           * `pushName` chega ou muda:
           *
           * ```js
           * ev.on('creds.update', update => {
           *   if (creds.me?.name !== update.me?.name) {
           *     sendNode({ tag: 'presence', attrs: { name } })
           * ```
           *
           * É um nó de presença **sem `type`** — e presença sem tipo é presença
           * disponível. Como o nome costuma chegar logo depois do `open`, ele cai
           * atrás do nosso `unavailable` e desfaz o efeito sem passar por
           * `sendPresenceUpdate`, ou seja, sem sequer atualizar
           * `sendActiveReceipts` do lado do Baileys.
           *
           * Repetir aqui custa um nó e fecha essa janela. É idempotente: se nada
           * tiver mexido na presença, o servidor recebe a mesma informação duas
           * vezes.
           */
          void this.socket?.sendPresenceUpdate('unavailable').catch(() => {
            // Presença é otimização de notificação, não requisito de operação:
            // falhar aqui não pode derrubar uma conexão recém-aberta.
          });
          void this.subscribeRecentPresences();
        }
      }),
    );

    this.socket.ev.on(
      'messaging-history.set',
      this.guarded('messaging-history.set', async (history) => {
        if ('contacts' in history && Array.isArray(history.contacts)) {
          for (const contact of history.contacts) {
            this.rememberContact(contact);
          }
          if (history.contacts.length > 0) this.hasAddressBookSnapshot = true;
        }
        await this.receiveHistory(history, generation);
      }),
    );

    this.socket.ev.on(
      'messaging-history.status',
      this.guarded('messaging-history.status', async ({ syncType, status }) => {
        if (status !== 'complete' && status !== 'paused') return;
        const expected =
          syncType === proto.HistorySync.HistorySyncType.RECENT ||
          (syncType === proto.HistorySync.HistorySyncType.FULL && this.historyImportWantsFull());
        if (expected) await this.finishHistoryImport();
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
          await limiteDeGravacao.run(this.inboxId, async () => {
            this.emVoo += 1;
            try {
              await this.handleIncomingMessage(msg, generation);
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
            await markMessageRevoked(update.key.id, this.inboxId);
            continue;
          }
          if (update.update.status && update.key.id) {
            const status = deliveryStatusFrom(update.update.status);
            if (status) {
              await applyDeliveryUpdate(update.key.id, status, this.inboxId);
            }
          }
        }
      }),
    );

    /**
     * Os recibos de grupo, que não passam por `messages.update`.
     *
     * O Baileys bifurca em `handleReceipt` (`Socket/messages-recv.js`): numa
     * conversa de duas pessoas o recibo vira `messages.update` com `status`;
     * num grupo vira `message-receipt.update`, com um recibo **por
     * participante**, porque lá cada um entrega e lê no seu tempo. Sem este
     * ouvinte, mensagem de grupo nunca passava de um tracinho — não porque não
     * fosse entregue, mas porque o evento que dizia isso não tinha ninguém
     * escutando.
     *
     * **Simplificação assumida:** o WhatsApp só pinta os dois tracinhos quando
     * *todos* receberam, e de azul quando *todos* leram. Aqui basta um
     * participante, porque saber que faltam os outros exigiria guardar a lista
     * de quem já leu por mensagem — uma coluna nova e a lista de membros
     * sempre atualizada. Num grupo grande o azul chega cedo demais; ainda
     * assim é mais próximo da verdade do que o tracinho único que ficava para
     * sempre.
     */
    this.socket.ev.on(
      'message-receipt.update',
      this.guarded('message-receipt.update', async (updates) => {
        for (const { key, receipt } of updates) {
          if (!key.id) continue;
          // A ordem não importa: `applyDeliveryUpdate` nunca rebaixa um status.
          if (receipt.receiptTimestamp) await applyDeliveryUpdate(key.id, 'entregue', this.inboxId);
          if (receipt.readTimestamp) await applyDeliveryUpdate(key.id, 'lido', this.inboxId);
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
          this.rememberContact(contact);
        }
      }),
    );

    this.socket.ev.on(
      'contacts.update',
      this.guarded('contacts.update', async (updates) => {
        for (const update of updates) {
          this.rememberContact(update);
        }
      }),
    );

    /**
     * Reações.
     *
     * O Baileys as entrega por um evento próprio — e **não** por
     * `messages.upsert` com conteúdo útil: a mensagem de reação chega lá
     * também, mas `decodeWaMessage` a descarta (é um `reactionMessage`, não
     * conteúdo de conversa). Sem este listener, reagir no celular não produzia
     * nada no CRM.
     */
    this.socket.ev.on(
      'messages.reaction',
      this.guarded('messages.reaction', async (reactions) => {
        for (const item of reactions) {
          await this.handleReaction(item);
        }
      }),
    );
  }

  /**
   * Traduz a reação do canal para a intenção de domínio.
   *
   * `item.key` é a chave da mensagem **reagida**; `item.reaction.key` é a da
   * mensagem de reação, e é dela que sai quem reagiu. Trocar os dois é o erro
   * fácil aqui — e ele não daria exceção nenhuma, só carimbaria a reação na
   * mensagem errada.
   */
  private async handleReaction(item: {
    key: WAMessageKey;
    reaction: { text?: string | null; key?: WAMessageKey | null };
  }): Promise<void> {
    const alvo = item.key?.id;
    if (!alvo) return;

    const autorKey = item.reaction?.key ?? undefined;
    const fromMe = Boolean(autorKey?.fromMe);
    const emoji = (item.reaction?.text ?? '').trim();

    if (fromMe) {
      await applyReaction(alvo, { emoji, actorId: 'me', by: 'agent' }, this.inboxId);
      return;
    }

    const sender =
      this.socket && autorKey ? await resolveSenderIdentity(this.socket, autorKey) : null;
    const actorId =
      sender?.phone || sender?.jid || autorKey?.participant || autorKey?.remoteJid || 'contato';

    const jid = sender?.jid ? jidNormalizedUser(sender.jid) : undefined;
    const nome =
      (jid ? this.groupSenderNames.get(jid) : undefined) ??
      (jid ? this.contactsStore.get(jid)?.name?.trim() : undefined) ??
      (sender?.phone ? PhoneNumber.format(sender.phone) || sender.phone : undefined);

    await applyReaction(
      alvo,
      {
        emoji,
        actorId,
        by: 'contact',
        ...(nome ? { authorName: nome } : {}),
      },
      this.inboxId,
    );
  }

  /**
   * Envia (ou retira) uma reação nossa sobre uma mensagem do chat.
   *
   * `emoji` vazio é a forma que o protocolo tem de dizer "retirei a minha" —
   * não existe um comando separado de remoção. Em grupo a chave precisa do
   * `participant`: sem ele o servidor não sabe de qual mensagem se trata,
   * porque o par (chat, id) não é suficiente quando há vários remetentes.
   */
  async sendReaction(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    target: { externalId: string; fromMe: boolean; participant?: string },
    emoji: string,
  ): Promise<void> {
    if (!this.socket || !this.isAuthenticated) {
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
    }

    await this.socket.sendMessage(targetJid, {
      react: {
        text: emoji,
        key: {
          remoteJid: targetJid,
          id: target.externalId,
          fromMe: target.fromMe,
          ...(target.participant && !target.fromMe ? { participant: target.participant } : {}),
        },
      },
    });
  }

  /**
   * Mantém o retrato recebido do WhatsApp na memória da sessão.
   *
   * Os eventos de agenda chegam no pareamento, em reconexões e em alterações
   * feitas no celular. Persistir daqui no **cadastro de contatos** transformava
   * todos esses eventos numa sincronização automática do CRM; a única rotina
   * autorizada a gravar contatos continua sendo `syncAllStoredContacts`,
   * chamada pelo botão explícito.
   *
   * O que vai ao banco é só o nome salvo na agenda, numa tabela à parte que
   * ninguém exibe (`wa-address-book.ts`). A memória morre a cada reinício do
   * worker, e com ela o nome salvo: até alguém sincronizar de novo, toda
   * conversa voltava a mostrar o nome do perfil.
   */
  private rememberContact(contact: Partial<WAContact>): void {
    const rawJid = contact.phoneNumber ?? contact.id;
    if (
      !rawJid ||
      isJidGroup(rawJid) ||
      rawJid.endsWith('@g.us') ||
      rawJid.includes('@broadcast') ||
      rawJid.includes('@newsletter')
    )
      return;

    if (
      this.socket?.user?.id &&
      jidNormalizedUser(rawJid) === jidNormalizedUser(this.socket.user.id)
    )
      return;

    const jid = jidNormalizedUser(rawJid);
    const existingStored = this.contactsStore.get(jid);
    this.contactsStore.set(jid, { ...existingStored, ...contact });

    // Só `name` é a agenda. `notify` é o nome que a pessoa escolheu para si e
    // chega em toda mensagem: guardá-lo aqui o faria passar por nome salvo.
    const nomeNaAgenda = nomeUtilizavel(contact.name);
    if (nomeNaAgenda) {
      this.pendingAddressBook.set(jid, nomeNaAgenda);
      this.scheduleAddressBookFlush();
    }
  }

  /** Arma a gravação em lote dos nomes da agenda. */
  private scheduleAddressBookFlush(delayMs = ADDRESS_BOOK_FLUSH_MS): void {
    if (this.addressBookTimer || this.encerrada) return;
    const timer = setTimeout(() => {
      this.addressBookTimer = null;
      void this.flushAddressBook();
    }, delayMs);
    timer.unref?.();
    this.addressBookTimer = timer;
  }

  /**
   * Grava os nomes pendentes da agenda.
   *
   * Uma gravação por vez: a agenda do pareamento chega em rajadas, e duas
   * gravações simultâneas só disputariam as mesmas linhas. A falha não derruba
   * nada: o nome continua na memória desta sessão, e o celular o manda de novo
   * na próxima sincronização.
   */
  private async flushAddressBook(): Promise<void> {
    if (this.addressBookFlush) return this.addressBookFlush;
    if (this.pendingAddressBook.size === 0) return;

    // A agenda é do número pareado. Antes de o socket saber quem é, não há a
    // quem atribuir os nomes: eles esperam, e a tentativa volta daqui a pouco.
    const ownerJid = this.ownJid;
    if (!ownerJid) {
      this.scheduleAddressBookFlush(ADDRESS_BOOK_RETRY_MS);
      return;
    }

    const entries = [...this.pendingAddressBook.entries()].map(([jid, name]) => ({ jid, name }));
    this.pendingAddressBook.clear();

    this.addressBookFlush = saveAddressBookNames(
      { accountId: this.accountId, inboxId: this.inboxId, ownerJid },
      entries,
    )
      .then(({ created, updated }) => {
        if (created > 0 || updated > 0) {
          waLog.debug(
            `[sessão ${this.inboxId}] Agenda gravada: ${created} novo(s), ${updated} alterado(s).`,
          );
        }
      })
      .catch((error: unknown) => {
        waLog.warn(`[sessão ${this.inboxId}] Nomes da agenda não gravados:`, error);
      })
      .finally(() => {
        this.addressBookFlush = null;
        if (this.pendingAddressBook.size > 0) this.scheduleAddressBookFlush();
      });
    return this.addressBookFlush;
  }

  /**
   * Devolve à memória os nomes da agenda gravados para o número pareado.
   *
   * Só preenche quem a memória ainda não conhece com nome: o que chegou do
   * celular nesta sessão é mais novo que o do banco. Sessão ainda não pareada
   * não tem número, e portanto não tem agenda a restaurar.
   */
  private async loadAddressBook(meId: string | undefined): Promise<void> {
    if (!meId) return;
    const ownerJid = jidNormalizedUser(meId);
    if (this.addressBookLoadedFor === ownerJid) return;

    try {
      const rows = await loadAddressBookNames({
        accountId: this.accountId,
        inboxId: this.inboxId,
        ownerJid,
      });
      for (const { jid, name } of rows) {
        const stored = this.contactsStore.get(jid);
        if (nomeUtilizavel(stored?.name)) continue;
        this.contactsStore.set(jid, { ...stored, id: stored?.id ?? jid, name });
      }
      this.addressBookLoadedFor = ownerJid;
      if (rows.length > 0) {
        waLog.debug(
          `[sessão ${this.inboxId}] ${rows.length} nome(s) da agenda restaurado(s) do banco.`,
        );
      }
    } catch (error) {
      // Sem a agenda do banco a sessão ainda funciona: só volta ao comportamento
      // antigo, com o nome do perfil até a próxima sincronização.
      waLog.warn(`[sessão ${this.inboxId}] Agenda não restaurada do banco:`, error);
    }
  }

  /**
   * Puxa a agenda inteira do WhatsApp de volta para a memória.
   *
   * **Por que "sincronizar grupos" trazia todos os grupos e "sincronizar
   * contatos" não trazia todos os contatos.** Grupo tem consulta direta:
   * `groupFetchAllParticipating()` pergunta ao servidor e ele responde a lista
   * completa. Contato não tem equivalente — a agenda chega uma única vez, pelo
   * *app state sync*, e o Baileys só o executa quando recebe um histórico
   * inicial (ver `doAppStateSync` em `Socket/chats.js`). Ou seja: ela chegava no
   * pareamento e nunca mais. Em toda reconexão o `contactsStore` nascia vazio, e
   * "sincronizar contatos" varria um mapa em branco — daí o botão terminar sem
   * erro e sem trazer ninguém.
   *
   * `resyncAppState` é o pedido equivalente ao dos grupos. Mas ele é
   * *incremental*: o servidor só devolve o que mudou desde a versão que temos
   * guardada, e para uma agenda que não mudou isso é nada. Zerar a versão das
   * coleções antes força o `return_snapshot`, e o servidor manda a agenda
   * inteira — que é exatamente o que reinstalar o WhatsApp Web faz.
   *
   * Apagar a versão é seguro: ela é um marcador de sincronização, não um
   * segredo. O pior caso é reprocessar mutações que já conhecíamos, e
   * `syncAllStoredContacts` é idempotente.
   */
  private async pullAddressBook(): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.isAuthenticated) return;

    const colecoes = ['critical_unblock_low', 'regular_high', 'regular_low', 'regular'] as const;

    try {
      await socket.authState.keys.set({
        'app-state-sync-version': Object.fromEntries(colecoes.map((nome) => [nome, null])),
      } as never);
    } catch (error) {
      waLog.warn(`[sessão ${this.inboxId}] Não foi possível zerar a versão do app state:`, error);
    }

    try {
      await socket.resyncAppState(colecoes, true);
      this.hasAddressBookSnapshot = true;
    } catch (error) {
      console.warn(
        `[WhatsAppSession ${this.inboxId}] Falha ao repuxar a agenda do WhatsApp:`,
        error,
      );
    }
  }

  async syncAllStoredContacts(): Promise<{ synced: number; created: number }> {
    // O resync completo pode gerar um alerta no WhatsApp Business. Ele só é
    // necessário no primeiro clique de uma sessão que ainda não recebeu a
    // agenda; depois disso os eventos `contacts.*` mantêm o cache atualizado.
    if (!this.hasAddressBookSnapshot) await this.pullAddressBook();

    /**
     * Com quem já existe conversa direta nesta caixa.
     *
     * Lido de uma vez, antes do laço, e não uma consulta por contato: o
     * `contactsStore` chega a milhares de entradas, e uma ida ao banco em cada
     * uma transformaria "sincronizar" numa varredura de minutos.
     */
    const conversasDiretas = new Set<string>();
    for (const conversa of await prisma.conversation.findMany({
      where: {
        accountId: this.accountId,
        inboxId: this.inboxId,
        channel: 'whatsapp',
        channelThreadId: { not: { endsWith: '@g.us' } },
      },
      select: { channelThreadId: true },
    })) {
      const digitos = conversa.channelThreadId ? userOf(conversa.channelThreadId) : '';
      if (digitos) conversasDiretas.add(digitos);
    }

    let synced = 0;
    let created = 0;

    for (const [rawJid, contact] of this.contactsStore.entries()) {
      if (
        !rawJid ||
        isJidGroup(rawJid) ||
        isLidUser(rawJid) ||
        rawJid.endsWith('@lid') ||
        rawJid.endsWith('@g.us') ||
        rawJid.includes('@broadcast') ||
        rawJid.includes('@newsletter')
      )
        continue;
      if (
        this.socket?.user?.id &&
        jidNormalizedUser(rawJid) === jidNormalizedUser(this.socket.user.id)
      )
        continue;

      const phoneDigits = userOf(rawJid);
      if (!phoneDigits) continue;
      const phone = PhoneNumber.normalize(`+${phoneDigits}`);
      if (!PhoneNumber.isValid(phone)) continue;

      const addressBookName = nomeUtilizavel(contact.name);
      const pushName = nomeUtilizavel(contact.notify) ?? nomeUtilizavel(contact.verifiedName);
      const resolvedName = addressBookName || pushName || PhoneNumber.format(phone) || phone;
      const avatarUrl =
        typeof contact.imgUrl === 'string' && contact.imgUrl !== 'changed'
          ? contact.imgUrl
          : undefined;

      /**
       * O que separa a agenda de quem só passou pelo caminho.
       *
       * O `contactsStore` não é a agenda: é tudo que a sessão já viu. Todo
       * participante de todo grupo cai ali, porque o WhatsApp manda um registro
       * de contato para cada pessoa que aparece — foi assim que 500 contatos
       * viraram 2000.
       *
       * O próprio Baileys documenta a distinção no tipo `Contact`:
       *
       *   name   → "name of the contact, you have saved on your WA"
       *   notify → "name of the contact, the contact has set on their own"
       *
       * Ou seja, `name` só existe para quem está salvo no aparelho; `notify` é
       * o nome que a pessoa escolheu para si e todo mundo tem, conhecido ou
       * não. Testar `name` é exatamente o critério da tela de "nova conversa"
       * do WhatsApp, que é a lista que se espera ver aqui.
       *
       * A conversa direta entra junto porque quem já foi atendido é contato
       * por definição, tenha sido salvo na agenda ou não — é a mesma regra
       * aplicada por esta sincronização manual.
       */
      const daAgenda = Boolean(addressBookName) || conversasDiretas.has(phoneDigits);
      if (!daAgenda) continue;

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
              data: {
                name: addressBookName,
                ...(avatarUrl && !existing.avatarUrl ? { avatarUrl } : {}),
              },
            });
          }
        } else {
          // Chegar aqui já significa passar por `daAgenda`: é contato salvo no
          // aparelho ou alguém com conversa aberta. O nome pode ser só o número
          // formatado — um contato salvo sem etiqueta continua sendo contato.
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
              customFields: asJson([
                { label: GROUP_ALLOWED_FIELD_LABEL, value: 'false' },
                // Quem está sincronizando é, por definição, participante: o
                // `groupFetchAllParticipating` só devolve grupos deste número.
                { label: GROUP_INBOXES_FIELD_LABEL, value: this.inboxId },
              ]),
              timeline: asJson([]),
            },
          });
          created += 1;
        } else {
          /**
           * A caixa é somada, nunca trocada.
           *
           * Um grupo pode ter dois números da mesma conta entre os membros, e
           * cada um sincroniza no seu momento. Sobrescrever faria a segunda
           * sincronização apagar a primeira — e a caixa recém-removida da lista
           * voltaria a ser recusada no envio.
           */
          const anteriores = Array.isArray(existing.customFields)
            ? (existing.customFields as unknown as CustomField[])
            : [];
          const caixas = new Set(groupInboxIds({ customFields: anteriores }).concat(this.inboxId));
          const customFields = [
            ...anteriores.filter((campo) => campo?.label !== GROUP_INBOXES_FIELD_LABEL),
            { label: GROUP_INBOXES_FIELD_LABEL, value: [...caixas].join(',') },
          ];

          await prisma.contact.update({
            where: { id: existing.id, accountId },
            data: {
              name: group.subject || existing.name,
              participantCount:
                group.size ?? group.participants?.length ?? existing.participantCount,
              customFields: asJson(customFields),
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
          // Espalha as 50 assinaturas iniciais para nao produzir uma rajada no
          // mesmo instante do handshake. A rotina roda em background.
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      }
    } catch {
      // Ignora erro suave de subscrição inicial
    }
  }

  /**
   * Emite "digitando"/"gravando" sem bloquear a fila da caixa.
   *
   * `available` e global, enquanto o chatstate e por destinatario. Por isso as
   * janelas ativas sao contadas: encerrar um chat nunca derruba o indicador de
   * outro. O temporizador apenas agenda `paused`; o comando termina assim que o
   * servidor aceita o chatstate e a proxima mensagem pode sair imediatamente.
   */
  async sendPresence(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    status: 'composing' | 'paused' | 'recording',
    durationMs?: number,
  ): Promise<void> {
    if (!this.socket || !this.isAuthenticated) {
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }
    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
    if (!targetJid) throw new Error('Destinatário inválido para o sinal de presença.');

    const socket = this.socket;
    // Sem duracao explicita, sustenta por uma janela curta em background. Um
    // chatstate isolado era aceito pelo socket mas nao chegava a aparecer no
    // aparelho remoto quando a sessao permanecia `unavailable`.
    const duration = Math.min(Math.max(Math.trunc(durationMs ?? 6_000), 0), 6_000);
    const existingTimer = this.outboundPresenceTimers.get(targetJid);

    if (status === 'paused') {
      if (existingTimer) clearTimeout(existingTimer);
      this.outboundPresenceTimers.delete(targetJid);
      const wasOnline = this.outboundPresenceOnline.delete(targetJid);
      await socket.sendPresenceUpdate('paused', targetJid);
      if (wasOnline && this.outboundPresenceOnline.size === 0) {
        await socket.sendPresenceUpdate('unavailable').catch(() => undefined);
      }
      return;
    }

    // Uma nova chamada renova somente o relogio deste JID.
    if (duration > 0 && existingTimer) clearTimeout(existingTimer);
    if (duration > 0) this.outboundPresenceTimers.delete(targetJid);
    if (duration > 0 && !this.outboundPresenceOnline.has(targetJid)) {
      const firstWindow = this.outboundPresenceOnline.size === 0;
      this.outboundPresenceOnline.add(targetJid);
      if (firstWindow) await socket.sendPresenceUpdate('available').catch(() => undefined);
    }

    try {
      // `presenceSubscribe` serve para RECEBER a presenca do contato; nao e
      // requisito para enviar nosso proprio chatstate e gerava trafego extra.
      await socket.sendPresenceUpdate(status, targetJid);
    } catch (error) {
      const wasOnline = this.outboundPresenceOnline.delete(targetJid);
      if (wasOnline && this.outboundPresenceOnline.size === 0) {
        await socket.sendPresenceUpdate('unavailable').catch(() => undefined);
      }
      throw error;
    }

    if (duration > 0) {
      const generation = this.socketGeneration;
      const timer = setTimeout(() => {
        if (this.outboundPresenceTimers.get(targetJid) !== timer) return;
        this.outboundPresenceTimers.delete(targetJid);
        this.outboundPresenceOnline.delete(targetJid);
        if (this.socket !== socket || generation !== this.socketGeneration) return;
        void socket
          .sendPresenceUpdate('paused', targetJid)
          .catch(() => undefined)
          .finally(() => {
            if (this.outboundPresenceOnline.size === 0 && this.socket === socket) {
              void socket.sendPresenceUpdate('unavailable').catch(() => undefined);
            }
          });
      }, duration);
      timer.unref?.();
      this.outboundPresenceTimers.set(targetJid, timer);
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
    if (this.drain.idle) clearTimeout(this.drain.idle);

    // O servidor já disse que não há fila represada — ver
    // `pendingNotificationsDone`. Abrir a janela aqui seria calar, sem motivo,
    // tudo o que chegasse a seguir.
    if (this.pendingNotificationsDone) {
      waLog.debug(`[sessão ${this.inboxId}] Sem fila represada: janela de silêncio não aberta.`);
      return;
    }

    // Rede de segurança: se o aviso de fim não vier — servidor que não o envia,
    // conexão que cai no meio —, a janela não pode ficar aberta para sempre,
    // ou as mensagens seguintes deixariam de aparecer em tempo real.
    const timer = setTimeout(() => void this.finishDrain('tempo limite da janela'), DRAIN_MAX_MS);
    timer.unref?.();

    this.drain = {
      active: true,
      closing: false,
      count: 0,
      startedAt: Date.now(),
      touched: new Set(),
      timer,
      idle: null,
    };

    this.armDrainIdle();
  }

  /**
   * (Re)arma o relógio de ociosidade da drenagem.
   *
   * Chamado a cada mensagem gravada calada: enquanto a rajada continua, o
   * relógio é adiado; quando ela para, ele fecha a janela. Sem isto, o único
   * jeito de fechar era o aviso do servidor (que já veio) ou o tempo limite —
   * e o tempo limite é justamente a espera que não pode acontecer.
   */
  private armDrainIdle(): void {
    if (!this.drain.active) return;
    if (this.drain.idle) clearTimeout(this.drain.idle);
    const idle = setTimeout(() => void this.finishDrain('fila ociosa'), DRAIN_IDLE_MS);
    idle.unref?.();
    this.drain.idle = idle;
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
    if (this.drain.idle) clearTimeout(this.drain.idle);
    this.drain = {
      active: false,
      closing: false,
      count: 0,
      startedAt: 0,
      touched: new Set(),
      timer: null,
      idle: null,
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

  /** Nome da caixa — o `instance` do corpo entregue. Cai no id se não houver. */
  private async nomeDaCaixa(): Promise<string> {
    if (this.inboxName) return this.inboxName;
    const caixa = await prisma.inbox
      .findFirst({
        where: { id: this.inboxId, accountId: this.accountId },
        select: { name: true },
      })
      .catch(() => null);
    this.inboxName = caixa?.name?.trim() || this.inboxId;
    return this.inboxName;
  }

  /** JID do número conectado nesta caixa. Vazio enquanto o socket não subiu. */
  private get ownJid(): string {
    const id = this.socket?.user?.id;
    return id ? jidNormalizedUser(id) : '';
  }

  /**
   * Anuncia a mensagem que o próprio CRM enviou, sem regravá-la.
   *
   * A linha existe: o caso de uso grava antes de mandar para o socket. Ela é
   * achada pelo id que o envio deixou em `crmSentIds`, e não pelo `externalId`:
   * esse só é carimbado pelo consumidor da fila depois de o envio voltar, e o
   * eco — que o Baileys emite logo em seguida — podia procurar antes do carimbo,
   * não achar nada e sair sem webhook. A busca por `externalId` fica para os
   * envios que não informaram a linha de origem.
   *
   * A mídia não vai em base64 aqui de propósito: são bytes que este processo
   * acabou de subir para o WhatsApp, e baixá-los de volta para devolvê-los a um
   * webhook seria pagar o mesmo tráfego duas vezes. Quando `SOLINT_APP_URL`
   * está configurada, `data.mediaUrl` cobre quem precisar deles.
   */
  private async dispararEcoDoCrm(msg: WAMessage, messageId: string): Promise<void> {
    try {
      const idNoCrm = this.crmSentIds.get(messageId);
      const gravada = await prisma.message.findFirst({
        where: {
          ...(idNoCrm ? { id: idNoCrm } : { externalId: messageId }),
          conversation: { accountId: this.accountId, inboxId: this.inboxId },
        },
        select: {
          id: true,
          authorId: true,
          conversationId: true,
          conversation: { select: { contactId: true } },
        },
      });
      if (!gravada) return;

      /**
       * O que a integração mandou não volta para ela.
       *
       * Sem esta saída, a resposta do agente saía pelo WhatsApp, voltava como
       * eco e disparava `mensagem.enviada` — que acorda o mesmo fluxo que
       * acabou de escrevê-la. É execução que não decide nada: o n8n já sabe o
       * que ele próprio respondeu.
       *
       * A regra é o autor, e não a rota: `authorId` guarda `api-token:<id>`
       * para tudo que entrou por token. Mensagem digitada por uma pessoa no CRM
       * continua saindo, porque essa o fluxo precisa ver para alimentar a
       * memória do agente. A do celular nem passa por aqui — ela é gravada em
       * `commitMessage`, e dispara por lá.
       */
      if (isApiTokenActor(gravada.authorId)) return;

      await dispararWebhooks(
        'mensagem.enviada',
        buildUpsertPayload({
          raw: msg,
          instance: await this.nomeDaCaixa(),
          instanceId: this.inboxId,
          sender: this.ownJid,
          solint: {
            contaId: this.accountId,
            caixaEntradaId: this.inboxId,
            conversaId: gravada.conversationId,
            contatoId: gravada.conversation.contactId,
            mensagemId: gravada.id,
            conversaNova: false,
          },
        }),
      );
    } catch (erro) {
      // Mesma regra do despachante: um destino de fora não derruba o socket.
      console.warn(`[WhatsAppSession ${this.inboxId}] Falha no webhook de saída:`, erro);
    }
  }

  private async handleIncomingMessage(msg: WAMessage, generation: number): Promise<void> {
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
      await markMessageRevoked(revogada, this.inboxId);
      return;
    }

    // O eco do que **nós** enviamos não é regravado — a linha já está no banco,
    // posta lá pelo caso de uso que enviou. Mas ele é a única forma real da
    // mensagem no protocolo (com a chave, o status e o aparelho que o WhatsApp
    // atribuiu), então é daqui que sai o webhook de saída, e não de um corpo
    // remontado à mão no caminho de envio.
    if (fromMe && this.crmSentIds.has(messageId)) {
      await this.dispararEcoDoCrm(msg, messageId);
      return;
    }

    let decoded = decodeWaMessage(msg);
    if (!decoded) return;

    /**
     * As menções viram nome **antes** de qualquer coisa gravar o texto.
     *
     * Aqui e não na tela: o texto é persistido, entregue por webhook, lido pelo
     * agente de IA e usado no preview. Resolver na borda de exibição
     * consertaria um desses lugares e deixaria os outros com o identificador
     * cru — e o que está gravado é o que a auditoria vai mostrar depois.
     *
     * Os três campos são atualizados juntos porque são três telas diferentes:
     * o conteúdo é a bolha, o preview é a lista de conversas, e a legenda
     * sobrevive ao download da mídia para virar o conteúdo final em
     * `mediaContent`. Trocar só o primeiro deixaria o número comprido aparecendo
     * na lista lateral.
     */
    const mencoes = await this.tabelaDeMencoes(msg);
    if (mencoes.length > 0) {
      decoded = {
        ...decoded,
        ...(decoded.content.type === 'text'
          ? {
              content: {
                ...decoded.content,
                text: WhatsAppSession.comMencoes(mencoes, decoded.content.text),
              },
            }
          : {}),
        preview: WhatsAppSession.comMencoes(mencoes, decoded.preview),
        ...(decoded.media?.caption
          ? {
              media: {
                ...decoded.media,
                caption: WhatsAppSession.comMencoes(mencoes, decoded.media.caption),
              },
            }
          : {}),
      };
    }

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
        const dbContact = await prisma.contact.findFirst({
          where: { id: contact.id, accountId: this.accountId },
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

    /**
     * Quem escreveu, dentro do grupo.
     *
     * Resolvido **uma vez** e reaproveitado em dois lugares: o nome que aparece
     * acima da bolha e o `senderJid` que fica gravado na linha. Resolver duas
     * vezes custaria uma consulta de mapeamento LID→telefone por mensagem de
     * grupo, no mesmo socket que entrega as mensagens.
     */
    const sender =
      chat.isGroup && !fromMe && this.socket
        ? await resolveSenderIdentity(this.socket, msg.key)
        : null;

    const authorName = await this.resolveAuthorName(chat, msg, fromMe, contact.name, sender);

    const midia = decoded.media
      ? await this.materializeMedia(msg, messageId, decoded.media, decoded.content)
      : { content: decoded.content };
    const content = midia.content;

    const appMessageId = `msg-wa-${chat.conversationId}-${messageId}`;

    const appMessage: Message = {
      id: appMessageId,
      externalId: messageId,
      conversationId: chat.conversationId,
      author: fromMe ? 'agent' : 'contact',
      authorName,
      origin: fromMe ? 'canal' : undefined,
      content,
      time: timeLabel(at),
      deliveryStatus: fromMe ? (deliveryStatusFrom(msg.status) ?? 'enviado') : undefined,
      isPrivate: false,
      ...(sender?.jid ? { senderJid: sender.jid } : {}),
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
      this.armDrainIdle();
    }

    // Resolvido antes da gravação porque é consulta, e fazê-la dentro da função
    // que monta o corpo obrigaria a montá-la assíncrona — num ponto em que quem
    // chama já está dentro da transação de gravação. O base64, ao contrário,
    // fica dentro dela: só é produzido se algum webhook for mesmo receber.
    const instance = await this.nomeDaCaixa();

    const medir = waLog.timer(`[sessão ${this.inboxId}] commitMessage`);
    // O socket pode ter sido substituído enquanto mídia/contato eram
    // resolvidos. Eventos da geração antiga não podem gravar após a troca.
    if (generation !== this.socketGeneration) return;
    await commitMessage({
      accountId: this.accountId,
      inboxId: this.inboxId,
      chat,
      contact,
      message: appMessage,
      preview: decoded.preview,
      at,
      fromMe,
      webhookPayload: (solint) => {
        const base64 = base64ParaWebhook(midia.bytes);
        const mediaUrl = base64 ? undefined : mediaUrlAbsoluta(midia.url);
        return buildUpsertPayload({
          raw: msg,
          instance,
          instanceId: this.inboxId,
          sender: this.ownJid,
          solint,
          ...(base64 ? { base64 } : {}),
          ...(mediaUrl ? { mediaUrl } : {}),
        });
      },
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

    // Agenda, depois cadastro, depois perfil: ver `nomeDoContato`.
    const name = nomeDoContato({
      agenda: this.contactsStore.get(jidNormalizedUser(chat.jid))?.name,
      cadastro: existing?.name,
      perfil: fromMe ? undefined : (nomeUtilizavel(msg.pushName) ?? msg.verifiedBizName),
      reserva: fallbackPersonName(chat.phone, chat.jid),
    });

    return {
      ...base,
      name,
      phone: chat.phone,
      kind: 'pessoa',
      participantCount: undefined,
    };
  }

  /**
   * O nome que aparece acima da bolha.
   *
   * Em grupo isto era, literalmente, o número de telefone formatado — e só ele.
   * O `pushName`, que é o nome que a própria pessoa publica no WhatsApp e vem
   * **dentro de cada mensagem**, era ignorado; a agenda sincronizada e o
   * cadastro do CRM, idem. O resultado era uma conversa de grupo em que toda
   * fala vinha assinada por `+55 79 9…`, exatamente o que o WhatsApp nunca
   * mostra.
   *
   * A ordem abaixo é a do próprio aplicativo: o nome que **eu** salvei na
   * agenda vence o que a pessoa publica, e o número é o último recurso — o que
   * se usa quando não há nome nenhum em lugar algum.
   */
  private async resolveAuthorName(
    chat: ChatIdentity,
    msg: WAMessage,
    fromMe: boolean,
    contactName: string,
    sender: { readonly jid: string; readonly phone: string } | null,
  ): Promise<string | undefined> {
    if (fromMe) {
      return this.currentStatus.name ?? 'Atendente';
    }
    if (!chat.isGroup) {
      return contactName;
    }

    const jid = sender?.jid ? jidNormalizedUser(sender.jid) : undefined;

    // 1 e 2. Agenda sincronizada e cadastro do CRM.
    const conhecido = await this.nomeConhecido(jid, sender?.phone ?? '');
    if (conhecido) return conhecido;

    // 3. O nome que a própria pessoa publica, que vem dentro da mensagem.
    const pushName = nomeUtilizavel(msg.pushName) ?? nomeUtilizavel(msg.verifiedBizName);
    if (pushName) {
      if (jid) this.groupSenderNames.set(jid, pushName);
      return pushName;
    }

    // 4. Último recurso: o número. Sem cache — assim que um nome aparecer numa
    // mensagem seguinte, ele passa a valer.
    if (sender?.phone) return PhoneNumber.format(sender.phone) || sender.phone;
    return 'Participante';
  }

  /**
   * O nome de um participante pelo que já se sabe dele — agenda e cadastro.
   *
   * Extraído de `resolveAuthorName` porque as menções precisam exatamente desta
   * escada, e uma segunda cópia divergiria na primeira vez que a ordem mudasse:
   * o mesmo participante apareceria com um nome acima da bolha e outro dentro
   * da frase que o cita.
   *
   * O `pushName` fica de fora de propósito. Ele é da **mensagem**, não da
   * pessoa: quem foi citado não escreveu nada aqui, então não há `pushName`
   * dele para consultar. Quem tem um continua usando, logo acima.
   */
  private async nomeConhecido(jid: string | undefined, phone: string): Promise<string | undefined> {
    // Cache por participante: num grupo movimentado a mesma pessoa escreve
    // dezenas de vezes seguidas, e nenhuma delas justifica reconsultar o banco.
    if (jid) {
      const memorizado = this.groupSenderNames.get(jid);
      if (memorizado) return memorizado;
    }

    const guardar = (nome: string): string => {
      if (jid) this.groupSenderNames.set(jid, nome);
      return nome;
    };

    // 1. Agenda sincronizada deste número (o `name` do `contacts.upsert`).
    const armazenado = jid ? this.contactsStore.get(jid) : undefined;
    const daAgenda = nomeUtilizavel(armazenado?.name);
    if (daAgenda) return guardar(daAgenda);

    // 2. Cadastro do CRM, quando o participante já é contato desta conta.
    if (phone) {
      try {
        const conhecido = await prisma.contact.findFirst({
          where: { accountId: this.accountId, kind: { not: 'grupo' }, phone },
          select: { name: true },
        });
        const nome = nomeUtilizavel(conhecido?.name);
        // Um cadastro cujo nome é o próprio número não acrescenta nada — e
        // aceitá-lo aqui bloquearia o `pushName`, que é melhor que ele.
        if (nome) return guardar(nome);
      } catch (error) {
        waLog.debug(`[sessão ${this.inboxId}] Nome do participante não consultado:`, error);
      }
    }

    return undefined;
  }

  /**
   * Quem foi citado com `@`, pronto para substituir no texto.
   *
   * Devolvido como tabela, e não aplicado direto, porque o mesmo conjunto de
   * menções vale para os três lugares em que o texto aparece — bolha, preview e
   * legenda. Resolver LID→telefone é uma consulta ao mapeamento do socket:
   * repeti-la três vezes por mensagem seria pagar o triplo pela mesma resposta.
   */
  private async tabelaDeMencoes(msg: WAMessage): Promise<{ marca: string; nome: string }[]> {
    const citados = mentionedJidsOf(msg);
    if (citados.length === 0) return [];

    const socket = this.socket;
    const trocas: { marca: string; nome: string }[] = [];

    for (const bruto of citados) {
      const pnJid = socket ? await resolvePhoneJid(socket, bruto) : bruto;
      const phone = phoneFromJid(pnJid);

      const nome =
        (await this.nomeConhecido(jidNormalizedUser(pnJid), phone)) ??
        (phone ? PhoneNumber.format(phone) || phone : undefined);

      // Sem nome e sem telefone não há o que pôr no lugar. Deixar o
      // identificador cru é feio; apagá-lo tiraria da frase a marca de que
      // alguém foi citado ali, que é a informação que importa.
      if (!nome) continue;

      // Os dois marcadores porque o corpo pode trazer qualquer um deles: o LID
      // nas conversas já migradas, o telefone nas que ainda não migraram.
      for (const marca of new Set([userOf(bruto), userOf(pnJid)])) {
        if (marca) trocas.push({ marca, nome });
      }
    }

    // Do marcador mais longo para o mais curto: um identificador que seja
    // prefixo de outro trocaria o pedaço errado se a ordem fosse a de chegada.
    return trocas.sort((a, b) => b.marca.length - a.marca.length);
  }

  /** Aplica a tabela de menções a um texto. */
  private static comMencoes(
    trocas: readonly { marca: string; nome: string }[],
    texto: string,
  ): string {
    let resultado = texto;
    for (const { marca, nome } of trocas) {
      resultado = resultado.replaceAll(`@${marca}`, `@${nome}`);
    }
    return resultado;
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
      // Foto privada ou indisponivel: mantem a copia que ja existir. A consulta
      // tem o proprio `catch` porque quem chama isto nao espera o resultado:
      // uma falha de banco aqui viraria rejeicao solta e derrubaria o worker.
      const avatarScope = { accountId: this.accountId, kind: 'avatar' as const };
      const publicId = await mediaStore.publicId(mediaId, avatarScope).catch(() => undefined);
      const fallback = publicId ? mediaUrlFor(publicId) : undefined;
      this.avatarCache.set(chat.jid, { url: fallback, at: Date.now() });
    }
  }

  /**
   * A mídia baixada e guardada, junto com os bytes e o caminho.
   *
   * Os bytes vão junto porque quem chama precisa deles para o base64 do
   * webhook, e voltar ao armazenamento para relê-los logo depois de gravá-los
   * seria uma segunda leitura do mesmo arquivo que acabou de passar pela
   * memória.
   */
  private async materializeMedia(
    msg: WAMessage,
    messageId: string,
    media: MediaRef,
    fallback: MessageContent,
  ): Promise<{ content: MessageContent; bytes?: Buffer; url?: string }> {
    if (media.fileLength > MAX_INLINE_MEDIA_BYTES) return { content: fallback };

    const mediaScope = {
      accountId: this.accountId,
      inboxId: this.inboxId,
      kind: 'mensagem' as const,
    };
    const posterSourceId = `${messageId}-poster`;
    if (await mediaStore.has(messageId, mediaScope)) {
      const publicId = await mediaStore.publicId(messageId, mediaScope);
      if (!publicId) return { content: fallback };
      const url = mediaUrlFor(publicId);
      // Já guardada: os bytes vêm do armazenamento só se ainda couberem no
      // base64. Acima do teto o corpo levaria a URL de qualquer forma, e ler o
      // arquivo seria trabalho jogado fora.
      const guardada =
        media.fileLength <= MAX_INLINE_MEDIA_BYTES
          ? await mediaStore.read(messageId, mediaScope).catch(() => null)
          : null;
      const bytes = guardada ? await guardada.bytes().catch(() => undefined) : undefined;
      const posterPublicId =
        media.kind === 'video' && isSafeMediaId(posterSourceId)
          ? await mediaStore.publicId(posterSourceId, mediaScope).catch(() => null)
          : null;
      const posterUrl = posterPublicId ? mediaUrlFor(posterPublicId) : undefined;
      return {
        content: mediaContent(media, url, posterUrl),
        url,
        ...(bytes ? { bytes } : {}),
      };
    }

    const socket = this.socket;
    if (!socket) return { content: fallback };

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
      const posterUrl =
        url &&
        media.kind === 'video' &&
        media.jpegThumbnail?.length &&
        isSafeMediaId(posterSourceId)
          ? await mediaStore
              .save(
                posterSourceId,
                Buffer.from(media.jpegThumbnail),
                { mimeType: 'image/jpeg' },
                mediaScope,
              )
              .catch(() => undefined)
          : undefined;
      // Os bytes seguem mesmo quando a gravação foi recusada: o conteúdo cai
      // para o texto de reserva na tela, mas quem integra ainda recebe a mídia.
      return {
        content: url ? mediaContent(media, url, posterUrl) : fallback,
        bytes: buffer,
        ...(url ? { url } : {}),
      };
    } catch (error) {
      console.warn(`[WhatsAppSession ${this.inboxId}] Falha ao baixar mídia:`, error);
      return { content: fallback };
    }
  }

  async materializePendingMedia(messageId: string): Promise<void> {
    const pending = await prisma.pendingMedia.findFirst({
      where: { messageId, accountId: this.accountId, inboxId: this.inboxId },
    });
    if (!pending) return;
    const row = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: { accountId: this.accountId, inboxId: this.inboxId },
      },
      select: { id: true, conversationId: true, content: true },
    });
    if (!row) return;
    const fallback = row.content as unknown as MessageContent;
    if (fallback.type !== 'pending_media') {
      await prisma.pendingMedia.deleteMany({
        where: { messageId, accountId: this.accountId, inboxId: this.inboxId },
      });
      return;
    }

    await prisma.pendingMedia.updateMany({
      where: { messageId, accountId: this.accountId, inboxId: this.inboxId },
      data: { status: 'baixando' },
    });
    try {
      const plain = open(
        Buffer.from(pending.cipher),
        Buffer.from(pending.iv),
        Buffer.from(pending.tag),
        {
          aad: messageId,
          keyId: pending.keyId,
        },
      );
      const raw = proto.WebMessageInfo.decode(plain) as WAMessage;
      const decoded = decodeWaMessage(raw);
      if (!decoded?.media) throw new Error('A referência não contém mídia compatível.');
      const materialized = await this.materializeMedia(raw, messageId, decoded.media, fallback);
      if (materialized.content.type === 'pending_media') {
        throw new Error('O celular não disponibilizou os bytes da mídia.');
      }
      const { count } = await prisma.message.updateMany({
        where: {
          id: messageId,
          conversationId: row.conversationId,
          conversation: { accountId: this.accountId, inboxId: this.inboxId },
          content: { path: ['type'], equals: 'pending_media' },
        },
        data: {
          contentType: materialized.content.type,
          content: asJson(materialized.content),
        },
      });
      if (count > 0) {
        await prisma.pendingMedia.deleteMany({
          where: { messageId, accountId: this.accountId, inboxId: this.inboxId },
        });
        waEventBus.emitConversation({
          type: 'message_updated',
          accountId: this.accountId,
          inboxId: this.inboxId,
          conversationId: row.conversationId,
          messageId,
        });
      }
    } catch (error) {
      const lastError = error instanceof Error ? error.message : 'Falha ao baixar mídia';
      const attempts = pending.attempts + 1;
      await prisma.$transaction([
        prisma.pendingMedia.updateMany({
          where: { messageId, accountId: this.accountId, inboxId: this.inboxId },
          data: {
            attempts: { increment: 1 },
            lastError,
            status: attempts >= 3 ? 'indisponivel' : 'pendente',
          },
        }),
        ...(attempts >= 3
          ? [
              prisma.message.updateMany({
                where: {
                  id: messageId,
                  conversationId: row.conversationId,
                  conversation: { accountId: this.accountId, inboxId: this.inboxId },
                  content: { path: ['type'], equals: 'pending_media' },
                },
                data: { content: asJson({ ...fallback, unavailable: true }) },
              }),
            ]
          : []),
      ]);
      if (attempts >= 3) {
        waEventBus.emitConversation({
          type: 'message_updated',
          accountId: this.accountId,
          inboxId: this.inboxId,
          conversationId: row.conversationId,
          messageId,
        });
      }
      throw error;
    }
  }

  async sendMessage(
    recipient: { phone?: string; jid?: string; channelThreadId?: string },
    content: { text?: string },
    options: {
      quote?: { externalId: string; fromMe: boolean; text: string };
      providerMessageId?: string;
      /** Id da linha do CRM que originou o envio. Ver `crmSentIds`. */
      crmMessageId?: string;
    } = {},
  ): Promise<string> {
    if (!this.socket || !this.isAuthenticated) {
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
    }

    const text = content.text ?? '';

    // A mensagem encerra o indicador daquele chat. O cancelamento e local ao
    // JID; presencas simultaneas de outros chats permanecem ativas.
    const presenceTimer = this.outboundPresenceTimers.get(targetJid);
    if (presenceTimer) clearTimeout(presenceTimer);
    this.outboundPresenceTimers.delete(targetJid);
    const endedPresence = this.outboundPresenceOnline.delete(targetJid);
    if (endedPresence) {
      await this.socket.sendPresenceUpdate('paused', targetJid).catch(() => undefined);
      if (this.outboundPresenceOnline.size === 0) {
        await this.socket.sendPresenceUpdate('unavailable').catch(() => undefined);
      }
    }

    // Cronometrado à parte de propósito: é o que separa "o Baileys está lento"
    // de "a fila está lenta". Sem esta medida, um envio de 3 minutos podia ser
    // qualquer um dos dois, e a diferença muda inteiramente onde se procura.
    const medir = waLog.timer(`[sessão ${this.inboxId}] socket.sendMessage`);
    const result = await this.socket.sendMessage(
      targetJid,
      { text },
      {
        ...(options.quote ? { quoted: quotedStub(targetJid, options.quote) } : {}),
        ...(options.providerMessageId ? { messageId: options.providerMessageId } : {}),
      },
    );
    medir(`texto de ${text.length} caractere(s) para ${targetJid}`);

    const msgId = result?.key.id;
    if (!msgId) throw new Error('O WhatsApp não confirmou o identificador da mensagem enviada.');

    this.trackSentId(msgId, options.crmMessageId);
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
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
    }

    const presenceTimer = this.outboundPresenceTimers.get(targetJid);
    if (presenceTimer) clearTimeout(presenceTimer);
    this.outboundPresenceTimers.delete(targetJid);
    const endedPresence = this.outboundPresenceOnline.delete(targetJid);
    if (endedPresence) {
      await this.socket.sendPresenceUpdate('paused', targetJid).catch(() => undefined);
      if (this.outboundPresenceOnline.size === 0) {
        await this.socket.sendPresenceUpdate('unavailable').catch(() => undefined);
      }
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
      quote?: { externalId: string; fromMe: boolean; text: string };
      providerMessageId?: string;
      /** Id da linha do CRM que originou o envio. Ver `crmSentIds`. */
      crmMessageId?: string;
    },
  ): Promise<string> {
    if (!this.socket || !this.isAuthenticated) {
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
    if (!targetJid) {
      throw new Error('Destinatário inválido: forneça telefone ou JID.');
    }

    const presenceTimer = this.outboundPresenceTimers.get(targetJid);
    if (presenceTimer) clearTimeout(presenceTimer);
    this.outboundPresenceTimers.delete(targetJid);
    const endedPresence = this.outboundPresenceOnline.delete(targetJid);
    if (endedPresence) {
      await this.socket.sendPresenceUpdate('paused', targetJid).catch(() => undefined);
      if (this.outboundPresenceOnline.size === 0) {
        await this.socket.sendPresenceUpdate('unavailable').catch(() => undefined);
      }
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
    const result = await this.socket.sendMessage(targetJid, payload, {
      ...(media.quote ? { quoted: quotedStub(targetJid, media.quote) } : {}),
      ...(media.providerMessageId ? { messageId: media.providerMessageId } : {}),
    });
    medir(`${media.kind} de ${media.data.length} byte(s) para ${targetJid}`);

    const msgId = result?.key.id;
    if (!msgId) throw new Error('O WhatsApp não confirmou o identificador do anexo enviado.');
    this.trackSentId(msgId, media.crmMessageId);
    return msgId;
  }

  /** Janela deslizante: so o passado recente de envios precisa ser deduplicado. */
  private trackSentId(msgId: string, crmMessageId?: string): void {
    this.crmSentIds.set(msgId, crmMessageId);
    if (this.crmSentIds.size > MAX_TRACKED_SENT_IDS) {
      const oldest = this.crmSentIds.keys().next().value;
      if (oldest) this.crmSentIds.delete(oldest);
    }
  }

  async markAsRead(conversationId: string): Promise<void> {
    let key = this.lastInboundKey.get(conversationId);
    if (!key) {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, accountId: this.accountId, inboxId: this.inboxId },
        select: {
          channelThreadId: true,
          messages: {
            where: { author: 'contact', externalId: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { externalId: true, senderJid: true },
          },
        },
      });
      const latest = conversation?.messages[0];
      if (conversation?.channelThreadId && latest?.externalId) {
        key = {
          remoteJid: conversation.channelThreadId,
          id: latest.externalId,
          fromMe: false,
          ...(latest.senderJid ? { participant: latest.senderJid } : {}),
        };
      }
    }
    if (this.socket && this.isAuthenticated && key) {
      try {
        await this.socket.readMessages([key]);
        this.lastInboundKey.delete(conversationId);
      } catch (err) {
        console.warn(`[WhatsAppSession ${this.inboxId}] Falha ao marcar lido:`, err);
      }
    }
  }

  /** Encerra o socket corrente e solta os listeners presos a ele. */
  private teardownSocket(): void {
    this.socketGeneration += 1;
    for (const timer of this.outboundPresenceTimers.values()) clearTimeout(timer);
    this.outboundPresenceTimers.clear();
    this.outboundPresenceOnline.clear();
    if (!this.socket) return;
    try {
      this.socket.ev.removeAllListeners('connection.update');
      this.socket.ev.removeAllListeners('creds.update');
      this.socket.ev.removeAllListeners('messages.upsert');
      this.socket.ev.removeAllListeners('messages.update');
      this.socket.ev.removeAllListeners('message-receipt.update');
      this.socket.ev.removeAllListeners('messaging-history.set');
      this.socket.ev.removeAllListeners('messaging-history.status');
      this.socket.ev.removeAllListeners('messages.reaction');
      this.socket.ev.removeAllListeners('contacts.upsert');
      this.socket.ev.removeAllListeners('contacts.update');
      this.socket.ev.removeAllListeners('presence.update');
      this.socket.end(undefined);
    } catch {
      // Ignora erro ao fechar socket
    }
    this.socket = null;
    this.historyImporter?.stop();
    this.historyImporter = null;
    for (const pending of this.onDemandHistory.values()) {
      clearTimeout(pending.timer);
      pending.importer.stop();
    }
    this.onDemandHistory.clear();
    if (this.historyIdleTimer) clearTimeout(this.historyIdleTimer);
    this.historyIdleTimer = null;
    // As assinaturas de presença morrem com o socket: guardá-las faria a sessão
    // seguinte achar que já assinou o que ninguém assinou, e o "digitando"
    // simplesmente pararia de chegar depois da primeira reconexão.
    this.presenceByJid.clear();
    this.typingByConversation.clear();
    this.groupSenderNames.clear();
    // O aviso de "fila represada entregue" vale para a conexão que acabou de
    // morrer. A próxima precisa esperar o seu.
    this.pendingNotificationsDone = false;
  }

  /**
   * Desliga a caixa de verdade: avisa o WhatsApp, apaga o vínculo e grava a
   * intenção de ficar desconectada.
   *
   * `stop()` só fecha o socket — é o que um reinício do worker precisa, e ali as
   * credenciais têm de sobreviver. Um "Desconectar" pedido na tela é outra
   * coisa, e era tratado como se fosse o mesmo: com as credenciais no banco, o
   * worker seguinte religava a caixa sozinho, abrir uma conversa dela também, e
   * o celular continuava listando o CRM entre os aparelhos conectados.
   *
   * O aviso ao WhatsApp só é possível com a sessão aberta. Sem ela — ou sem
   * resposta a tempo — o vínculo é apagado deste lado mesmo assim, e a tela diz
   * como terminar pelo celular.
   */
  async logout(): Promise<void> {
    const socket = this.socket;
    const podiaAvisar = Boolean(socket && this.isAuthenticated);
    this.encerrada = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.finishDrain('caixa desconectada');

    let avisou = false;
    if (socket && podiaAvisar) {
      // Os ouvintes deste socket ficam inertes antes do aviso: o `logout` do
      // Baileys fecha a conexão com 401, e o tratador de queda leria isso como
      // "desconectado no aparelho".
      this.socketGeneration += 1;
      let prazo: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          socket.logout(),
          new Promise<never>((_, reject) => {
            prazo = setTimeout(
              () => reject(new Error(`sem resposta em ${LOGOUT_TIMEOUT_MS / 1000}s`)),
              LOGOUT_TIMEOUT_MS,
            );
          }),
        ]);
        avisou = true;
      } catch (error) {
        console.warn(
          `[WhatsAppSession ${this.inboxId}] O WhatsApp não confirmou a desvinculação:`,
          error,
        );
      } finally {
        if (prazo) clearTimeout(prazo);
      }
    }

    this.teardownSocket();
    this.isAuthenticated = false;
    this.isInitializing = false;
    this.liberarEspera(false);
    this.qrAttempts = 0;
    this.qrCycles = 0;
    this.pairingPhone = undefined;

    const apagou = await wipeAuthState(this.inboxId, {
      workerId: this.workerId,
      lockVersion: this.lockVersion,
    });
    if (!apagou) {
      throw new SessaoIndisponivelError(
        `A posse da sessão ${this.inboxId} mudou para outro worker antes da desconexão.`,
      );
    }

    await this.updateStatus(
      {
        status: 'desconectado',
        qr: undefined,
        pairingCode: undefined,
        phone: undefined,
        name: undefined,
        connectedAt: undefined,
        owner: undefined,
        error: avisou
          ? undefined
          : 'Desconectado neste CRM. Se "Solint CRM" ainda aparecer em Aparelhos ' +
            'conectados no celular, remova-o por lá.',
      },
      { autoConnect: false },
    );
    console.log(
      `[WhatsAppSession ${this.inboxId}] Caixa desconectada` +
        (avisou ? ' e desvinculada no WhatsApp.' : '; o WhatsApp não foi avisado.'),
    );
  }

  async stop(options: { persistStatus?: boolean } = {}): Promise<void> {
    this.encerrada = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Fecha a janela de silêncio antes de sair: o que foi gravado calado ainda
    // não foi anunciado, e desligar sem isso deixaria as telas abertas sem
    // saber das mensagens que acabaram de entrar.
    await this.finishDrain('sessão encerrada');
    // Grava a agenda pendente enquanto o socket ainda sabe qual é o número: é
    // esta gravação que o próximo boot vai ler. Um deploy cai exatamente aqui.
    if (this.addressBookTimer) {
      clearTimeout(this.addressBookTimer);
      this.addressBookTimer = null;
    }
    await this.flushAddressBook();
    if (this.pendingAddressBook.size > 0) await this.flushAddressBook();
    this.teardownSocket();
    this.isAuthenticated = false;
    this.isInitializing = false;
    // Ninguém mais vai abrir esta sessão. Quem espera precisa saber agora, em
    // vez de descobrir daqui a trinta segundos pelo tempo limite.
    this.liberarEspera(false);
    // Encerramento explícito zera os orçamentos de pareamento: quem desconectar
    // e voltar a conectar começa do zero, não do que sobrou da tentativa antiga.
    this.qrAttempts = 0;
    this.qrCycles = 0;
    this.pairingPhone = undefined;
    if (options.persistStatus !== false) {
      await this.updateStatus({ status: 'desconectado', qr: undefined });
    }
  }
}
