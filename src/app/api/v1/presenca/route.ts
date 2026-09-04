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

/**
 * Teto do que a rota segura antes de responder.
 *
 * A função que atende esta rota tem um limite de execução da hospedagem — sem
 * `maxDuration` configurado, o padrão de muitos provedores gira em torno de dez
 * segundos. Deixar `duracaoMs` sem teto deixaria uma resposta de agente maior
 * derrubar a própria chamada de presença com timeout, que é o oposto do que ela
 * deveria fazer.
 */
const DURACAO_MAX_MS = 6_000;

const bodySchema = z
  .object({
    ...conversationTargetShape,
    status: z.enum(presenceStatuses).default('composing'),
    /**
     * Quanto tempo, em milissegundos, o indicador fica visível antes da rota
     * responder.
     *
     * Sem este campo a chamada é o que sempre foi: dispara e volta na hora, e o
     * WhatsApp do destinatário decide sozinho quando o indicador some. Com ele,
     * a rota segura a resposta pelo tempo pedido e manda `paused` no fim — é o
     * equivalente ao `delay` que a Evolution API aceitava na própria chamada de
     * presença, para quem está migrando um fluxo que dependia disso.
     */
    duracaoMs: z.number().int().min(0).max(DURACAO_MAX_MS).optional(),
  })
  .refine(hasConversationTarget, {
    message: 'Informe conversaId, jid ou number.',
  });

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  const target = {
    channelThreadId: conversation.channelThreadId,
    phone: conversation.contact.phone,
  };
  const context = {
    accountId: session.account.id,
    inboxId: conversation.inboxId,
    conversationId: conversation.id,
  };

  const dispatched = await channel.sendPresence(context, target, parsed.data.status);

  if (!dispatched.ok) {
    return NextResponse.json(
      { ok: false, erro: dispatched.error ?? 'Falha ao despachar a presença.' },
      { status: channel.engine === 'worker' ? 503 : 502 },
    );
  }

  // Segura a resposta pelo tempo pedido, com o indicador no ar, e limpa antes
  // de devolver. `paused` explícito no fim, e não silêncio: esperar o WhatsApp
  // do destinatário decidir sozinho quando o indicador some tiraria da rota
  // justamente a garantia que `duracaoMs` existe para dar.
  if (parsed.data.duracaoMs && parsed.data.status !== 'paused') {
    await dormir(parsed.data.duracaoMs);
    await channel.sendPresence(context, target, 'paused').catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    conversaId: conversation.id,
    status: parsed.data.status,
    aceito: true,
    enfileirado: dispatched.queued === true,
    ...(parsed.data.duracaoMs ? { duracaoMs: parsed.data.duracaoMs } : {}),
  });
}
