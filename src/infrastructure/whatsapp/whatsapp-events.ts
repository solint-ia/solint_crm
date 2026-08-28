import { EventEmitter } from 'node:events';
import { CHANNELS, postgresPubSub } from '../db/postgres-pubsub';
import { waLog } from './wa-log';

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
  /**
   * Caixa de entrada a que este status pertence.
   *
   * Opcional porque o servico in-process mantem uma sessao so e nao precisa se
   * identificar. O worker mantem varias ao mesmo tempo, e sem este campo todos
   * os status caiam no mesmo barramento sem dizer de quem eram: a tela de uma
   * caixa mostrava o QR — ou o "conectado" — de outra.
   */
  readonly inboxId?: string;
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
  | 'message_updated'
  /**
   * O contato começou ou parou de escrever.
   *
   * Não toca no banco de propósito: "digitando" vale por alguns segundos e some
   * sozinho. Gravá-lo faria toda tecla do contato virar uma escrita — e, pior,
   * um estado que sobrevive ao recarregamento da página descrevendo algo que
   * terminou há muito tempo.
   */
  | 'typing';

export interface ConversationEventPayload {
  readonly type: ConversationEventType;
  /**
   * Conta a que o evento pertence.
   */
  readonly accountId: string;
  readonly conversationId: string;
  readonly inboxId?: string;
  /**
   * Qual mensagem mudou.
   *
   * É o que permite reidratar o evento do outro lado do `NOTIFY`, onde o objeto
   * da mensagem não cabe. Sem este campo, um evento que atravessa processos
   * chegava sabendo que *algo* mudou na conversa, mas não o quê.
   */
  readonly messageId?: string;
  readonly message?: unknown;
  readonly conversation?: unknown;
  /** Só em `type: 'typing'`: se o contato está escrevendo agora. */
  readonly isTyping?: boolean;
}

/**
 * O que atravessa o `NOTIFY`.
 *
 * **Só identificadores, nunca o conteúdo.** O `pg_notify` tem teto de 8000
 * bytes e o publicador cortava campos em silêncio para caber: uma conversa com
 * trinta mensagens já passava de 7.500 bytes, e o evento chegava do outro lado
 * sem `message` nem `conversation`. O cliente, que precisa de um dos dois para
 * saber o que fazer, descartava o evento sem erro nenhum — e o resultado era
 * mensagem que só aparecia depois de recarregar a página.
 *
 * Mandando só os ids, o payload é sempre pequeno e o processo que recebe vai ao
 * banco buscar o resto. A leitura acontece onde o leitor está, que é onde ela
 * deveria acontecer desde o início.
 */
/**
 * Garante que o evento diga de qual caixa é.
 *
 * O `inboxId` deixou de ser informação decorativa: é por ele que a rota de SSE
 * decide se este evento pode chegar a quem está com a tela aberta — uma pessoa
 * que atende só a Recepção não pode ver aparecer, ao vivo, uma conversa da
 * Cobrança. Vários emissores não o preenchiam por não precisarem dele antes.
 *
 * Normalizar aqui, e não em cada emissor, é o que impede que o próximo lugar a
 * publicar um evento reabra o vazamento por esquecimento. Quando o payload traz
 * a conversa, a caixa está lá dentro; quando não traz nem uma coisa nem outra,
 * o evento segue sem `inboxId` e é o consumidor que recusa.
 */
const withInboxId = (payload: ConversationEventPayload): ConversationEventPayload => {
  if (payload.inboxId) return payload;
  const inboxId = (payload.conversation as { inboxId?: string } | undefined)?.inboxId;
  return inboxId ? { ...payload, inboxId } : payload;
};

const thin = (payload: ConversationEventPayload) => ({
  type: payload.type,
  accountId: payload.accountId,
  conversationId: payload.conversationId,
  ...(payload.inboxId ? { inboxId: payload.inboxId } : {}),
  ...(payload.messageId ? { messageId: payload.messageId } : {}),
  // `isTyping` é o evento inteiro, não um enfeite dele: sem este campo o
  // "digitando" atravessaria o `NOTIFY` sem dizer se começou ou parou.
  ...(payload.type === 'typing' ? { isTyping: payload.isTyping === true } : {}),
});

class WhatsAppEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);

    // Escuta eventos broadcasted por outras instâncias/workers via PostgreSQL LISTEN
    postgresPubSub.subscribe<ConversationEventPayload>(CHANNELS.CONVERSATIONS, (payload) => {
      void this.receiveConversation(payload);
    });

    postgresPubSub.subscribe<WhatsAppStatusPayload>(CHANNELS.STATUS, (payload) => {
      this.emitLocal('status', payload);
    });
  }

  /**
   * Recebe um evento vindo de outro processo e o completa antes de repassar.
   *
   * O worker publica só os ids; quem tem ouvintes de verdade é o processo do
   * site, e é ele quem carrega a conversa. Processos sem ouvinte — o próprio
   * worker, por exemplo — repassam o evento cru e não gastam uma consulta para
   * ninguém.
   *
   * O import é dinâmico porque `wa-store` importa este módulo: estático, o ciclo
   * se fecharia na avaliação e um dos dois lados veria `undefined`.
   */
  private async receiveConversation(payload: ConversationEventPayload): Promise<void> {
    if (this.listenerCount('conversation') === 0) return;

    // "Digitando" já está inteiro no payload: ir ao banco buscar a conversa
    // custaria uma consulta por tecla do contato para não acrescentar nada.
    if (payload.conversation || payload.message || payload.type === 'typing') {
      this.emitLocal('conversation', payload);
      return;
    }

    try {
      const { loadConversationForEvent } = await import('./wa-store');
      const conversation = await loadConversationForEvent(payload.accountId, payload.conversationId);

      if (!conversation) {
        this.emitLocal('conversation', payload);
        return;
      }

      const item = payload.messageId
        ? conversation.timeline.find(
            (entry) => entry.kind === 'message' && entry.message.id === payload.messageId,
          )
        : undefined;

      this.emitLocal('conversation', {
        ...payload,
        conversation,
        ...(item?.kind === 'message' ? { message: item.message } : {}),
      });
    } catch (err) {
      waLog.warn('[WhatsAppEventBus] Falha ao reidratar evento de conversa:', err);
      this.emitLocal('conversation', payload);
    }
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
    // O QR vai junto. Ele era removido porque, como data URL, estourava o teto
    // de 8000 bytes do `pg_notify` — e sem ele nenhuma outra instância (nem o
    // worker) conseguia exibir o código de pareamento. Cru, ocupa ~230 bytes e
    // a imagem passa a ser gerada na borda; ver `qr-image.ts`.
    postgresPubSub.publish(CHANNELS.STATUS, payload).catch((err) => {
      console.warn('[WhatsAppEventBus] Falha ao publicar status no Postgres:', err);
    });
  }

  /**
   * Emite localmente com tudo, e para fora só com os identificadores.
   *
   * Quem está neste processo recebe o objeto completo de graça — já está na
   * memória. Quem está em outro recebe os ids e busca o resto: é a única forma
   * de o evento caber no `NOTIFY` sem depender do tamanho da conversa.
   */
  emitConversation(payload: ConversationEventPayload) {
    const completo = withInboxId(payload);
    this.emitLocal('conversation', completo);
    postgresPubSub.publish(CHANNELS.CONVERSATIONS, thin(completo)).catch((err) => {
      console.warn('[WhatsAppEventBus] Falha ao publicar conversa no Postgres:', err);
    });
  }
}

const globalRef = globalThis as typeof globalThis & { __solintWaEventBus?: WhatsAppEventBus };

export const waEventBus: WhatsAppEventBus = globalRef.__solintWaEventBus ?? new WhatsAppEventBus();

if (process.env.NODE_ENV !== 'production') {
  globalRef.__solintWaEventBus = waEventBus;
}
