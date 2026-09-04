import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { isApiTokenActor } from '@/core/domain/user';
import { MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { sessionFromApiToken } from '@/infrastructure/auth/api-token';
import { container } from '@/infrastructure/container';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { getWhatsAppChannel } from '@/infrastructure/whatsapp/channel-provider';
import {
  conversationTargetShape,
  hasConversationTarget,
  resolveApiConversationId,
} from '../_shared/conversation-target';

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

const corpoSchema = z
  .object({
    ...conversationTargetShape,
    /**
     * Destinatário no vocabulário do WhatsApp, alternativa ao `conversaId`.
     *
     * **Por que existe.** O corpo entregue pelo webhook é a mensagem crua do
     * WhatsApp, e ali o que identifica o interlocutor é `data.key.remoteJid` —
     * não há id de conversa nenhum no protocolo. Sem esta porta, todo fluxo era
     * obrigado a carregar o bloco `solint` do corpo até o nó de resposta só
     * para reencontrar a conversa que o próprio CRM já sabe qual é.
     *
     * `jid` aceita a forma completa (`5579...@s.whatsapp.net`, `...@g.us`) e
     * `number` aceita o telefone solto. `instanceId` desempata quando a mesma
     * conta tem duas caixas falando com o mesmo número — sem ele vale a
     * conversa de atividade mais recente.
     */
    texto: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
    /** Nota interna nunca sai para o WhatsApp. Padrão é mensagem pública. */
    notaInterna: z.boolean().optional(),
  })
  .refine(hasConversationTarget, {
    message: 'Informe conversaId, jid ou number.',
  });

/**
 * O que toda resposta de envio devolve.
 *
 * Antes daqui saíam três campos — id, entregue, enfileirado — e o resto quem
 * integra tinha de guardar do próprio lado antes de chamar. Isso funciona
 * enquanto o fluxo é uma linha reta; quebra assim que a resposta é gravada num
 * log, num Data Store ou numa fila, porque nesses lugares só existe o que o
 * corpo trouxe. Devolver o texto, o horário e a quem a mensagem foi determina
 * que uma execução do n8n possa ser auditada sozinha, sem cruzar com o pedido.
 *
 * `criadaEm` é o instante em UTC, e `hora` é o rótulo curto que o CRM mostra na
 * bolha, no fuso da conta. Os dois porque servem a coisas diferentes: um ordena,
 * o outro aparece para uma pessoa.
 */
const corpoDaResposta = (
  message: { id: string; time: string; createdAt?: string; isPrivate: boolean },
  conversation: { id: string; inboxId: string; contact: { id: string; name: string } },
  texto: string,
) => ({
  mensagemId: message.id,
  conversaId: conversation.id,
  caixaEntradaId: conversation.inboxId,
  contatoId: conversation.contact.id,
  contatoNome: conversation.contact.name,
  texto,
  notaInterna: message.isPrivate,
  hora: message.time,
  ...(message.createdAt ? { criadaEm: message.createdAt } : {}),
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
      {
        ok: false,
        erro: 'Informe texto e um destino (conversaId, jid ou number).',
        detalhes: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const isPrivate = parsed.data.notaInterna === true;
  const rawIdempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (rawIdempotencyKey && rawIdempotencyKey.length > 128) {
    return NextResponse.json(
      { ok: false, erro: 'Idempotency-Key deve ter no máximo 128 caracteres.' },
      { status: 400 },
    );
  }
  const idempotencyKey = rawIdempotencyKey
    ? `api:${session.account.id}:${rawIdempotencyKey}`
    : undefined;

  const destinatario = parsed.data.jid ?? parsed.data.number;
  const conversationId = await resolveApiConversationId(session.account.id, parsed.data);

  if (!conversationId) {
    return NextResponse.json(
      {
        ok: false,
        erro: `Nenhuma conversa desta conta para ${destinatario}. Ela precisa existir: o envio responde a um atendimento, nao abre um.`,
      },
      { status: 404 },
    );
  }

  /**
   * Conversa assumida por uma pessoa não recebe resposta de robô.
   *
   * É a única guarda que funciona contra a corrida real: o atendente clica em
   * "assumir" enquanto o agente já está redigindo, e a resposta chega aqui de
   * qualquer jeito — o fluxo lá fora leu o estado de segundos atrás. Filtrar só
   * no n8n deixaria essa janela aberta, e o cliente veria o robô falando por
   * cima de quem acabou de assumir.
   *
   * Vale apenas para token de API. Atendente logado continua enviando: pausar o
   * agente é justamente para ele poder escrever.
   */
  if (isApiTokenActor(session.user.id)) {
    const conversa = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId: session.account.id },
      select: { aiPausedUntil: true, aiPausedReason: true },
    });
    const pausado =
      conversa?.aiPausedReason &&
      (!conversa.aiPausedUntil || conversa.aiPausedUntil.getTime() > Date.now());
    if (pausado) {
      return NextResponse.json(
        {
          ok: false,
          erro: 'Conversa assumida por um atendente: o agente esta pausado.',
          agentePausado: true,
          ...(conversa.aiPausedUntil
            ? { agentePausadoAte: conversa.aiPausedUntil.toISOString() }
            : {}),
        },
        { status: 409 },
      );
    }
  }

  const stableMessageId = idempotencyKey
    ? `msg-api-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40)}`
    : undefined;

  const existingResponse = async (): Promise<NextResponse | null> => {
    if (!idempotencyKey) return null;
    const existing = await prisma.message.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        conversationId: true,
        content: true,
        isPrivate: true,
        time: true,
        createdAt: true,
        externalId: true,
        deliveryStatus: true,
        dispatchError: true,
      },
    });
    if (!existing) return null;
    const content = readJson<{ text?: string }>(existing.content, {});
    if (
      existing.conversationId !== conversationId ||
      existing.isPrivate !== isPrivate ||
      content.text !== parsed.data.texto
    ) {
      return NextResponse.json(
        { ok: false, erro: 'Idempotency-Key já foi usada para outra requisição.' },
        { status: 409 },
      );
    }
    if (existing.deliveryStatus === 'falha') {
      return NextResponse.json(
        {
          ok: false,
          mensagemId: existing.id,
          erro: existing.dispatchError ?? 'O envio idempotente anterior falhou.',
          idempotente: true,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      mensagemId: existing.id,
      conversaId: existing.conversationId,
      texto: content.text ?? parsed.data.texto,
      notaInterna: existing.isPrivate,
      hora: existing.time,
      criadaEm: existing.createdAt.toISOString(),
      ...(existing.externalId ? { externalId: existing.externalId } : {}),
      entregue: Boolean(existing.externalId),
      enfileirado: !existing.externalId && !existing.isPrivate,
      idempotente: true,
    });
  };

  const duplicate = await existingResponse();
  if (duplicate) return duplicate;

  let resultado;
  try {
    resultado = await container.useCases.sendMessage({
      session,
      conversationId,
      text: parsed.data.texto,
      isPrivate,
      ...(stableMessageId ? { messageId: stableMessageId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  } catch (error) {
    // Duas tentativas simultâneas podem passar pela leitura anterior; a chave
    // única decide a corrida e a perdedora devolve o mesmo resultado.
    const raced = await existingResponse();
    if (raced) return raced;
    throw error;
  }

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, erro: resultado.error.message },
      { status: statusPara(resultado.error.code) },
    );
  }

  const { conversation } = resultado.value;
  const message = resultado.value.message;

  const corpo = corpoDaResposta(message, conversation, parsed.data.texto);

  // Nota interna termina aqui: ela é registro do CRM e nunca vai para o canal.
  if (isPrivate) {
    return NextResponse.json({ ok: true, ...corpo, entregue: false });
  }

  if (conversation.channel !== 'whatsapp') {
    return NextResponse.json({ ok: true, ...corpo, entregue: false });
  }

  const channel = await getWhatsAppChannel();
  const status = await channel.getStatus(session.account.id, conversation.inboxId);

  if (status.status !== 'conectado') {
    // A mensagem já está gravada — desfazer seria pior, porque a tela mostraria
    // um histórico diferente do que quem integra viu acontecer. `503` diz que o
    // canal está fora, não que a chamada estava errada.
    const error = status.error ?? 'WhatsApp desconectado: a mensagem não foi entregue.';
    await prisma.message.updateMany({
      where: {
        id: message.id,
        conversationId: conversation.id,
        conversation: { accountId: session.account.id },
      },
      data: { deliveryStatus: 'falha', dispatchError: error },
    });
    return NextResponse.json({ ok: false, ...corpo, entregue: false, erro: error }, { status: 503 });
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
    const error = enviado.error ?? 'Falha ao despachar.';
    await prisma.message.updateMany({
      where: {
        id: message.id,
        conversationId: conversation.id,
        conversation: { accountId: session.account.id },
      },
      data: { deliveryStatus: 'falha', dispatchError: error },
    });
    return NextResponse.json({ ok: false, ...corpo, entregue: false, erro: error }, { status: 502 });
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
      ...corpo,
      externalId: enviado.externalId,
      entregue: true,
    });
  }

  return NextResponse.json({
    ok: true,
    ...corpo,
    entregue: false,
    enfileirado: true,
  });
}
