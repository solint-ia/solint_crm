import { NextResponse } from 'next/server';

import { sessionFromApiToken } from '@/infrastructure/auth/api-token';
import { container } from '@/infrastructure/container';
import { contentDispositionFor, respondWithMedia } from '@/infrastructure/whatsapp/media-response';
import { isSafeMediaId, mediaStore } from '@/infrastructure/whatsapp/wa-media-store';

export const dynamic = 'force-dynamic';

/** Serve o objeto canônico que várias mensagens da mesma conta compartilham. */
export async function GET(request: Request, { params }: { params: Promise<{ blobId: string }> }) {
  const { blobId } = await params;
  if (!isSafeMediaId(blobId)) {
    return NextResponse.json({ ok: false, error: 'Mídia inválida' }, { status: 400 });
  }

  const session = (await container.session.getSession()) ?? (await sessionFromApiToken(request));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }

  // A consulta escopada precede até o cache local. Um id válido de outra
  // empresa responde como inexistente e nunca revela que o blob está aqui.
  const media = await mediaStore.readBlob(blobId, session.account.id);
  if (!media) {
    return NextResponse.json({ ok: false, error: 'Mídia não encontrada' }, { status: 404 });
  }

  return respondWithMedia(request, media, {
    'Content-Type': media.mimeType,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': contentDispositionFor(media.mimeType),
    'X-Content-Type-Options': 'nosniff',
  });
}
