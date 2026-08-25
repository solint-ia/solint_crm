import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // O canal fica vinculado a quem pareou: o perfil do site vira dono da instancia.
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }

    // A conta vem da sessão, não de uma constante: é nela que as mensagens
    // recebidas por este número passam a ser gravadas.
    const channel = await getWhatsAppChannel();
    const status = await channel.startSession({
      userId: session.user.id,
      userName: session.user.name,
      accountId: session.account.id,
    });

    return NextResponse.json({ ok: true, engine: channel.engine, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao iniciar sessão do WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
