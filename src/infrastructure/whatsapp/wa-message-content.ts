import {
  proto,
  WAMessageStatus,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
} from '@whiskeysockets/baileys';

import type { DeliveryStatus, MessageContent } from '@/core/domain/message';

/**
 * A mensagem foi apagada "para todos"?
 *
 * O WhatsApp não manda um evento próprio para isso: manda uma mensagem nova
 * cujo conteúdo é um `protocolMessage` do tipo `REVOKE`, carregando a chave da
 * mensagem original. `decodeWaMessage` devolve `null` para `protocolMessage`
 * (não é conteúdo de conversa), então esta checagem precisa vir **antes** dele.
 *
 * Devolve o id da mensagem revogada no canal, ou `undefined` quando não é um
 * revoke.
 */
export const revokedMessageId = (raw: WAMessage): string | undefined => {
  // `normalizeMessageContent` desembrulha `ephemeralMessage`/`viewOnceMessage`:
  // num chat com mensagens temporárias o `protocolMessage` chega aninhado, e
  // ler `raw.message.protocolMessage` direto perderia o revoke ali.
  const protocolo = normalizeMessageContent(raw.message)?.protocolMessage;
  if (!protocolo || protocolo.type !== proto.Message.ProtocolMessage.Type.REVOKE) {
    return undefined;
  }
  return protocolo.key?.id ?? undefined;
};

/**
 * Traducao do payload bruto do WhatsApp para o modelo de mensagem do dominio.
 *
 * Uma mensagem sem texto (foto, figurinha, localizacao) tambem e uma mensagem:
 * descarta-la faria a conversa "pular" e o preview mentir. Por isso todo tipo
 * suportado recebe ao menos um resumo legivel — e, quando ha midia, uma
 * descrição do que precisa ser baixado para exibi-la de fato.
 */

export type MediaKind = 'image' | 'video' | 'sticker' | 'audio' | 'document';

export interface MediaRef {
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly fileLength: number;
  readonly caption?: string;
  readonly fileName?: string;
  /** Áudio: duracao formatada. */
  readonly duration?: string;
  /** Áudio gravado na hora (push-to-talk). */
  readonly voice?: boolean;
  /** Video sem som exibido em laco — o "GIF" do WhatsApp. */
  readonly gif?: boolean;
  readonly animated?: boolean;
  /** Tamanho legivel, usado no fallback quando o download falha. */
  readonly sizeLabel: string;
}

export interface DecodedMessage {
  /** Conteudo valido mesmo sem midia — vira o fallback se o download falhar. */
  readonly content: MessageContent;
  /** Resumo curto para a lista de conversas. */
  readonly preview: string;
  readonly media?: MediaRef;
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
};

const formatDuration = (seconds: number): string => {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};

const asText = (text: string): DecodedMessage => ({
  content: { type: 'text', text },
  preview: text,
});

/** Anexo sem texto proprio: o rotulo vira o corpo da mensagem e o preview. */
const asAttachmentText = (label: string, caption?: string | null): DecodedMessage => {
  const text = caption?.trim() ? `${label} · ${caption.trim()}` : label;
  return { content: { type: 'text', text }, preview: text };
};

/**
 * Decodifica o conteúdo. Retorna `null` para eventos que não são mensagens de
 * conversa (edicoes de protocolo, reacoes, atualizacoes de enquete, chaves).
 */
export const decodeWaMessage = (raw: WAMessage): DecodedMessage | null => {
  const message: WAMessageContent | undefined = normalizeMessageContent(raw.message);
  if (!message) return null;

  if (message.conversation) return asText(message.conversation);

  if (message.extendedTextMessage?.text) return asText(message.extendedTextMessage.text);

  if (message.imageMessage) {
    const caption = message.imageMessage.caption?.trim() || undefined;
    const fallback = asAttachmentText('📷 Foto', caption);
    return {
      ...fallback,
      preview: caption ? `📷 ${caption}` : '📷 Foto',
      media: {
        kind: 'image',
        mimeType: message.imageMessage.mimetype ?? 'image/jpeg',
        fileLength: Number(message.imageMessage.fileLength ?? 0),
        sizeLabel: formatBytes(Number(message.imageMessage.fileLength ?? 0)),
        caption,
      },
    };
  }

  if (message.videoMessage) {
    const gif = Boolean(message.videoMessage.gifPlayback);
    const caption = message.videoMessage.caption?.trim() || undefined;
    const label = gif ? '🎞️ GIF' : '🎬 Vídeo';
    return {
      ...asAttachmentText(label, caption),
      preview: caption ? `${label} · ${caption}` : label,
      media: {
        kind: 'video',
        mimeType: message.videoMessage.mimetype ?? 'video/mp4',
        fileLength: Number(message.videoMessage.fileLength ?? 0),
        sizeLabel: formatBytes(Number(message.videoMessage.fileLength ?? 0)),
        caption,
        gif,
      },
    };
  }

  if (message.audioMessage) {
    const duration = formatDuration(Number(message.audioMessage.seconds ?? 0));
    const voice = Boolean(message.audioMessage.ptt);
    return {
      content: { type: 'audio', duration, voice },
      preview: voice ? '🎤 Áudio' : '🎵 Áudio',
      media: {
        kind: 'audio',
        mimeType: message.audioMessage.mimetype ?? 'audio/ogg',
        fileLength: Number(message.audioMessage.fileLength ?? 0),
        sizeLabel: formatBytes(Number(message.audioMessage.fileLength ?? 0)),
        duration,
        voice,
      },
    };
  }

  if (message.documentMessage) {
    const fileName = message.documentMessage.fileName?.trim() || 'documento';
    const size = formatBytes(Number(message.documentMessage.fileLength ?? 0));
    return {
      content: { type: 'document', fileName, size },
      preview: `📎 ${fileName}`,
      media: {
        kind: 'document',
        mimeType: message.documentMessage.mimetype ?? 'application/octet-stream',
        fileLength: Number(message.documentMessage.fileLength ?? 0),
        sizeLabel: size,
        fileName,
      },
    };
  }

  if (message.stickerMessage) {
    return {
      ...asAttachmentText('🩹 Figurinha'),
      media: {
        kind: 'sticker',
        mimeType: message.stickerMessage.mimetype ?? 'image/webp',
        fileLength: Number(message.stickerMessage.fileLength ?? 0),
        sizeLabel: formatBytes(Number(message.stickerMessage.fileLength ?? 0)),
        animated: Boolean(message.stickerMessage.isAnimated),
      },
    };
  }

  if (message.locationMessage || message.liveLocationMessage) {
    return asAttachmentText('📍 Localização', message.locationMessage?.name);
  }

  if (message.contactMessage) {
    return asAttachmentText('👤 Contato', message.contactMessage.displayName);
  }

  if (message.contactsArrayMessage) {
    const total = message.contactsArrayMessage.contacts?.length ?? 0;
    return asAttachmentText(`👥 ${total} contatos compartilhados`);
  }

  if (message.pollCreationMessage || message.pollCreationMessageV3) {
    const name =
      message.pollCreationMessage?.name ?? message.pollCreationMessageV3?.name ?? undefined;
    return asAttachmentText('📊 Enquete', name);
  }

  const buttonReply =
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.templateButtonReplyMessage?.selectedDisplayText ??
    message.listResponseMessage?.title;
  if (buttonReply) return asText(buttonReply);

  // protocolMessage, reactionMessage, pollUpdateMessage, senderKeyDistributionMessage etc.
  return null;
};

/** Conteudo definitivo depois que a midia foi decifrada e ficou disponível. */
export const mediaContent = (media: MediaRef, url: string): MessageContent => {
  switch (media.kind) {
    case 'image':
      return { type: 'image', url, caption: media.caption };
    case 'video':
      return {
        type: 'video',
        url,
        caption: media.caption,
        mimeType: media.mimeType,
        gif: media.gif,
      };
    case 'sticker':
      return { type: 'sticker', url, animated: media.animated };
    case 'audio':
      return {
        type: 'audio',
        duration: media.duration ?? '0:00',
        url,
        mimeType: media.mimeType,
        voice: media.voice,
      };
    case 'document':
      return {
        type: 'document',
        fileName: media.fileName ?? 'documento',
        size: media.sizeLabel,
        url,
      };
  }
};

/** `proto.WebMessageInfo.Status` -> status de entrega do dominio. */
export const deliveryStatusFrom = (
  status: number | null | undefined,
): DeliveryStatus | undefined => {
  switch (status) {
    case WAMessageStatus.ERROR:
      return 'falha';
    case WAMessageStatus.PENDING:
      return 'enviando';
    case WAMessageStatus.SERVER_ACK:
      return 'enviado';
    case WAMessageStatus.DELIVERY_ACK:
      return 'entregue';
    case WAMessageStatus.READ:
    case WAMessageStatus.PLAYED:
      return 'lido';
    default:
      return undefined;
  }
};

/** Timestamp da mensagem em ms; cai para "agora" quando o servidor não envia. */
export const timestampOf = (raw: WAMessage): number => {
  const seconds = Number(raw.messageTimestamp ?? 0);
  return seconds > 0 ? seconds * 1000 : Date.now();
};

/**
 * Contexto do anúncio que originou a conversa (Click-to-WhatsApp).
 *
 * Quando alguém clica num anúncio do Instagram ou do Facebook e cai no
 * WhatsApp, a primeira mensagem carrega este bloco junto: o título e o texto do
 * anúncio, e um identificador do clique. É a diferença entre um fluxo de
 * automação perguntar "como posso ajudar?" e já responder sobre o produto que a
 * pessoa estava olhando trinta segundos antes.
 *
 * O dado vem do WhatsApp e morria aqui: nada no CRM o lia, então ele não
 * chegava nem à conversa nem a quem integra por webhook.
 */
export interface AdContext {
  readonly titulo: string;
  readonly conteudo: string;
  /** Identificador do clique no anúncio (`ctwaClid`), quando o WhatsApp envia. */
  readonly clickId?: string;
  readonly link?: string;
}

/**
 * O corpo do anúncio vem com a chamada para ação colada no fim.
 *
 * O WhatsApp repete ali o próprio número e o link do anúncio, que não dizem
 * nada sobre o interesse da pessoa e só atrapalham quem for usar o texto como
 * contexto — inclusive um modelo de linguagem, que trata a sobra como parte da
 * mensagem.
 */
const limparConteudo = (bruto: string): string =>
  bruto
    .replace(/WhatsApp:.*$/gim, '')
    .replace(/Link:.*$/gim, '')
    .replace(/https?:\/\/\S+/gim, '')
    .trim();

/**
 * Extrai o contexto do anúncio, se a mensagem veio de um clique.
 *
 * Os três caminhos existem porque o bloco muda de lugar conforme o tipo da
 * mensagem: no topo em algumas versões, dentro do texto estendido quando a
 * pessoa escreveu, dentro da imagem quando ela mandou foto. Procurar num só
 * perderia os outros dois silenciosamente.
 */
export const adContextOf = (raw: WAMessage): AdContext | undefined => {
  const message = raw.message;

  const adReply =
    message?.extendedTextMessage?.contextInfo?.externalAdReply ??
    message?.imageMessage?.contextInfo?.externalAdReply ??
    message?.videoMessage?.contextInfo?.externalAdReply;

  if (!adReply) return undefined;

  const titulo = adReply.title?.trim() || '';
  const conteudo = limparConteudo(adReply.body ?? '');
  const clickId = adReply.ctwaClid?.trim() || adReply.sourceId?.trim() || '';
  const link = adReply.sourceUrl?.trim() || '';

  // Um bloco existente mas inteiramente vazio não é contexto — é ruído do
  // protocolo, e entregá-lo faria o outro lado tratar como clique de anúncio
  // uma conversa que não veio de nenhum.
  if (!titulo && !conteudo && !clickId) return undefined;

  return {
    titulo,
    conteudo,
    ...(clickId ? { clickId } : {}),
    ...(link ? { link } : {}),
  };
};

/**
 * Os JIDs que a mensagem cita com `@`.
 *
 * **Por que o corpo da mensagem mostra um número comprido.** O WhatsApp não
 * escreve o nome de quem foi citado dentro do texto: escreve `@` seguido da
 * parte de usuário do JID, e manda a lista de JIDs à parte, no `contextInfo`.
 * Casar as duas coisas é trabalho de quem exibe — o aplicativo faz isso, e nós
 * não fazíamos.
 *
 * Enquanto o identificador era o telefone, o estrago era pequeno: aparecia
 * `@5579998…`, feio mas reconhecível. A partir do Baileys 7 as conversas
 * migram para LID (`@lid`), e aí o que sobra no texto é um identificador
 * interno sem significado nenhum — o `@94716930600979` que aparecia na tela.
 *
 * A varredura é por valor, e não uma lista de tipos: `contextInfo` existe em
 * todo tipo que aceita legenda, e uma lista fixa perderia em silêncio o
 * próximo tipo que o WhatsApp inventar.
 */
export const mentionedJidsOf = (raw: WAMessage): readonly string[] => {
  // `normalizeMessageContent` desembrulha `ephemeralMessage`/`viewOnceMessage`
  // pelo mesmo motivo de `revokedMessageId`: num chat com mensagens temporárias
  // o conteúdo real chega aninhado.
  const message = normalizeMessageContent(raw.message);
  if (!message) return [];

  const jids = new Set<string>();
  for (const conteudo of Object.values(message)) {
    const citados = (conteudo as { contextInfo?: { mentionedJid?: string[] | null } } | null)
      ?.contextInfo?.mentionedJid;
    for (const jid of citados ?? []) {
      if (jid) jids.add(jid);
    }
  }

  return [...jids];
};
