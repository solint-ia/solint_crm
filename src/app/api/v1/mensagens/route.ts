import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from '@/core/use-cases/send-message';
import { CONVERSATION_ID_MAX_LENGTH } from '@/core/domain/conversation';
import { sessionFromApiToken } from '@/infrastructure/auth/api-token';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';
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

const corpoSchema = z
  .object({
    conversaId: z.string().min(1).max(CONVERSATION_ID_MAX_LENGTH).optional(),
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
    jid: z.string().trim().min(1).max(128).optional(),
    number: z.string().trim().min(1).max(32).optional(),
    instanceId: z.string().trim().min(1).max(128).optional(),
    texto: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
    /** Nota interna nunca sai para o WhatsApp. Padrão é mensagem pública. */
    notaInterna: z.boolean().optional(),
  })
  .refine((corpo) => Boolean(corpo.conversaId ?? corpo.jid ?? corpo.number), {
    message: 'Informe conversaId, jid ou number.',
  });

/**
 * As formas de JID que podem estar gravadas para o mesmo telefone.
 *
 * O nono dígito é a razão. Um número de celular brasileiro escrito com ele
 * (`5579981454771`) e sem ele (`557981454771`) é a mesma pessoa, e qual das
 * duas formas ficou gravada depende de quando a conversa nasceu e de como o
 * WhatsApp entregou a mensagem. Procurar só pela forma que veio na chamada faz
 * a resposta cair em "conversa não encontrada" para um contato que existe.
 *
 * Mesma regra aplicada em `resolveStoredIds`, no caminho de gravação.
 */
const jidsCandidatos = (bruto: string): readonly string[] => {
  // Já veio no formato do WhatsApp (usuário, grupo ou transmissão).
  if (bruto.includes('@')) return [bruto];

  const digitos = bruto.replace(/\D/g, '');
  if (!digitos) return [];

  const formas = new Set<string>([digitos]);
  if (digitos.length === 13 && digitos.startsWith('55') && digitos[4] === '9') {
    formas.add(`${digitos.slice(0, 4)}${digitos.slice(5)}`);
  }
  if (digitos.length === 12 && digitos.startsWith('55')) {
    formas.add(`${digitos.slice(0, 4)}9${digitos.slice(4)}`);
  }

  return [...formas].map((forma) => `${forma}@s.whatsapp.net`);
};

/**
 * Encontra a conversa pelo destinatário, dentro da conta de quem chamou.
 *
 * O escopo por `accountId` não é opcional: `channelThreadId` é o telefone do
 * contato, e duas empresas podem falar com o mesmo cliente. Sem ele, um token
 * de uma conta mandaria mensagem na conversa de outra.
 */
const acharConversa = async (
  accountId: string,
  destinatario: string,
  instanceId?: string,
): Promise<string | null> => {
  const candidatos = jidsCandidatos(destinatario);
  if (candidatos.length === 0) return null;

  const conversa = await prisma.conversation.findFirst({
    where: {
      accountId,
      channelThreadId: { in: [...candidatos] },
      ...(instanceId ? { inboxId: instanceId } : {}),
    },
    // A mais recente porque é a que o fluxo acabou de receber: quando a mesma
    // pessoa tem conversa em duas caixas, responder na antiga sairia pelo
    // número errado.
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true },
  });

  return conversa?.id ?? null;
};

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

  const destinatario = parsed.data.jid ?? parsed.data.number;
  const conversationId =
    parsed.data.conversaId ??
    (destinatario
      ? await acharConversa(session.account.id, destinatario, parsed.data.instanceId)
      : null);

  if (!conversationId) {
    return NextResponse.json(
      {
        ok: false,
        erro: `Nenhuma conversa desta conta para ${destinatario}. Ela precisa existir: o envio responde a um atendimento, nao abre um.`,
      },
      { status: 404 },
    );
  }

  const resultado = await container.useCases.sendMessage({
    session,
    conversationId,
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
