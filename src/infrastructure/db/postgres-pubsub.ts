import crypto from 'node:crypto';
import pg from 'pg';

const { Client, Pool } = pg;

export const INSTANCE_ID = crypto.randomUUID();

const CHANNELS = {
  CONVERSATIONS: 'solint_conversation_events',
  STATUS: 'solint_whatsapp_status',
  /** Avisa o worker que ha comando novo na fila — evita esperar o proximo poll. */
  COMMANDS: 'solint_whatsapp_commands',
  /** Batida do worker: e assim que a aplicacao sabe que existe um worker vivo. */
  WORKER: 'solint_whatsapp_worker',
} as const;

type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export interface PubSubNotification<T = unknown> {
  readonly __originInstanceId: string;
  readonly data: T;
}

class PostgresPubSubManager {
  private listenerClient: pg.Client | null = null;
  /**
   * Publicacao usa **pool**, nao um cliente unico.
   *
   * Um `pg.Client` atende uma consulta por vez. Com um so, duas publicacoes
   * simultaneas — e elas sao simultaneas o tempo todo: batida do worker a cada
   * 5s, evento de status, evento de conversa — disparavam
   * `Calling client.query() when the client is already executing a query is
   * deprecated`, e a segunda ficava esperando a primeira sem necessidade.
   * O pool entrega uma conexao por chamada e o problema desaparece.
   */
  private publisherPool: pg.Pool | null = null;
  private isConnecting = false;

  private retryTimeout: NodeJS.Timeout | null = null;
  private listeners: Map<ChannelName, Set<(data: unknown) => void>> = new Map();

  /**
   * Conexao de escuta: **precisa** ser modo sessao (porta 5432).
   *
   * `LISTEN` registra o interesse na propria conexao e fica esperando. No modo
   * transacao do pooler a conexao volta para o pool ao fim de cada comando, e a
   * inscricao vai junto — nunca chega notificacao nenhuma.
   */
  private listenerConnectionString(): string | undefined {
    return (
      process.env.DIRECT_URL ?? process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL
    );
  }

  /**
   * Conexao de publicacao: prefere o pooler em modo transacao (porta 6543).
   *
   * Publicar e um `SELECT pg_notify(...)` — um comando isolado, sem estado a
   * preservar entre chamadas, exatamente o que o modo transacao atende bem.
   *
   * Usar a porta de sessao aqui gastava uma vaga de um recurso escasso: o modo
   * sessao do Supabase permite ~15 clientes, e cada processo que importa este
   * modulo abre uma conexao de escuta **mais** uma de publicacao. Bastava o
   * `next build` subir seus processos paralelos para estourar o limite com
   * `max clients reached in session mode`. A escuta continua na porta de sessao
   * porque nao tem escolha; a publicacao passa para o pooler, que e feito para
   * isso.
   */
  private publisherConnectionString(): string | undefined {
    return (
      process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.WORKER_DATABASE_URL
    );
  }

  /**
   * Inicializa o cliente de escuta permanente (LISTEN) via porta de sessão 5432.
   */
  async startListening(): Promise<void> {
    if (this.listenerClient || this.isConnecting) return;

    // Durante o `next build` os modulos sao avaliados so para gerar as paginas:
    // ninguem esta ouvindo evento nenhum, e cada processo do build abriria a sua
    // conexao de escuta. Era o que estourava o limite de clientes em modo sessao.
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

    const connectionString = this.listenerConnectionString();
    if (!connectionString) {
      console.warn('[PostgresPubSub] Nenhuma string de conexão disponível para LISTEN/NOTIFY.');
      return;
    }

    this.isConnecting = true;

    try {
      const client = new Client({ connectionString });
      await client.connect();

      client.on('notification', (msg) => {
        if (!msg.channel || !msg.payload) return;

        try {
          const envelope = JSON.parse(msg.payload) as PubSubNotification;
          // Ignora eco da propria instancia nos canais de *evento*: quem emitiu ja
          // entregou aos seus ouvintes locais, e reentregar duplicaria a mensagem.
          // Os canais de coordenacao (comando e batida) sao a excecao: ali o eco e
          // informacao legitima, porque emissor e consumidor podem ser o mesmo
          // processo quando app e worker rodam juntos.
          const isCoordination =
            msg.channel === CHANNELS.COMMANDS || msg.channel === CHANNELS.WORKER;
          if (!isCoordination && envelope.__originInstanceId === INSTANCE_ID) return;

          const callbacks = this.listeners.get(msg.channel as ChannelName);
          if (callbacks) {
            for (const cb of callbacks) {
              try {
                cb(envelope.data);
              } catch (err) {
                console.error('[PostgresPubSub] Erro no callback do listener:', err);
              }
            }
          }
        } catch (err) {
          console.error('[PostgresPubSub] Erro ao deserializar notificação do Postgres:', err);
        }
      });

      client.on('error', (err) => {
        console.warn('[PostgresPubSub] Erro na conexão de escuta:', err.message);
        this.reconnect();
      });

      client.on('end', () => {
        console.warn('[PostgresPubSub] Conexão de escuta finalizada. Reconectando...');
        this.reconnect();
      });

      // Registra os canais no Postgres
      for (const channel of Object.values(CHANNELS)) {
        await client.query(`LISTEN ${channel}`);
      }

      this.listenerClient = client;
      this.isConnecting = false;
    } catch (err) {
      this.isConnecting = false;
      console.warn('[PostgresPubSub] Falha ao conectar listener Postgres. Nova tentativa em 5s:', err);
      this.scheduleReconnect(5000);
    }
  }

  private reconnect(): void {
    if (this.listenerClient) {
      try {
        this.listenerClient.end();
      } catch {
        // Ignora
      }
      this.listenerClient = null;
    }
    this.scheduleReconnect(3000);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = setTimeout(() => {
      this.startListening();
    }, delayMs);
  }

  /**
   * Assina um canal para receber mensagens broadcasted de outras instâncias.
   */
  subscribe<T>(channel: ChannelName, callback: (data: T) => void): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(callback as (data: unknown) => void);

    // Garante que o listener está ativo
    this.startListening().catch(() => {});

    return () => {
      set?.delete(callback as (data: unknown) => void);
    };
  }

  /**
   * Emite uma notificação assíncrona via `pg_notify` para todas as instâncias conectadas.
   */
  async publish<T>(channel: ChannelName, data: T): Promise<void> {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

    const connectionString = this.publisherConnectionString();
    if (!connectionString) return;

    try {
      const envelope: PubSubNotification<T> = {
        __originInstanceId: INSTANCE_ID,
        data,
      };

      const payload = JSON.stringify(envelope);

      /**
       * Rede de segurança, e **nada mais que isso**.
       *
       * O teto do `pg_notify` é 8000 bytes. Este corte já foi o mecanismo
       * normal de publicação, e custou caro: uma conversa com trinta mensagens
       * passava de 7.500 bytes, os campos `message` e `conversation` eram
       * removidos, e o outro lado recebia um evento sem nada dentro — que o
       * cliente descartava em silêncio. Mensagem recebida só aparecia depois de
       * um F5, sem erro em lugar nenhum.
       *
       * Quem publica agora manda só identificadores (ver `thin` em
       * `whatsapp-events.ts`), então este caminho não deve mais ser alcançado.
       * Se for, é sinal de que algum publicador voltou a mandar objeto grande —
       * e o aviso abaixo existe justamente para que isso não passe despercebido
       * de novo.
       */
      let safePayload = payload;
      if (Buffer.byteLength(safePayload, 'utf-8') > 7500) {
        console.warn(
          `[PostgresPubSub] Evento em "${channel}" excedeu o teto do NOTIFY ` +
            `(${Buffer.byteLength(payload, 'utf-8')} bytes). Campos volumosos serão cortados — ` +
            'publique apenas identificadores neste canal.',
        );
        if (typeof data === 'object' && data !== null) {
          const {
            qr: _qr,
            message: _msg,
            conversation: _conv,
            timeline: _tl,
            protocols: _proto,
            content: _ct,
            ...compactData
          } = data as Record<string, unknown>;
          safePayload = JSON.stringify({
            __originInstanceId: INSTANCE_ID,
            data: compactData,
          });
        }
      }

      if (Buffer.byteLength(safePayload, 'utf-8') > 7500) {
        console.warn(
          `[PostgresPubSub] Evento em "${channel}" segue acima do teto mesmo após o corte. ` +
            'Descartado — nenhuma outra instância será avisada.',
        );
        return;
      }

      if (!this.publisherPool) {
        // `max` baixo de proposito: publicar e uma consulta curta e rara em
        // volume. O pool esta aqui pela concorrencia, nao pela vazao.
        const pool = new Pool({ connectionString, max: 3 });
        pool.on('error', () => {
          // Conexao ociosa derrubada pelo servidor: o pool se recupera sozinho
          // na proxima aquisicao. Engolir o evento evita derrubar o processo.
        });
        this.publisherPool = pool;
      }

      await this.publisherPool.query('SELECT pg_notify($1, $2)', [channel, safePayload]);
    } catch (err) {
      console.warn('[PostgresPubSub] Falha ao publicar evento no Postgres:', err);
      // Pool inutilizavel: descarta para recriar na proxima publicacao.
      void this.publisherPool?.end().catch(() => undefined);
      this.publisherPool = null;
    }
  }
}

const globalRef = globalThis as typeof globalThis & { __solintPostgresPubSub?: PostgresPubSubManager };

export const postgresPubSub: PostgresPubSubManager =
  globalRef.__solintPostgresPubSub ?? new PostgresPubSubManager();

if (process.env.NODE_ENV !== 'production') {
  globalRef.__solintPostgresPubSub = postgresPubSub;
}

export { CHANNELS };
