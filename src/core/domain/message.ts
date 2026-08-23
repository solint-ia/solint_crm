import type { Id } from './shared';

export type MessageAuthorKind = 'contact' | 'agent' | 'ai' | 'system';

/**
 * De onde a mensagem saiu.
 * `crm` = digitada nesta plataforma; `canal` = enviada direto pelo celular/app do canal.
 * Distinguir os dois evita atribuir ao agente logado algo que ele não escreveu.
 */
export type MessageOrigin = 'crm' | 'canal';

export type DeliveryStatus = 'enviando' | 'enviado' | 'entregue' | 'lido' | 'falha';

export type MessageContent =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'audio';
      readonly duration: string;
      readonly transcript?: string;
      /** Origem reproduzivel do áudio. Ausente quando a midia não pode ser obtida. */
      readonly url?: string;
      readonly mimeType?: string;
      /** Mensagem de voz gravada na hora (push-to-talk), não um arquivo de musica. */
      readonly voice?: boolean;
    }
  | { readonly type: 'image'; readonly url: string; readonly caption?: string }
  | {
      readonly type: 'video';
      readonly url: string;
      readonly caption?: string;
      readonly mimeType?: string;
      /** GIF do WhatsApp: e um video curto sem som, exibido em laco. */
      readonly gif?: boolean;
    }
  | { readonly type: 'sticker'; readonly url: string; readonly animated?: boolean }
  | {
      readonly type: 'document';
      readonly fileName: string;
      readonly size: string;
      readonly url?: string;
    }
  | { readonly type: 'template'; readonly templateName: string; readonly text: string }
  | { readonly type: 'system'; readonly text: string };

export interface Message {
  readonly id: Id;
  readonly conversationId: Id;
  readonly author: MessageAuthorKind;
  readonly authorName?: string;
  readonly content: MessageContent;
  readonly time: string;
  readonly deliveryStatus?: DeliveryStatus;
  /** Nota interna: NUNCA é enviada ao canal externo (regra de negócio crítica). */
  readonly isPrivate: boolean;
  readonly replyToId?: Id;
  /** Identificador da mensagem no provedor externo (ex.: id da mensagem no WhatsApp). */
  readonly externalId?: string;
  readonly origin?: MessageOrigin;
}

/** Divisor de data renderizado entre grupos de mensagens. */
export interface MessageDayDivider {
  readonly kind: 'divider';
  readonly label: string;
}

export type TimelineItem = { readonly kind: 'message'; readonly message: Message } | MessageDayDivider;

/** Uma nota interna nunca pode ter status de entrega em canal externo. */
export const isDeliverable = (message: Message): boolean => !message.isPrivate;

/**
 * Resumo de uma linha para a lista de conversas, o toast e a busca.
 *
 * Vive no domínio porque a regra é a mesma em todos os lugares: uma foto sem
 * legenda precisa dizer "Foto", senão a conversa aparece vazia na lista e o
 * operador acha que nada chegou.
 */
export const previewOfMessage = (message: Message): string => {
  const content = message.content;
  switch (content.type) {
    case 'text':
    case 'template':
    case 'system':
      return content.text;
    case 'audio':
      return content.voice ? '🎤 Áudio' : '🎵 Áudio';
    case 'image':
      return content.caption ? `📷 ${content.caption}` : '📷 Foto';
    case 'video': {
      const label = content.gif ? '🎞️ GIF' : '🎬 Vídeo';
      return content.caption ? `${label} · ${content.caption}` : label;
    }
    case 'sticker':
      return '🩹 Figurinha';
    case 'document':
      return `📎 ${content.fileName}`;
  }
};
