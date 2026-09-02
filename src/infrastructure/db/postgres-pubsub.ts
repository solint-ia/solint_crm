import crypto from 'node:crypto';
import pg from 'pg';
import { prisma } from './prisma';

const { Client } = pg;

/**
 * Intervalo da batida na conexão de escuta.
 *
 * `LISTEN` não trafega nada enquanto ninguém publica, e uma conexão TCP que não
 * trafega é a primeira que um NAT, um balanceador ou o próprio Supabase
 * derrubam — sem FIN, sem erro, sem `end`. Do lado de cá o socket continua
 * "aberto" e o `pg` não tem como perceber: as notificações simplesmente param
 * de chegar, para sempre, e nada aparece no log.
 *
 * Era esta a causa do sininho que às vezes nunca tocava. A batida força tráfego
 * e, quando ela falha, temos o gatilho para reconectar.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Teto de espera da batida. Passou disto, a conexão está morta, não lenta. */
const HEARTBEAT_TIMEOUT_MS = 10_000;

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
  private isConnecting = false;

  /**
   * Quantas tentativas seguidas falharam, para espaçar as próximas.
   *
   * Sem recuo, uma indisponibilidade de trinta segundos vira dez tentativas de
   * conexão — e, no modo sessão do Supabase, tentativa de conexão é slot
   * ocupado. O martelo transformava uma falha passageira em esgotamento do
   * pooler, que derruba **tudo**: recibo de entrega, batida do worker e as
   * travas de sessão do WhatsApp saem juntos no mesmo minuto.
   */
  private tentativasSeguidas = 0;

  /**
   * Fechamento pedido por nós.
   *
   * `end()` dispara o evento `end`, e o ouvinte de `end` chama `reconnect()`.
   * Sem esta marca, toda reconexão agendava outra reconexão logo em seguida.
   */
  private fechandoDeProposito = false;

  private retryTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
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

    /**
     * Fora do `try` de propósito: é o que o `catch` precisa alcançar para
     * fechar a conexão que já subiu.
     *
     * **O vazamento que isto conserta.** `connect()` podia dar certo e o
     * `LISTEN` seguinte falhar — o caso comum quando o pooler está sob pressão.
     * A conexão ficava aberta no Postgres, sem referência de ninguém, e a
     * retentativa cinco segundos depois abria outra. Em pouco mais de um
     * minuto os quinze slots do modo sessão estavam consumidos por conexões
     * órfãs, e a partir dali nada mais funcionava: batida do worker, trava de
     * sessão do WhatsApp e envio de mensagem falhavam todos com
     * `EMAXCONNSESSION`.
     */
    let client: pg.Client | undefined;

    try {
      // `keepAlive` não é detalhe de afinação aqui: é o que impede a conexão de
      // escuta de ser silenciosamente descartada por ficar ociosa.
      client = new Client({
        connectionString,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      });
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

      // A conexão não pode ser só "aberta": ela tem de trafegar. O keepAlive do
      // TCP cobre o caminho de rede; a batida de `startHeartbeat` cobre o resto
      // — um pooler que encerra a sessão do outro lado sem avisar deixa o
      // socket local válido e o `pg` sem nada a reportar.
      client.on('end', () => {
        // Fechamento nosso não é queda: `reconnect()` já vai agendar a volta.
        if (this.fechandoDeProposito) return;
        console.warn('[PostgresPubSub] Conexão de escuta finalizada. Reconectando...');
        this.reconnect();
      });

      // Registra os canais no Postgres
      for (const channel of Object.values(CHANNELS)) {
        await client.query(`LISTEN ${channel}`);
      }

      this.listenerClient = client;
      this.isConnecting = false;
      this.tentativasSeguidas = 0;
      this.startHeartbeat();
    } catch (err) {
      this.isConnecting = false;

      // A conexão órfã sai daqui, e sai antes de agendar qualquer retentativa.
      if (client) await this.encerrarCliente(client);

      const espera = this.proximaEspera();
      console.warn(
        `[PostgresPubSub] Falha ao conectar listener Postgres. Nova tentativa em ${Math.round(espera / 1000)}s:`,
        err,
      );
      this.scheduleReconnect(espera);
    }
  }

  /**
   * Fecha uma conexão de escuta sem deixar rastro.
   *
   * `end()` devolve promessa e pode rejeitar; sem `await` e sem `catch` a
   * rejeição virava `unhandledRejection` e o socket podia sobreviver ao
   * processo que o abandonou. A marca impede que o evento `end` que este
   * fechamento dispara seja lido como queda e agende outra reconexão.
   */
  private async encerrarCliente(client: pg.Client): Promise<void> {
    this.fechandoDeProposito = true;
    try {
      await client.end();
    } catch {
      // Conexão já morta do outro lado: não há o que fechar.
    } finally {
      this.fechandoDeProposito = false;
    }
  }

  /**
   * Recuo exponencial com teto e sorteio.
   *
   * O teto de trinta segundos evita que uma indisponibilidade longa vire espera
   * eterna; o sorteio evita que várias instâncias, derrubadas pelo mesmo
   * incidente, voltem todas no mesmo instante e derrubem o pooler de novo.
   */
  private proximaEspera(): number {
    this.tentativasSeguidas = Math.min(this.tentativasSeguidas + 1, 6);
    const base = Math.min(3000 * 2 ** (this.tentativasSeguidas - 1), 30_000);
    return base + Math.floor(Math.random() * 1000);
  }

  /**
   * Confere periodicamente se a escuta continua viva — e a refaz quando não.
   *
   * Um `SELECT 1` é o menor tráfego possível e é o suficiente: se a sessão do
   * outro lado morreu, a consulta falha (ou nunca responde, daí o teto) e a
   * reconexão acontece em segundos, não na próxima vez que alguém reiniciar o
   * processo.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      const client = this.listenerClient;
      if (!client) return;

      void Promise.race([
        client.query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sem resposta')), HEARTBEAT_TIMEOUT_MS),
        ),
      ]).catch((err: unknown) => {
        console.warn(
          '[PostgresPubSub] Escuta sem resposta; reconectando:',
          err instanceof Error ? err.message : err,
        );
        this.reconnect();
      });
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatTimer.unref?.();
  }

  private reconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const anterior = this.listenerClient;
    // Zerado **antes** do fechamento: `end()` é assíncrono, e enquanto ele não
    // termina uma segunda queda entraria aqui e tentaria fechar o mesmo cliente.
    this.listenerClient = null;

    const espera = this.proximaEspera();
    if (anterior) {
      // Sem `await` porque `reconnect` é chamada de ouvintes de evento, que não
      // esperam promessa. O fechamento acontece de qualquer forma, e o
      // agendamento abaixo já respeita o recuo.
      void this.encerrarCliente(anterior);
    }
    this.scheduleReconnect(espera);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = setTimeout(() => {
      // `startListening` trata os próprios erros; o `catch` existe para que uma
      // rejeição inesperada não vire `unhandledRejection` e derrube o worker.
      void this.startListening().catch((err: unknown) => {
        console.warn('[PostgresPubSub] Falha inesperada ao reabrir a escuta:', err);
      });
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
   * Fecha a escuta quando não sobrou ninguém interessado.
   *
   * Existe por causa do serverless: uma instância que serviu uma conexão de SSE
   * e a perdeu continuaria segurando um dos quinze slots de modo sessão do
   * projeto até ser reciclada. Devolver o slot na hora é a diferença entre o
   * teto ser alcançado em minutos ou nunca.
   *
   * Não faz nada quando ainda há assinante — o worker, por exemplo, escuta o
   * tempo todo e não deve ser desligado por engano.
   */
  stopListeningIfIdle(): void {
    for (const set of this.listeners.values()) {
      if (set.size > 0) return;
    }

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const anterior = this.listenerClient;
    this.listenerClient = null;
    this.tentativasSeguidas = 0;
    if (anterior) void this.encerrarCliente(anterior);
  }

  /**
   * Emite uma notificação assíncrona via `pg_notify` para todas as instâncias conectadas.
   */
  async publish<T>(channel: ChannelName, data: T): Promise<void> {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

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

      /**
       * Publicar reaproveita o pool do Prisma. **Nenhuma conexão nova.**
       *
       * Havia um `pg.Pool` só para isto, com `max: 3`. Parecia barato e não
       * era: o modo sessão do Supabase entrega ~15 clientes para o projeto
       * **inteiro**, e cada processo que importa este módulo abria uma conexão
       * de escuta *mais* até três de publicação. Somando worker (três sessões
       * de WhatsApp), site e a migração do build, o teto estourava — e quando
       * estoura, estoura para tudo: no log de produção o mesmo
       * `EMAXCONNSESSION` derrubava `prisma.message.findFirst` (o recibo de
       * entrega) e o `pg_notify` (o aviso de mensagem nova) no mesmo minuto.
       *
       * `pg_notify` é um comando isolado, sem estado a preservar entre
       * chamadas: cabe no pool que já existe, inclusive no modo transação. O
       * pool do Prisma também resolve, de graça, o que motivava o pool
       * dedicado — duas publicações simultâneas não disputam uma conexão só.
       *
       * **`$executeRaw`, e não `$queryRaw`.** `pg_notify` devolve `void`, e o
       * adaptador `pg` do Prisma não sabe desserializar essa coluna:
       * `$queryRaw` disparava `Failed to deserialize column of type 'void'`
       * em **toda** publicação. O efeito colateral acontecia mesmo assim — o
       * Postgres executa a função e entrega a notificação antes de o cliente
       * tentar ler o resultado —, então o tempo real continuava funcionando e
       * o log se enchia de erros que não descreviam falha nenhuma. Pior tipo
       * de erro: o que treina quem lê o log a ignorá-lo.
       *
       * `$executeRaw` não lê colunas, só conta linhas afetadas. Mesma consulta,
       * mesmo efeito, sem o falso alarme.
       */
      await prisma.$executeRaw`SELECT pg_notify(${channel}::text, ${safePayload}::text)`;
    } catch (err) {
      console.warn('[PostgresPubSub] Falha ao publicar evento no Postgres:', err);
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
