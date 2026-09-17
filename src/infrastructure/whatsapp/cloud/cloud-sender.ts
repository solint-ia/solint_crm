import type { DispatchQuote, DispatchTarget } from '../channel';
import { VOICE_NOTE_MIME, converterParaNotaDeVoz, precisaConverterAudio } from '../wa-audio';
import type { CloudConnection } from './cloud-connection';
import { CloudApiError, graphRequest } from './graph-client';

/**
 * As chamadas de envio da API oficial.
 *
 * Funções soltas, sem estado, recebendo a conexão: o canal do site e o
 * consumidor de comandos do worker usam as mesmas, e a diferença entre os dois
 * fica só em quem carimba o resultado.
 */

/** Prefixo do `channelThreadId` de contato que chegou só com BSUID, sem telefone. */
export const BSUID_THREAD_PREFIX = 'bsuid:';

/**
 * Para quem a mensagem vai, no formato da Meta.
 *
 * Com telefone, `to`. Sem telefone (cliente que chegou por nome de usuário),
 * `recipient` com o BSUID. Grupo não existe na API oficial, e a recusa vem aqui
 * com uma frase que o atendente entende, em vez de um erro 100 da Meta.
 */
export const recipientOf = (
  target: DispatchTarget,
): { readonly to: string } | { readonly recipient: string } => {
  const thread = target.channelThreadId?.trim();
  if (thread?.startsWith(BSUID_THREAD_PREFIX)) {
    return { recipient: thread.slice(BSUID_THREAD_PREFIX.length) };
  }
  if (thread?.endsWith('@g.us')) {
    throw new CloudApiError({ message: 'Grupos não são suportados pela API oficial do WhatsApp.' });
  }
  const fromThread = thread && thread.includes('@') ? thread.split('@')[0] : undefined;
  const digits = (fromThread ?? target.phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) {
    throw new CloudApiError({ message: 'Conversa sem número de destino para a API oficial.' });
  }
  return { to: digits };
};

interface SendResponse {
  readonly messages?: readonly { readonly id?: string }[];
}

const wamidOf = (resposta: SendResponse): string => {
  const id = resposta.messages?.[0]?.id;
  if (!id) throw new CloudApiError({ message: 'A Meta aceitou o envio, mas não devolveu o id.' });
  return id;
};

const postMessage = async (
  conn: CloudConnection,
  corpo: Record<string, unknown>,
): Promise<string> =>
  wamidOf(
    await graphRequest<SendResponse>({
      path: `${conn.phoneNumberId}/messages`,
      token: conn.token,
      json: { messaging_product: 'whatsapp', ...corpo },
    }),
  );

const contextOf = (quote: DispatchQuote | undefined) =>
  quote?.externalId ? { context: { message_id: quote.externalId } } : {};

export const sendCloudText = (
  conn: CloudConnection,
  target: DispatchTarget,
  text: string,
  quote?: DispatchQuote,
): Promise<string> =>
  postMessage(conn, {
    recipient_type: 'individual',
    ...recipientOf(target),
    ...contextOf(quote),
    type: 'text',
    text: { body: text, preview_url: false },
  });

/** Limites de arquivo da Cloud API, por tipo. */
export const CLOUD_MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  sticker: 500 * 1024,
} as const;

const IMAGENS_ACEITAS = new Set(['image/jpeg', 'image/png']);
const VIDEOS_ACEITOS = new Set(['video/mp4', 'video/3gpp']);
const baseMime = (mime: string): string => (mime.split(';')[0] ?? '').trim().toLowerCase();

export interface CloudOutboundMedia {
  readonly kind: 'image' | 'video' | 'audio' | 'document';
  readonly data: Buffer;
  readonly mimeType: string;
  readonly fileName?: string;
  readonly caption?: string;
  readonly voice?: boolean;
}

/**
 * Ajusta o anexo ao que a Meta aceita, sem recusar o que dá para mandar.
 *
 * Imagem acima de 5 MB, ou num formato que a Meta não mostra como foto (WebP,
 * GIF), vai como documento: o cliente recebe o arquivo em vez de a mensagem
 * falhar. Áudio que não é MP3/M4A/AAC/OGG passa pela mesma conversão para Opus
 * que o QR Code já usa.
 */
export const adaptCloudMedia = async (
  media: CloudOutboundMedia,
): Promise<{
  readonly kind: CloudOutboundMedia['kind'];
  readonly data: Buffer;
  readonly mimeType: string;
  readonly fileName?: string;
  readonly caption?: string;
}> => {
  const mime = baseMime(media.mimeType);

  if (media.kind === 'image') {
    if (media.data.length <= CLOUD_MEDIA_LIMITS.image && IMAGENS_ACEITAS.has(mime)) {
      return { ...media, mimeType: mime };
    }
    return {
      kind: 'document',
      data: media.data,
      mimeType: mime || 'application/octet-stream',
      fileName: media.fileName ?? `imagem.${mime.split('/')[1] ?? 'bin'}`,
      ...(media.caption ? { caption: media.caption } : {}),
    };
  }

  if (media.kind === 'video') {
    if (media.data.length > CLOUD_MEDIA_LIMITS.video || !VIDEOS_ACEITOS.has(mime)) {
      return {
        kind: 'document',
        data: media.data,
        mimeType: mime || 'application/octet-stream',
        fileName: media.fileName ?? 'video.mp4',
        ...(media.caption ? { caption: media.caption } : {}),
      };
    }
    return { ...media, mimeType: mime };
  }

  if (media.kind === 'audio') {
    if (precisaConverterAudio(media.mimeType, Boolean(media.voice))) {
      const nota = await converterParaNotaDeVoz(media.data);
      return { kind: 'audio', data: nota.data, mimeType: baseMime(VOICE_NOTE_MIME) };
    }
    return { kind: 'audio', data: media.data, mimeType: mime };
  }

  if (media.data.length > CLOUD_MEDIA_LIMITS.document) {
    throw new CloudApiError({ message: 'Arquivo maior que 100 MB, o limite da API oficial.' });
  }
  return { ...media, mimeType: mime || 'application/octet-stream' };
};

/** Sobe os bytes para a Meta e devolve o id de mídia, válido por 30 dias. */
export const uploadCloudMedia = async (
  conn: CloudConnection,
  data: Buffer,
  mimeType: string,
  fileName?: string,
): Promise<string> => {
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', mimeType);
  form.set(
    'file',
    new Blob([new Uint8Array(data)], { type: mimeType }),
    fileName ?? `arquivo.${mimeType.split('/')[1] ?? 'bin'}`,
  );
  const resposta = await graphRequest<{ readonly id?: string }>({
    path: `${conn.phoneNumberId}/media`,
    token: conn.token,
    form,
    timeoutMs: 60_000,
  });
  if (!resposta.id) throw new CloudApiError({ message: 'A Meta não devolveu o id da mídia.' });
  return resposta.id;
};

export const sendCloudMedia = async (
  conn: CloudConnection,
  target: DispatchTarget,
  media: CloudOutboundMedia,
  quote?: DispatchQuote,
): Promise<string> => {
  const destino = recipientOf(target);
  const pronto = await adaptCloudMedia(media);
  const mediaId = await uploadCloudMedia(conn, pronto.data, pronto.mimeType, pronto.fileName);

  const objeto: Record<string, unknown> = { id: mediaId };
  if (pronto.caption && pronto.kind !== 'audio') objeto['caption'] = pronto.caption;
  if (pronto.kind === 'document') objeto['filename'] = pronto.fileName ?? 'documento';

  return postMessage(conn, {
    recipient_type: 'individual',
    ...destino,
    ...contextOf(quote),
    type: pronto.kind,
    [pronto.kind]: objeto,
  });
};

export const sendCloudReaction = (
  conn: CloudConnection,
  target: DispatchTarget,
  messageExternalId: string,
  emoji: string,
): Promise<string> =>
  postMessage(conn, {
    recipient_type: 'individual',
    ...recipientOf(target),
    type: 'reaction',
    // Emoji vazio retira a reação, como no aplicativo.
    reaction: { message_id: messageExternalId, emoji },
  });

/** Marca como lida a mensagem e todas as anteriores da conversa. */
export const markCloudRead = async (conn: CloudConnection, wamid: string): Promise<void> => {
  await graphRequest({
    path: `${conn.phoneNumberId}/messages`,
    token: conn.token,
    json: { messaging_product: 'whatsapp', status: 'read', message_id: wamid },
  });
};

/**
 * "Digitando…" na API oficial.
 *
 * Ela só existe ligada a uma mensagem recebida, marca essa mensagem como lida e
 * some sozinha depois de ~25 s ou quando a empresa responde.
 */
export const sendCloudTyping = async (conn: CloudConnection, wamid: string): Promise<void> => {
  await graphRequest({
    path: `${conn.phoneNumberId}/messages`,
    token: conn.token,
    json: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
      typing_indicator: { type: 'text' },
    },
  });
};

export interface CloudTemplateMessage {
  readonly name: string;
  readonly language: string;
  /** Valores das variáveis do corpo, na ordem `{{1}}`, `{{2}}`… */
  readonly bodyValues: readonly string[];
  /** Variável do cabeçalho de texto, quando o template tiver uma. */
  readonly headerValue?: string;
}

export const sendCloudTemplate = (
  conn: CloudConnection,
  target: DispatchTarget,
  template: CloudTemplateMessage,
): Promise<string> => {
  const components: Record<string, unknown>[] = [];
  if (template.headerValue) {
    components.push({ type: 'header', parameters: [{ type: 'text', text: template.headerValue }] });
  }
  if (template.bodyValues.length > 0) {
    components.push({
      type: 'body',
      parameters: template.bodyValues.map((text) => ({ type: 'text', text })),
    });
  }
  return postMessage(conn, {
    recipient_type: 'individual',
    ...recipientOf(target),
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      ...(components.length > 0 ? { components } : {}),
    },
  });
};
