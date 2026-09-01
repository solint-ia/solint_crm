import { NextResponse } from 'next/server';
import { ALLOWED_LOGO_MIME_TYPES, isAllowedLogoMimeType } from '@/core/domain/image-upload';
import { container } from '@/infrastructure/container';
import { BUCKETS, storage } from '@/infrastructure/storage/supabase-storage';

export const dynamic = 'force-dynamic';

/**
 * Serve o logotipo de uma conta.
 *
 * Escopado pela conta **ativa** da sessão, e não por "é membro dela em algum
 * momento": mesma regra de isolamento que o resto do sistema segue (ver
 * REGRAS-GLOBAIS.md §4.4). Quem tem acesso a duas contas e quer ver o logo da
 * outra precisa trocar de workspace primeiro — não há atalho por id.
 */
export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;

  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }
  if (accountId !== session.account.id) {
    return NextResponse.json({ ok: false, error: 'Não encontrada' }, { status: 404 });
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
