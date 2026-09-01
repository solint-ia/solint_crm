import { NextResponse } from 'next/server';
import { ALLOWED_AVATAR_MIME_TYPES, isAllowedAvatarMimeType } from '@/core/domain/image-upload';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { BUCKETS, storage } from '@/infrastructure/storage/supabase-storage';

export const dynamic = 'force-dynamic';

/**
 * Serve a foto de perfil de um usuário.
 *
 * Privada, como o resto do que este bucket guarda: exige sessão, e só entrega
 * a foto de quem compartilha a conta ativa com quem pede (ou a própria pessoa,
 * vendo a própria foto). Um colega de outra empresa não tem por que enxergar
 * a foto de alguém só por conhecer o id — mesma lógica de isolamento por conta
 * que o resto do sistema segue (ver REGRAS-GLOBAIS.md §4.4).
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }

  if (userId !== session.user.id) {
    const colega = await prisma.membership.findFirst({
      where: { userId, accountId: session.account.id },
      select: { userId: true },
    });
    if (!colega) {
      return NextResponse.json({ ok: false, error: 'Não encontrada' }, { status: 404 });
    }
  }

  // O tipo vem da URL, então nunca é confiado às cegas — só o que já está na
  // lista de tipos aceitos pode virar o `Content-Type` da resposta. Sem esta
  // conferência, editar a URL bastaria para forçar um cabeçalho arbitrário.
  const url = new URL(request.url);
  const requestedType = url.searchParams.get('t') ?? '';
  const mimeType = isAllowedAvatarMimeType(requestedType)
    ? requestedType
    : ALLOWED_AVATAR_MIME_TYPES[0];

  const data = await storage.download(BUCKETS.AVATARS, `users/${userId}`);
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Não encontrada' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': mimeType,
      // A URL já carrega a versão (`?v=`), então o mesmo endereço nunca passa
      // a apontar para bytes diferentes — pode ficar em cache para sempre.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
    },
  });
}
