import { EventEmitter } from 'node:events';
import { CHANNELS, postgresPubSub } from '../db/postgres-pubsub';

export type WhatsAppConnectionStatus =
  'desconectado' | 'gerando_qr' | 'aguardando_leitura' | 'conectando' | 'conectado';

/** Usuario do CRM que pareou o número — vincula o canal ao perfil do site. */
export interface WhatsAppOwner {
  readonly userId: string;
  readonly userName: string;
  /** Conta em que as mensagens deste número são gravadas. */
  readonly accountId: string;
}

export interface WhatsAppStatusPayload {
  readonly status: WhatsAppConnectionStatus;
  readonly qr?: string;
  readonly phone?: string;
  /** Nome do perfil do WhatsApp conectado. */
  readonly name?: string;
  /** Foto do perfil do WhatsApp conectado. */
  readonly avatarUrl?: string;
  readonly owner?: WhatsAppOwner;
  readonly connectedAt?: string;
  readonly error?: string;
  readonly updatedAt: string;
}

export type ConversationEventType =
  | 'new_message'
  | 'new_conversation'
  /** Mudou algo da conversa sem mensagem nova (nome do grupo, foto, leitura). */
  | 'conversation_updated'
  /** Uma mensagem existente mudou (confirmação de entrega/leitura). */
  | 'message_updated';

export interface ConversationEventPayload {
  readonly type: ConversationEventType;
  /**
   * Conta a que o evento pertence.
   */
  readonly accountId: string;
  readonly conversationId: string;
  readonly inboxId?: string;
  readonly message?: unknown;
  readonly conversation?: unknown;
}

class WhatsAppEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);

    // Escuta eventos broadcasted por outras instâncias/workers via PostgreSQL LISTEN
    postgresPubSub.subscribe<ConversationEventPayload>(CHANNELS.CONVERSATIONS, (payload) => {
      this.emitLocal('conversation', payload);
    });

    postgresPubSub.subscribe<WhatsAppStatusPayload>(CHANNELS.STATUS, (payload) => {
      this.emitLocal('status', payload);
    });
  }

  /**
   * Emite o evento apenas para listeners conectados a esta instância local Node.
   */
  emitLocal(event: 'status' | 'conversation', payload: unknown) {
    this.emit(event, payload);
  }

  /**
   * Emite localmente e faz broadcast via PostgreSQL NOTIFY para todos os outros nós do cluster.
   */
  emitStatus(payload: WhatsAppStatusPayload) {
    this.emitLocal('status', payload);
    const remotePayload = payload.qr ? { ...payload, qr: undefined } : payload;
    postgresPubSub.publish(CHANNELS.STATUS, remotePayload).catch((err) => {
      console.warn('[WhatsAppEventBus] Falha ao publicar status no Postgres:', err);
    });
  }

  /**
   * Emite localmente e faz broadcast via PostgreSQL NOTIFY para todos os outros nós do cluster.
   */
  emitConversation(payload: ConversationEventPayload) {
    this.emitLocal('conversation', payload);
    postgresPubSub.publish(CHANNELS.CONVERSATIONS, payload).catch((err) => {
      console.warn('[WhatsAppEventBus] Falha ao publicar conversa no Postgres:', err);
    });
  }
}

const globalRef = globalThis as typeof globalThis & { __solintWaEventBus?: WhatsAppEventBus };

export const waEventBus: WhatsAppEventBus = globalRef.__solintWaEventBus ?? new WhatsAppEventBus();

if (process.env.NODE_ENV !== 'production') {
  globalRef.__solintWaEventBus = waEventBus;
}

