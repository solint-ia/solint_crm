import type { Id, IsoDateTime } from './shared';

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

/**
 * Uma reação (emoji) posta sobre uma mensagem.
 *
 * O WhatsApp permite **uma por pessoa**: reagir de novo troca o emoji, e reagir
 * com vazio remove. Por isso a identidade de quem reagiu (`actorId`) é o que
 * torna a lista consistente — não o emoji. Sem ela, a mesma pessoa trocando de
 * 👍 para ❤️ deixaria os dois na bolha, e a contagem passaria a medir cliques
 * em vez de pessoas.
 */
export interface MessageReaction {
  /** O emoji em si. Nunca vazio: reação vazia é remoção, e some da lista. */
  readonly emoji: string;
  /** Quem reagiu, do ponto de vista do atendimento. */
  readonly by: 'contact' | 'agent';
  /** Nome de exibição de quem reagiu, quando conhecido. */
  readonly authorName?: string;
  /**
   * Identidade estável de quem reagiu — telefone, JID, ou `me` para este
   * número. É a chave de substituição: uma reação nova do mesmo `actorId`
   * substitui a anterior em vez de somar.
   */
  readonly actorId: string;
  readonly at: IsoDateTime;
}

/** Agrupa as reações por emoji, na ordem em que cada emoji apareceu. */
export const groupReactions = (
  reactions: readonly MessageReaction[] | undefined,
): readonly { readonly emoji: string; readonly count: number; readonly mine: boolean; readonly names: readonly string[] }[] => {
  if (!reactions || reactions.length === 0) return [];
  const ordem: string[] = [];
  const mapa = new Map<string, { count: number; mine: boolean; names: string[] }>();

  for (const reaction of reactions) {
    let entrada = mapa.get(reaction.emoji);
    if (!entrada) {
      entrada = { count: 0, mine: false, names: [] };
      mapa.set(reaction.emoji, entrada);
      ordem.push(reaction.emoji);
    }
    entrada.count += 1;
    if (reaction.by === 'agent') entrada.mine = true;
    if (reaction.authorName) entrada.names.push(reaction.authorName);
  }

  return ordem.map((emoji) => {
    const entrada = mapa.get(emoji);
    return {
      emoji,
      count: entrada?.count ?? 0,
      mine: entrada?.mine ?? false,
      names: entrada?.names ?? [],
    };
  });
};

export interface Message {
  readonly id: Id;
  readonly conversationId: Id;
  readonly author: MessageAuthorKind;
  readonly authorName?: string;
  readonly content: MessageContent;
  /**
   * Rótulo de exibição ("14:32") gravado no momento da escrita.
   *
   * Prefira `createdAt` para mostrar a hora: rótulos escritos antes da correção
   * de fuso estão em UTC, e este campo não sabe de que dia é.
   */
  readonly time: string;
  /** Instante real do envio. Ausente apenas em mensagens otimistas da tela. */
  readonly createdAt?: IsoDateTime;
  readonly deliveryStatus?: DeliveryStatus;
  /** Nota interna: NUNCA é enviada ao canal externo (regra de negócio crítica). */
  readonly isPrivate: boolean;
  /** Id da mensagem citada por esta. Ver `quotedOf` para o resumo a exibir. */
  readonly replyToId?: Id;
  /**
   * Quando foi apagada.
   *
   * A mensagem continua na timeline, com o conteúdo trocado pelo aviso — é o
   * que o WhatsApp faz, e é o que preserva o sentido do que veio antes e
   * depois. Removê-la deixaria a conversa costurada de um jeito que nunca
   * aconteceu.
   */
  readonly deletedAt?: IsoDateTime;
  /** Identificador da mensagem no provedor externo (ex.: id da mensagem no WhatsApp). */
  readonly externalId?: string;
  readonly origin?: MessageOrigin;
  /** Reações recebidas. Ausente quando nenhuma foi posta. */
  readonly reactions?: readonly MessageReaction[];
  /**
   * JID de quem escreveu, quando a mensagem veio de um grupo.
   *
   * Fica no domínio porque é o que permite **responder com uma reação** a
   * mensagem de terceiro: a chave que o canal exige carrega o participante.
   */
  readonly senderJid?: string;
}

/** Uma mensagem apagada não mostra conteúdo, só o rastro de que existiu. */
export const isDeleted = (message: Message): boolean => Boolean(message.deletedAt);

/** Divisor de data renderizado entre grupos de mensagens. */
export interface MessageDayDivider {
  readonly kind: 'divider';
  readonly label: string;
}

export type TimelineItem =
  { readonly kind: 'message'; readonly message: Message } | MessageDayDivider;

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
  if (message.deletedAt) return '🚫 Mensagem apagada';
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
