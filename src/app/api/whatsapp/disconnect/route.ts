import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Desconectar encerra a sessão de WhatsApp da conta: exige estar autenticado.
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }

    const channel = await getWhatsAppChannel();
    await channel.disconnect(session.account.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao desconectar WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
