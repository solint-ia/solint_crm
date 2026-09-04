/**
 * Teste da pausa do agente de IA por conversa.
 *
 * O que ele prova, em ordem de importância:
 *
 *  1. o corpo entregue ao n8n diz se o agente está pausado, **sem deixar de
 *     entregar a mensagem** — é isso que permite alimentar a memória do agente
 *     enquanto um humano atende;
 *  2. pausar pelo botão e pausar por resposta no celular convivem, e a segunda
 *     nunca encurta a primeira;
 *  3. a pausa vence sozinha, sem ninguém varrer nada;
 *  4. um token de API não vira responsável pela conversa — antes disso, a
 *     primeira resposta do agente a uma conversa sem dono derrubava a rota com
 *     violação de chave estrangeira.
 *
 * O corpo é lido da outbox, e não de um servidor HTTP: é exatamente o JSON que
 * o entregador vai mandar, e ler a tabela dispensa esperar o relógio dele.
 *
 *   npx tsx scripts/test-pausa-do-agente.ts
 */
import { randomUUID } from 'node:crypto';

import { isAiPaused } from '../src/core/domain/conversation';
import { isApiTokenActor } from '../src/core/domain/user';
import { sessionFromApiToken } from '../src/infrastructure/auth/api-token';
import { container } from '../src/infrastructure/container';
import { prisma } from '../src/infrastructure/db/prisma';
import { aplicarPausaDoAgente } from '../src/infrastructure/repositories/prisma/conversation-repository';
import { dispararWebhooks } from '../src/infrastructure/webhooks/webhook-dispatch';
import type {
  SolintRefs,
  WebhookPayloadEmMontagem,
} from '../src/infrastructure/webhooks/webhook-dispatch';

/** Prazo da caixa de teste. Só a pausa deduzida tem prazo; a do botão não vence. */
const MINUTOS_CELULAR = 30;

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

const sufixo = randomUUID().slice(0, 8);
const id = (nome: string) => `pausa-${sufixo}-${nome}`;

let sequencia = 0;
const proximaMensagem = () => `msg-${sufixo}-${++sequencia}`;

const payloadDe = (
  contaId: string,
  caixaId: string,
  conversaId: string,
  contatoId: string,
): WebhookPayloadEmMontagem => {
  const solint: SolintRefs = {
    contaId,
    caixaEntradaId: caixaId,
    conversaId,
    contatoId,
    mensagemId: proximaMensagem(),
    conversaNova: false,
  };
  return {
    event: 'messages.upsert',
    instance: 'Caixa de teste',
    data: {
      key: { remoteJid: '557999999999@s.whatsapp.net', fromMe: false, id: solint.mensagemId! },
      message: { conversation: 'preciso de ajuda' },
      contextInfo: null,
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      instanceId: caixaId,
      source: 'teste',
    },
    date_time: new Date().toISOString(),
    sender: '557988888888@s.whatsapp.net',
    solint,
  };
};

/** O corpo que a outbox guardou para este evento, como ele será entregue. */
interface CorpoEntregue {
  readonly data?: { readonly message?: Record<string, unknown> };
  readonly solint?: { readonly agentePausado?: boolean; readonly agentePausadoAte?: string };
}

const dispararELer = async (
  contaId: string,
  caixaId: string,
  conversaId: string,
  contatoId: string,
): Promise<CorpoEntregue> => {
  const payload = payloadDe(contaId, caixaId, conversaId, contatoId);
  await dispararWebhooks('mensagem.recebida', payload);
  const linha = await prisma.webhookDelivery.findFirst({
    where: { accountId: contaId, dedupeKey: `mensagem.recebida:${payload.solint.mensagemId}` },
    select: { payload: true },
  });
  if (!linha) throw new Error('nada foi enfileirado na outbox');
  return linha.payload as CorpoEntregue;
};

async function main() {
  const conta = await prisma.account.create({
    data: { id: id('conta'), name: 'Conta da pausa (teste)', plan: 'teste' },
    select: { id: true },
  });
  const caixa = await prisma.inbox.create({
    data: {
      id: id('caixa'),
      accountId: conta.id,
      name: 'Caixa da pausa',
      channel: 'whatsapp',
      identifier: '5579900000000',
      status: 'desconectado',
      provider: 'baileys',
      businessHours: {},
      awayMessage: {},
      greeting: {},
      aiPauseChannelReplyMinutes: MINUTOS_CELULAR,
    },
    select: { id: true },
  });
  const contato = await prisma.contact.create({
    data: {
      id: id('contato'),
      accountId: conta.id,
      name: 'Cliente de teste',
      phone: '5579911111111',
      channel: 'whatsapp',
      avatarTone: 'slate',
    },
    select: { id: true },
  });
  const conversa = await prisma.conversation.create({
    data: {
      id: id('conversa'),
      accountId: conta.id,
      contactId: contato.id,
      channel: 'whatsapp',
      inboxId: caixa.id,
      queue: 'Atendimento',
      status: 'aberta',
      statusLabel: 'Aberta',
    },
    select: { id: true },
  });

  await prisma.webhook.create({
    data: {
      accountId: conta.id,
      name: 'Destino da pausa',
      // Porta fechada de propósito: este teste lê a outbox, nunca entrega.
      url: 'http://127.0.0.1:1/nao-usado',
      events: ['mensagem.recebida'],
      isActive: true,
      allInboxes: true,
    },
  });

  const lerConversa = () =>
    container.conversations.findById(conta.id, conversa.id, 'todas') as Promise<
      Awaited<ReturnType<typeof container.conversations.findById>>
    >;

  try {
    console.log('\n1) Sem pausa, o corpo sai com agentePausado false');
    const ativo = await dispararELer(conta.id, caixa.id, conversa.id, contato.id);
    check('agentePausado false', ativo.solint?.agentePausado === false);
    check('sem prazo', ativo.solint?.agentePausadoAte === undefined);
    check('a mensagem foi entregue no corpo', Boolean(ativo.data?.message));

    console.log('\n2) Botao "assumir": pausa que NAO vence');
    const pausada = await container.conversations.pauseAiAgent(conta.id, conversa.id, 'manual', {
      id: 'usr-teste',
      name: 'Atendente de Teste',
    });
    check('o dominio enxerga a pausa', isAiPaused(pausada));
    check('guardou quem pausou', pausada.aiPausedByName === 'Atendente de Teste');
    check('guardou o motivo', pausada.aiPausedReason === 'manual');
    check('sem prazo de validade', pausada.aiPausedUntil === undefined);
    // Um ano depois ainda está pausada: é isso que "até alguém devolver"
    // significa, e é o que uma data de vencimento quebraria em silêncio.
    check(
      'continua pausada daqui a um ano',
      isAiPaused(pausada, new Date(Date.now() + 365 * 24 * 60 * 60_000)),
    );

    console.log('\n3) Pausado, o evento continua chegando — marcado');
    const durante = await dispararELer(conta.id, caixa.id, conversa.id, contato.id);
    check('agentePausado true', durante.solint?.agentePausado === true);
    check(
      'sem agentePausadoAte, porque a pausa nao vence',
      durante.solint?.agentePausadoAte === undefined,
    );
    check(
      'a mensagem continua no corpo (memoria do agente)',
      (durante.data?.message as { conversation?: string } | undefined)?.conversation ===
        'preciso de ajuda',
    );

    console.log('\n4) Resposta pelo celular NAO poe prazo na pausa do botao');
    await aplicarPausaDoAgente(conta.id, conversa.id, 'resposta_no_celular');
    const depoisDoCelular = await lerConversa();
    check(
      'continua sem prazo',
      depoisDoCelular?.aiPausedUntil === undefined,
      `${depoisDoCelular?.aiPausedUntil}`,
    );
    check('o motivo continua manual', depoisDoCelular?.aiPausedReason === 'manual');
    check('quem assumiu continua registrado', depoisDoCelular?.aiPausedByName === 'Atendente de Teste');

    console.log('\n5) Devolver ao agente limpa a pausa');
    const devolvida = await container.conversations.resumeAiAgent(conta.id, conversa.id);
    check('o dominio nao ve mais pausa', !isAiPaused(devolvida));
    check('sem motivo', devolvida.aiPausedReason === undefined);
    check('sem prazo', devolvida.aiPausedUntil === undefined);
    const depois = await dispararELer(conta.id, caixa.id, conversa.id, contato.id);
    check('o corpo volta a agentePausado false', depois.solint?.agentePausado === false);

    console.log('\n6) Pausa so pelo celular usa o prazo curto');
    await aplicarPausaDoAgente(conta.id, conversa.id, 'resposta_no_celular');
    const porCelular = await lerConversa();
    const curtos = Math.round((Date.parse(porCelular!.aiPausedUntil!) - Date.now()) / 60_000);
    check(
      `prazo de ${MINUTOS_CELULAR} minutos`,
      Math.abs(curtos - MINUTOS_CELULAR) <= 1,
      `${curtos} min`,
    );
    check('motivo registrado', porCelular?.aiPausedReason === 'resposta_no_celular');
    check('sem autor', porCelular?.aiPausedByName === undefined);

    console.log('\n7) Pausa vencida vale como agente ativo, sem ninguem varrer nada');
    await prisma.conversation.update({
      where: { id: conversa.id },
      data: { aiPausedUntil: new Date(Date.now() - 60_000), aiPausedReason: 'resposta_no_celular' },
    });
    const vencida = await lerConversa();
    check('o dominio nao expoe pausa vencida', vencida?.aiPausedUntil === undefined);
    const aposVencer = await dispararELer(conta.id, caixa.id, conversa.id, contato.id);
    check('o corpo sai com agentePausado false', aposVencer.solint?.agentePausado === false);

    console.log('\n8) Token de API responde conversa SEM responsavel');
    const { rawSecret } = await container.settings.createApiToken(conta.id, {
      name: 'Agente n8n (teste)',
    });
    const sessao = await sessionFromApiToken(
      new Request('https://exemplo.test/api/v1/mensagens', {
        method: 'POST',
        headers: { authorization: `Bearer ${rawSecret}` },
      }),
    );
    if (!sessao) throw new Error('o token de teste nao abriu sessao');
    check('a sessao e de token', isApiTokenActor(sessao.user.id), sessao.user.id);

    const semDono = await prisma.conversation.findUnique({
      where: { id: conversa.id },
      select: { assigneeId: true },
    });
    check('a conversa comeca sem responsavel', semDono?.assigneeId === null);

    const enviada = await container.useCases.sendMessage({
      session: sessao,
      conversationId: conversa.id,
      text: 'resposta do agente',
      isPrivate: false,
    });
    check('o envio nao estourou', enviada.ok, enviada.ok ? '' : enviada.error.message);

    const aindaSemDono = await prisma.conversation.findUnique({
      where: { id: conversa.id },
      select: { assigneeId: true },
    });
    check(
      'o token NAO virou responsavel',
      aindaSemDono?.assigneeId === null,
      String(aindaSemDono?.assigneeId),
    );

    console.log('\n9) A mensagem do token fica marcada — base da supressao do eco');
    const gravada = await prisma.message.findFirst({
      where: {
        conversationId: conversa.id,
        content: { path: ['text'], equals: 'resposta do agente' },
      },
      select: { authorId: true },
    });
    check('authorId e de token', isApiTokenActor(gravada?.authorId), String(gravada?.authorId));
  } finally {
    // A conta leva caixa, contato, conversa, mensagens, webhooks e entregas.
    await prisma.account.delete({ where: { id: conta.id } }).catch(() => undefined);
  }
}

main()
  .then(async () => {
    console.log(
      falhas.length === 0
        ? '\nTodos os testes passaram.\n'
        : `\n${falhas.length} falha(s): ${falhas.join(', ')}\n`,
    );
    await prisma.$disconnect();
    process.exit(falhas.length === 0 ? 0 : 1);
  })
  .catch(async (erro) => {
    console.error('\nErro no teste:', erro);
    await prisma.$disconnect();
    process.exit(1);
  });
