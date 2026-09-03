import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';

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
    const command = await prisma.whatsAppCommand.create({
      data: {
        inboxId,
        kind: 'disconnect',
        payload: {},
        status: 'pending',
      },
    });

    /**
     * O aviso que faltava — a causa da demora em "desconectada".
     *
     * Sem `NOTIFY`, o comando esperava a varredura do worker (15 s) para ser
     * sequer lido. Só então o socket caía, o status virava `desconectado` no
     * banco e o evento chegava à tela. Quem clicava via o botão responder e o
     * cartão continuar dizendo "conectado" por um tempo que não tinha
     * explicação nenhuma na interface.
     */
    await postgresPubSub
      .publish(CHANNELS.COMMANDS, { inboxId, kind: 'disconnect', id: command.id })
      .catch(() => {
        // Aviso perdido não desfaz o comando: a varredura ainda o encontra.
      });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao desconectar WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
