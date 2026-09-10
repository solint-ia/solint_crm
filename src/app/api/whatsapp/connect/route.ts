import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import { PhoneNumber } from '@/core/domain/contact';
import { can } from '@/core/domain/user';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // O canal fica vinculado a quem pareou: o perfil do site vira dono da instancia.
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }
    if (!can(session, 'config.caixas:escrever')) {
      return NextResponse.json(
        { ok: false, error: 'Sem permissão para conectar o WhatsApp.' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      method?: unknown;
      phoneNumber?: unknown;
    };
    const method = body.method === 'phone' ? 'phone' : 'qr';
    const rawPhone = typeof body.phoneNumber === 'string' ? body.phoneNumber : '';
    if (method === 'phone' && !PhoneNumber.isValid(rawPhone)) {
      return NextResponse.json(
        { ok: false, error: 'Informe um número válido com DDI e DDD (ex.: 5511999998888).' },
        { status: 400 },
      );
    }

    // A conta vem da sessão, não de uma constante: é nela que as mensagens
    // recebidas por este número passam a ser gravadas.
    const channel = await getWhatsAppChannel();
    const status = await channel.startSession(
      {
        userId: session.user.id,
        userName: session.user.name,
        accountId: session.account.id,
      },
      {
        method,
        ...(method === 'phone' ? { phoneNumber: PhoneNumber.normalize(rawPhone).slice(1) } : {}),
      },
    );

    return NextResponse.json({ ok: true, engine: channel.engine, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao iniciar sessão do WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
