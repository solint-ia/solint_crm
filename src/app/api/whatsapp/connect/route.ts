import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { whatsappService } from '@/infrastructure/whatsapp/whatsapp-service';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // O canal fica vinculado a quem pareou: o perfil do site vira dono da instancia.
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }
    const status = await whatsappService.startSession({
      owner: { userId: session.user.id, userName: session.user.name },
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao iniciar sessão do WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
