import { NextResponse } from 'next/server';
import { can, canSeeInbox } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { asJson, prisma } from '@/infrastructure/db/prisma';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, props: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await props.params;
  const session = await container.session.getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
  if (!can(session, 'conversas:ler')) {
    return NextResponse.json({ ok: false, error: 'Sem permissão.' }, { status: 403 });
  }

  const pending = await prisma.pendingMedia.findFirst({
    where: { messageId, accountId: session.account.id },
    select: {
      inboxId: true,
      status: true,
      message: { select: { conversationId: true } },
      inbox: { select: { waConnection: { select: { status: true, credsCipher: true } } } },
    },
  });
  if (!pending || !canSeeInbox(session, pending.inboxId)) {
    return NextResponse.json({ ok: false, error: 'Mídia não encontrada.' }, { status: 404 });
  }
  if (
    pending.inbox.waConnection?.status !== 'conectado' ||
    !pending.inbox.waConnection.credsCipher
  ) {
    return NextResponse.json(
      { ok: false, error: 'Conecte a caixa para baixar esta mídia.' },
      { status: 409 },
    );
  }
  if (pending.status === 'indisponivel') {
    return NextResponse.json(
      { ok: false, error: 'Mídia não disponível no celular.' },
      { status: 410 },
    );
  }

  const command = await prisma.whatsAppCommand.create({
    data: {
      inboxId: pending.inboxId,
      kind: 'media_fetch',
      status: 'pending',
      payload: asJson({
        accountId: session.account.id,
        conversationId: pending.message.conversationId,
        messageId,
      }),
    },
    select: { id: true },
  });
  await postgresPubSub.publish(CHANNELS.COMMANDS, {
    inboxId: pending.inboxId,
    kind: 'media_fetch',
    id: command.id,
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
