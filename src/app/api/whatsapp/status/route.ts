import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { qrImage } from '@/infrastructure/whatsapp/qr-image';

export const dynamic = 'force-dynamic';

/**
 * Leitura pontual do status — usada no primeiro render, antes do SSE abrir.
 *
 * Exige sessão. O payload de status carrega o **QR de pareamento**, e o QR é uma
 * credencial: quem o lê pareia o WhatsApp da empresa no próprio aparelho. Esta
 * rota ficava aberta porque o `middleware.ts` deixa `/api` fora do matcher de
 * propósito (um redirecionamento HTML não serve a um cliente que espera JSON),
 * o que transfere a checagem para cada rota — e esta não fazia a sua.
 */
export async function GET() {
  const session = await container.session.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  }

  const channel = await getWhatsAppChannel();
  const status = await channel.getStatus(session.account.id);

  // O canal pertence a quem pareou. Outra conta pode saber que existe uma
  // conexão, mas não recebe o QR dela.
  const owner = status.owner;
  const visible = !owner || owner.accountId === session.account.id;

  return NextResponse.json({
    ok: true,
    engine: channel.engine,
    // O QR vira imagem só aqui, na borda — ver `qr-image.ts`.
    status: visible ? { ...status, qr: await qrImage(status.qr) } : { ...status, qr: undefined },
  });
}
