import { NextResponse } from 'next/server';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  props: { params: Promise<{ inboxId: string }> },
) {
  try {
    const { inboxId } = await props.params;
    const session = await container.session.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }

    // 1. Confere se a caixa de entrada pertence à conta ativa
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, accountId: session.account.id },
      select: {
        id: true,
        channel: true,
        waConnection: {
          select: {
            status: true,
            credsCipher: true,
            lockOwner: true,
            lockExpiresAt: true,
          },
        },
      },
    });

    if (!inbox) {
      return NextResponse.json(
        { ok: false, error: 'Caixa de entrada não encontrada para esta conta.' },
        { status: 404 },
      );
    }

    if (inbox.channel !== 'whatsapp') {
      return NextResponse.json(
        { ok: false, error: `Canal desta caixa é ${inbox.channel}, não whatsapp.` },
        { status: 400 },
      );
    }

    const lockVivo = Boolean(
      inbox.waConnection?.lockOwner &&
        inbox.waConnection.lockExpiresAt &&
        inbox.waConnection.lockExpiresAt > new Date(),
    );
    if (
      inbox.waConnection?.credsCipher &&
      inbox.waConnection.status === 'conectado' &&
      lockVivo
    ) {
      return NextResponse.json({ ok: true, status: 'conectado', reusedSession: true });
    }

    // Dois cliques, abas ou usuários não podem criar duas tentativas para a
    // mesma sessão. O comando existente continuará reutilizando as credenciais
    // cifradas; nenhum QR novo é necessário.
    const pending = await prisma.whatsAppCommand.findFirst({
      where: { inboxId, kind: 'connect', status: { in: ['pending', 'processing'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (pending) {
      return NextResponse.json({
        ok: true,
        commandId: pending.id,
        status: 'conectando',
        reusedSession: Boolean(inbox.waConnection?.credsCipher),
      });
    }

    // 2. Cria o registro de conexão se não existir
    await prisma.whatsAppConnection.upsert({
      where: { inboxId },
      create: {
        inboxId,
        status: 'conectando',
        pairedByUserId: session.user.id,
      },
      update: {
        status: 'conectando',
        pairedByUserId: session.user.id,
        lastError: null,
      },
    });

    // 3. Enfileira o comando para o worker processar
    const command = await prisma.whatsAppCommand.create({
      data: {
        inboxId,
        kind: 'connect',
        payload: {
          userId: session.user.id,
          userName: session.user.name,
          accountId: session.account.id,
        },
        status: 'pending',
      },
    });

    return NextResponse.json({
      ok: true,
      commandId: command.id,
      status: 'conectando',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao iniciar conexão de WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
