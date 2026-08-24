import crypto from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

export const INSTANCE_ID = crypto.randomUUID();

const CHANNELS = {
  CONVERSATIONS: 'solint_conversation_events',
  STATUS: 'solint_whatsapp_status',
} as const;

type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export interface PubSubNotification<T = unknown> {
  readonly __originInstanceId: string;
  readonly data: T;
}

class PostgresPubSubManager {
  private listenerClient: pg.Client | null = null;
  private publisherClient: pg.Client | null = null;
  private isConnecting = false;
  private isPublisherConnecting = false;
  private retryTimeout: NodeJS.Timeout | null = null;
  private listeners: Map<ChannelName, Set<(data: unknown) => void>> = new Map();

  private getConnectionString(): string | undefined {
    return (
      process.env.DIRECT_URL ??
      process.env.WORKER_DATABASE_URL ??
      process.env.DATABASE_URL
    );
  }

  /**
   * Inicializa o cliente de escuta permanente (LISTEN) via porta de sessão 5432.
   */
  async startListening(): Promise<void> {
    if (this.listenerClient || this.isConnecting) return;

    const connectionString = this.getConnectionString();
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
          // Ignora eco originado pela própria instância para evitar eventos duplicados locais
          if (envelope.__originInstanceId === INSTANCE_ID) return;

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
      await client.query(`LISTEN ${CHANNELS.CONVERSATIONS}`);
      await client.query(`LISTEN ${CHANNELS.STATUS}`);

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
    const connectionString = this.getConnectionString();
    if (!connectionString) return;

    try {
      const envelope: PubSubNotification<T> = {
        __originInstanceId: INSTANCE_ID,
        data,
      };

      const payload = JSON.stringify(envelope);

      // Limite seguro do Postgres NOTIFY (8000 bytes). Se exceder 7500 bytes, remove campos volumosos.
      let safePayload = payload;
      if (Buffer.byteLength(safePayload, 'utf-8') > 7500) {
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

      // Se mesmo após a limpeza ainda exceder o limite do Postgres, aborta o broadcast NOTIFY silenciosamente
      if (Buffer.byteLength(safePayload, 'utf-8') > 7500) {
        return;
      }

      if (!this.publisherClient) {
        if (!this.isPublisherConnecting) {
          this.isPublisherConnecting = true;
          const client = new Client({ connectionString });
          await client.connect();
          this.publisherClient = client;
          this.isPublisherConnecting = false;

          client.on('error', () => {
            this.publisherClient = null;
          });
        }
      }

      if (this.publisherClient) {
        await this.publisherClient.query('SELECT pg_notify($1, $2)', [channel, safePayload]);
      }
    } catch (err) {
      console.warn('[PostgresPubSub] Falha ao publicar evento no Postgres:', err);
      // Se falhar o cliente publicador, reseta para recriar na próxima
      this.publisherClient = null;
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
