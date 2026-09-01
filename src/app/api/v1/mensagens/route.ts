import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { CONVERSATION_ID_MAX_LENGTH } from '@/core/domain/conversation';
import { sessionFromApiToken } from '@/infrastructure/auth/api-token';
import { container } from '@/infrastructure/container';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';

export const dynamic = 'force-dynamic';

/**
 * Envio de mensagem por token — a volta que faltava para uma automação.
 *
 * **Por que esta rota existe.** Enviar mensagem só acontecia por Server Action,
 * chamada do formulário da tela de conversas, e Server Action exige cookie de
 * sessão. Um fluxo do n8n decide a resposta e não tinha como entregá-la: a
 * perna de ida (webhook do CRM para fora) existia, a de volta não.
 *
 * **Nada de regra de negócio mora aqui.** A rota autentica, valida a entrada e
 * chama exatamente o mesmo caso de uso que a tela chama — que é quem confere a
 * permissão, a janela de 24h do WhatsApp e o limite de tamanho. Duplicar
 * qualquer dessas regras aqui criaria dois lugares para elas divergirem.
 */

const corpoSchema = z.object({
  conversaId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH),
  texto: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  /** Nota interna nunca sai para o WhatsApp. Padrão é mensagem pública. */
  notaInterna: z.boolean().optional(),
});

/**
 * Código de erro do domínio para status HTTP.
 *
 * A janela HSM é `409` e não `400` de propósito: a requisição está correta, o
 * estado da conversa é que não permite. Quem integra precisa distinguir "corrigi
 * o payload e tento de novo" de "preciso de um template aprovado".
 */
const statusPara = (codigo: string): number => {
  if (codigo === 'FORBIDDEN') return 403;
  if (codigo === 'NOT_FOUND') return 404;
  if (codigo === 'HSM_WINDOW_CLOSED') return 409;
  return 400;
};

export async function POST(request: Request) {
  const session = await sessionFromApiToken(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, erro: 'Token ausente ou inválido. Use Authorization: Bearer sk_live_...' },
      { status: 401 },
    );
  }

  let bruto: unknown;
  try {
    bruto = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo não é JSON válido.' }, { status: 400 });
  }

  const parsed = corpoSchema.safeParse(bruto);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, erro: 'Informe conversaId e texto.', detalhes: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const isPrivate = parsed.data.notaInterna === true;

  const resultado = await container.useCases.sendMessage({
    session,
    conversationId: parsed.data.conversaId,
    text: parsed.data.texto,
    isPrivate,
  });

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, erro: resultado.error.message },
      { status: statusPara(resultado.error.code) },
    );
  }

  const { conversation } = resultado.value;
  const message = resultado.value.message;

  // Nota interna termina aqui: ela é registro do CRM e nunca vai para o canal.
  if (isPrivate) {
    return NextResponse.json({ ok: true, mensagemId: message.id, entregue: false });
  }

  if (conversation.channel !== 'whatsapp') {
    return NextResponse.json({ ok: true, mensagemId: message.id, entregue: false });
  }

  const channel = await getWhatsAppChannel();
  const status = await channel.getStatus(session.account.id, conversation.inboxId);

  if (status.status !== 'conectado') {
    // A mensagem já está gravada — desfazer seria pior, porque a tela mostraria
    // um histórico diferente do que quem integra viu acontecer. `503` diz que o
    // canal está fora, não que a chamada estava errada.
    return NextResponse.json(
      {
        ok: false,
        mensagemId: message.id,
        erro: status.error ?? 'WhatsApp desconectado: a mensagem não foi entregue.',
      },
      { status: 503 },
    );
  }

  const enviado = await channel.sendText(
    {
      accountId: session.account.id,
      conversationId: conversation.id,
      messageId: message.id,
      inboxId: conversation.inboxId,
    },
    { channelThreadId: conversation.channelThreadId, phone: conversation.contact.phone },
    parsed.data.texto,
  );

  if (!enviado.ok) {
    return NextResponse.json(
      { ok: false, mensagemId: message.id, erro: enviado.error ?? 'Falha ao despachar.' },
      { status: 502 },
    );
  }

  // `queued` é o motor worker dizendo "aceitei, ainda não enviei" — o mesmo
  // significado que a bolha "enviando" tem na tela. Quem integra precisa saber
  // a diferença para não tratar como entrega confirmada.
  if (enviado.externalId) {
    await container.conversations.attachExternalId(
      session.account.id,
      conversation.id,
      message.id,
      enviado.externalId,
    );
    return NextResponse.json({
      ok: true,
      mensagemId: message.id,
      externalId: enviado.externalId,
      entregue: true,
    });
  }

  return NextResponse.json({
    ok: true,
    mensagemId: message.id,
    entregue: false,
    enfileirado: true,
  });
}
