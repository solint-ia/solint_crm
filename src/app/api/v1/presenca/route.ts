import { NextResponse } from 'next/server';
import { z } from 'zod';

import { can } from '@/core/domain/user';
import { sessionFromApiToken } from '@/infrastructure/auth/api-token';
import { container } from '@/infrastructure/container';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import {
  conversationTargetShape,
  hasConversationTarget,
  resolveApiConversationId,
} from '../_shared/conversation-target';

export const dynamic = 'force-dynamic';

const presenceStatuses = ['composing', 'paused', 'recording'] as const;

const bodySchema = z
  .object({
    ...conversationTargetShape,
    status: z.enum(presenceStatuses).default('composing'),
  })
  .refine(hasConversationTarget, {
    message: 'Informe conversaId, jid ou number.',
  });

/**
 * Emite a presença efêmera do operador para uma conversa do WhatsApp.
 *
 * Não grava mensagem nem altera a timeline. A resposta confirma que o canal
 * aceitou a intenção; o protocolo do WhatsApp não confirma se o outro aparelho
 * chegou a desenhar o indicador.
 */
export async function POST(request: Request) {
  const session = await sessionFromApiToken(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, erro: 'Token ausente ou inválido. Use Authorization: Bearer sk_live_...' },
      { status: 401 },
    );
  }

  if (!can(session, 'conversas:responder')) {
    return NextResponse.json(
      { ok: false, erro: 'Sem permissão para responder conversas.' },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo não é JSON válido.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        erro: 'Informe um destino válido e um status de presença aceito.',
        detalhes: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const conversationId = await resolveApiConversationId(session.account.id, parsed.data);
  const destination = parsed.data.jid ?? parsed.data.number ?? parsed.data.conversaId;
  if (!conversationId) {
    return NextResponse.json(
      {
        ok: false,
        erro: `Nenhuma conversa desta conta para ${destination ?? 'o destino informado'}.`,
      },
      { status: 404 },
    );
  }

  const conversation = await container.conversations.findById(
    session.account.id,
    conversationId,
    session.inboxAccess,
  );
  if (!conversation) {
    return NextResponse.json(
      { ok: false, erro: 'Conversa não encontrada nesta conta.' },
      { status: 404 },
    );
  }

  if (conversation.channel !== 'whatsapp') {
    return NextResponse.json(
      { ok: false, erro: 'Presença só pode ser enviada para conversas do WhatsApp.' },
      { status: 422 },
    );
  }

  const channel = await getWhatsAppChannel();
  const connection = await channel.getStatus(session.account.id, conversation.inboxId);
  if (connection.status !== 'conectado') {
    return NextResponse.json(
      {
        ok: false,
        erro: connection.error ?? 'WhatsApp desconectado: a presença não foi enviada.',
      },
      { status: 503 },
    );
  }

  const dispatched = await channel.sendPresence(
    {
      accountId: session.account.id,
      inboxId: conversation.inboxId,
      conversationId: conversation.id,
    },
    {
      channelThreadId: conversation.channelThreadId,
      phone: conversation.contact.phone,
    },
    parsed.data.status,
  );

  if (!dispatched.ok) {
    return NextResponse.json(
      { ok: false, erro: dispatched.error ?? 'Falha ao despachar a presença.' },
      { status: channel.engine === 'worker' ? 503 : 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    conversaId: conversation.id,
    status: parsed.data.status,
    aceito: true,
    enfileirado: dispatched.queued === true,
  });
}
