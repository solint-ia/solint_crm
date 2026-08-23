import { EventEmitter } from 'node:events';

export type WhatsAppConnectionStatus =
  | 'desconectado'
  | 'gerando_qr'
  | 'aguardando_leitura'
  | 'conectando'
  | 'conectado';

/** Usuario do CRM que pareou o número — vincula o canal ao perfil do site. */
export interface WhatsAppOwner {
  readonly userId: string;
  readonly userName: string;
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
  readonly conversationId: string;
  readonly message?: unknown;
  readonly conversation?: unknown;
}

class WhatsAppEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitStatus(payload: WhatsAppStatusPayload) {
    this.emit('status', payload);
  }

  emitConversation(payload: ConversationEventPayload) {
    this.emit('conversation', payload);
  }
}

const globalRef = globalThis as typeof globalThis & { __solintWaEventBus?: WhatsAppEventBus };

export const waEventBus: WhatsAppEventBus =
  globalRef.__solintWaEventBus ?? new WhatsAppEventBus();

if (process.env.NODE_ENV !== 'production') {
  globalRef.__solintWaEventBus = waEventBus;
}
