import type { StoredMedia } from './wa-media-store';

/** Tipos que o navegador pode abrir sem transformar um documento em HTML ativo. */
export const RENDERABLE_MEDIA = /^(image|video|audio)\//;

export const contentDispositionFor = (mimeType: string, fileName?: string): string => {
  const mode = RENDERABLE_MEDIA.test(mimeType) ? 'inline' : 'attachment';
  return fileName ? `${mode}; filename*=UTF-8''${encodeURIComponent(fileName)}` : mode;
};

type ParsedRange =
  | { readonly kind: 'full' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number };

/**
 * Uma única faixa basta para vídeo e áudio. Faixas múltiplas cairiam em
 * `multipart/byteranges`, que não compra nada para estes consumidores; servir o
 * corpo completo preserva o comportamento anterior sem fabricar um MIME novo.
 */
const parseRange = (value: string | null, size: number): ParsedRange => {
  if (!value || value.includes(',')) return { kind: 'full' };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) return { kind: 'invalid' };

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if ((!startText && !endText) || size === 0) return { kind: 'invalid' };

  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'invalid' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'partial', start, end: Math.min(requestedEnd, size - 1) };
};

/** Resposta comum das URLs por mensagem e por conteúdo, inclusive `Range`. */
export const respondWithMedia = (
  request: Request,
  media: StoredMedia,
  headers: HeadersInit,
): Response => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Accept-Ranges', 'bytes');

  const range = parseRange(request.headers.get('range'), media.size);
  if (range.kind === 'invalid') {
    responseHeaders.delete('Content-Length');
    responseHeaders.set('Content-Range', `bytes */${media.size}`);
    return new Response(null, { status: 416, headers: responseHeaders });
  }

  if (range.kind === 'full') {
    responseHeaders.set('Content-Length', String(media.size));
    return new Response(media.stream(), { status: 200, headers: responseHeaders });
  }

  responseHeaders.set('Content-Length', String(range.end - range.start + 1));
  responseHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${media.size}`);
  return new Response(media.streamRange(range.start, range.end), {
    status: 206,
    headers: responseHeaders,
  });
};
