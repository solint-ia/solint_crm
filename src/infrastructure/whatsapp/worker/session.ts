import {
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
import {
  PhoneNumber,
  isGroupAllowedInChat,
  groupInboxIds,
  GROUP_ALLOWED_FIELD_LABEL,
  GROUP_INBOXES_FIELD_LABEL,
  type CustomField,
} from '@/core/domain/contact';
import { DB_POOL_SIZE, asJson, prisma } from '@/infrastructure/db/prisma';
import { initPostgresAuthState, isPairedCreds } from '../auth/postgres-auth-state';
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
  /**
   * Quantas vezes seguidas esta sessão foi substituída por outra (440).
   *
   * Zerado a cada conexão bem-sucedida. Serve só para espaçar as tentativas:
   * duas sessões brigando pelo mesmo número se derrubam em laço, e reconectar
   * na hora transforma a briga em tempestade.
   */
  private replacedCount = 0;
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
  /** A agenda completa já passou por esta sessão ou ainda exige resync manual? */
  private hasAddressBookSnapshot = false;
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
    this.reconnectTimer = setTimeout(() => void this.start(), delayMs);
    this.reconnectTimer.unref?.();
  }

  /**
   * Grava o estado sem deixar a falha escapar.
   *
   * Usado no tratador de queda, onde uma exceção não custaria só a linha do
   * banco: ela abortaria o resto do tratador. O erro é registrado — perder a
   * gravação em silêncio seria trocar um defeito visível por um invisível.
   */
  private async registrarEstado(patch: Partial<WhatsAppStatusPayload>): Promise<void> {
    try {
      await this.updateStatus(patch);
    } catch (error) {
      console.error(
        `[WhatsAppSession ${this.inboxId}] Falha ao gravar o estado ` +
          `'${patch.status ?? this.currentStatus.status}':`,
        error,
      );
    }
  }

  private async updateStatus(patch: Partial<WhatsAppStatusPayload>) {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
      // Nunca sobrescrito por um patch: e a identidade da sessao, nao um estado.
      inboxId: this.inboxId,
      updatedAt: new Date().toISOString(),
    };

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
        syncFullHistory: false,
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
            await this.registrarEstado({
              status: 'desconectado',
              qr: undefined,
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
              await this.registrarEstado({
                status: 'desconectado',
                error:
                  'Outro dispositivo assumiu este número. Feche o WhatsApp Web e conecte novamente.',
                qr: undefined,
              });
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
              await prisma.whatsAppKey.deleteMany({ where: { inboxId: this.inboxId } });
              await prisma.whatsAppConnection.updateMany({
                where: { inboxId: this.inboxId },
                data: { credsCipher: null, credsIv: null, credsTag: null, status: 'desconectado' },
              });
            } catch (error) {
              console.error(
                `[WhatsAppSession ${this.inboxId}] Falha ao limpar as credenciais revogadas:`,
                error,
              );
            }
            await this.registrarEstado({
              status: 'desconectado',
              error: 'Desconectado no aparelho do WhatsApp.',
              qr: undefined,
            });
            return;
          }

          if (statusCode === DisconnectReason.badSession || statusCode === 500) {
            // Mesmo motivo: uma falha ao apagar as chaves não pode engolir a
            // reconexão que vem logo abaixo.
            try {
              await prisma.whatsAppKey.deleteMany({ where: { inboxId: this.inboxId } });
            } catch (error) {
              console.error(
                `[WhatsAppSession ${this.inboxId}] Falha ao descartar as chaves da sessão inválida:`,
                error,
              );
            }
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
              this.agendarReconexao(1500);
              await this.registrarEstado({ status: 'gerando_qr' });
              return;
            }

            // Os dois orçamentos voltam juntos: a mensagem acima manda clicar em
            // conectar, e a tentativa seguinte precisa começar inteira.
            this.qrAttempts = 0;
            this.qrCycles = 0;
            await this.registrarEstado({
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

          const userJid = this.socket?.user?.id ? jidNormalizedUser(this.socket.user.id) : undefined;

          const ownerName = this.socket?.user?.name ?? (userJid ? PhoneNumber.format(userOf(userJid)) : 'WhatsApp');

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
          if (receipt.receiptTimestamp) await applyDeliveryUpdate(key.id, 'entregue');
          if (receipt.readTimestamp) await applyDeliveryUpdate(key.id, 'lido');
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
      await applyReaction(alvo, { emoji, actorId: 'me', by: 'agent' });
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

    await applyReaction(alvo, {
      emoji,
      actorId,
      by: 'contact',
      ...(nome ? { authorName: nome } : {}),
    });
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
   * Mantém o retrato recebido do WhatsApp apenas na memória da sessão.
   *
   * Os eventos de agenda chegam no pareamento, em reconexões e em alterações
   * feitas no celular. Persistir daqui transformava todos esses eventos numa
   * sincronização automática do CRM. A única rotina autorizada a gravar a
   * agenda agora é `syncAllStoredContacts`, chamada pelo botão explícito.
   */
  private rememberContact(contact: Partial<WAContact>): void {
    const rawJid = contact.phoneNumber ?? contact.id;
    if (!rawJid || isJidGroup(rawJid) || rawJid.endsWith('@g.us') || rawJid.includes('@broadcast') || rawJid.includes('@newsletter')) return;

    if (this.socket?.user?.id && jidNormalizedUser(rawJid) === jidNormalizedUser(this.socket.user.id)) return;

    const jid = jidNormalizedUser(rawJid);
    const existingStored = this.contactsStore.get(jid);
    this.contactsStore.set(jid, { ...existingStored, ...contact });
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
      if (!rawJid || isJidGroup(rawJid) || rawJid.endsWith('@g.us') || rawJid.includes('@broadcast') || rawJid.includes('@newsletter')) continue;
      if (this.socket?.user?.id && jidNormalizedUser(rawJid) === jidNormalizedUser(this.socket.user.id)) continue;

      const phoneDigits = userOf(rawJid);
      if (!phoneDigits) continue;
      const phone = PhoneNumber.normalize(`+${phoneDigits}`);
      if (!PhoneNumber.isValid(phone)) continue;

      const addressBookName = nomeUtilizavel(contact.name);
      const pushName = nomeUtilizavel(contact.notify) ?? nomeUtilizavel(contact.verifiedName);
      const resolvedName = addressBookName || pushName || PhoneNumber.format(phone) || phone;
      const avatarUrl = typeof contact.imgUrl === 'string' && contact.imgUrl !== 'changed' ? contact.imgUrl : undefined;

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
              data: { name: addressBookName, ...(avatarUrl && !existing.avatarUrl ? { avatarUrl } : {}) },
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
          const caixas = new Set(
            groupInboxIds({ customFields: anteriores }).concat(this.inboxId),
          );
          const customFields = [
            ...anteriores.filter((campo) => campo?.label !== GROUP_INBOXES_FIELD_LABEL),
            { label: GROUP_INBOXES_FIELD_LABEL, value: [...caixas].join(',') },
          ];

          await prisma.contact.update({
            where: { id: existing.id, accountId },
            data: {
              name: group.subject || existing.name,
              participantCount: group.size ?? group.participants?.length ?? existing.participantCount,
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
    const targetJid = normalizeTargetJid(raw);
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
      : nomeUtilizavel(msg.pushName) ?? nomeUtilizavel(msg.verifiedBizName);
    const storedName = nomeUtilizavel(
      this.contactsStore.get(jidNormalizedUser(chat.jid))?.name,
    );
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
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
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
      throw new SessaoIndisponivelError(`Sessão WhatsApp ${this.inboxId} não está conectada.`);
    }

    const raw = recipient.channelThreadId ?? recipient.jid ?? recipient.phone;
    const targetJid = normalizeTargetJid(raw);
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
      quote?: { externalId: string; fromMe: boolean; text: string };
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
    const result = await this.socket.sendMessage(
      targetJid,
      payload,
      media.quote ? { quoted: quotedStub(targetJid, media.quote) } : {},
    );
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
      this.socket.ev.removeAllListeners('message-receipt.update');
      this.socket.ev.removeAllListeners('messaging-history.set');
      this.socket.ev.removeAllListeners('messages.reaction');
      this.socket.ev.removeAllListeners('contacts.upsert');
      this.socket.ev.removeAllListeners('contacts.update');
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
    this.groupSenderNames.clear();
    // O aviso de "fila represada entregue" vale para a conexão que acabou de
    // morrer. A próxima precisa esperar o seu.
    this.pendingNotificationsDone = false;
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
    // Ninguém mais vai abrir esta sessão. Quem espera precisa saber agora, em
    // vez de descobrir daqui a trinta segundos pelo tempo limite.
    this.liberarEspera(false);
    // Encerramento explícito zera os orçamentos de pareamento: quem desconectar
    // e voltar a conectar começa do zero, não do que sobrou da tentativa antiga.
    this.qrAttempts = 0;
    this.qrCycles = 0;
    await this.updateStatus({ status: 'desconectado', qr: undefined });
  }
}
