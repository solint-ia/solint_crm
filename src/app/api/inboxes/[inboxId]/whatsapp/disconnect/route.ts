import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, props: { params: Promise<{ inboxId: string }> }) {
  try {
    const { inboxId } = await props.params;
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
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

    // 2. Enfileira o comando disconnect para o worker
    await prisma.whatsAppCommand.create({
      data: {
        inboxId,
        kind: 'disconnect',
        payload: {},
        status: 'pending',
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao desconectar WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
