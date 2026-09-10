import { NextResponse } from 'next/server';
import { can, canSeeInbox } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, props: { params: Promise<{ inboxId: string }> }) {
  try {
    const { inboxId } = await props.params;
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }
    if (!can(session, 'config.caixas:escrever') || !canSeeInbox(session, inboxId)) {
      return NextResponse.json(
        { ok: false, error: 'Sem permissão para desconectar esta caixa.' },
        { status: 403 },
      );
    }

    // 1. Confere se a caixa de entrada pertence à conta ativa
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, accountId: session.account.id },
      select: { id: true, channel: true },
    });

    if (!inbox) {
      return NextResponse.json(
        { ok: false, error: 'Caixa de entrada não encontrada para esta conta.' },
        { status: 404 },
      );
    }

    const channel = await getWhatsAppChannel();
    await channel.disconnect(session.account.id, inboxId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao desconectar WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
