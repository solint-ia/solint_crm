import { NextResponse } from 'next/server';
import { ALLOWED_LOGO_MIME_TYPES, isAllowedLogoMimeType } from '@/core/domain/image-upload';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { BUCKETS, storage } from '@/infrastructure/storage/supabase-storage';

export const dynamic = 'force-dynamic';

/**
 * Serve o logotipo de uma conta.
 *
 * A conta ativa, ou outra em que a pessoa tenha vínculo. O seletor de
 * workspace mostra o logo de todas as contas da pessoa, e só com a conta ativa
 * as outras apareciam como imagem quebrada até cair nas iniciais. O logo é a
 * marca da empresa, a mesma que o cliente vê: nenhum dado do atendimento sai
 * por aqui, e quem não tem vínculo continua recebendo 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;

  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }
  if (accountId !== session.account.id) {
    const vinculo = session.platformActor
      ? null
      : await prisma.membership.findUnique({
          where: { userId_accountId: { userId: session.user.id, accountId } },
          select: { accountId: true },
        });
    if (!vinculo) {
      return NextResponse.json({ ok: false, error: 'Não encontrada' }, { status: 404 });
    }
  }

  // O tipo vem da URL, então nunca é confiado às cegas — só o que já está na
  // lista de tipos aceitos pode virar o `Content-Type` da resposta.
  const url = new URL(request.url);
  const requestedType = url.searchParams.get('t') ?? '';
  const mimeType = isAllowedLogoMimeType(requestedType)
    ? requestedType
    : ALLOWED_LOGO_MIME_TYPES[0];

  const data = await storage.download(BUCKETS.AVATARS, `accounts/${accountId}`);
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
