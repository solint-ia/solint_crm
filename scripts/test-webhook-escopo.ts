/**
 * Teste do escopo por caixa de entrada dos webhooks da conta.
 *
 * O que ele prova é o motivo da mudança: um webhook restrito à caixa A **não
 * cria linha nenhuma na outbox** quando a mensagem vem da caixa B. Não é filtro
 * no destino nem entrega descartada depois — o evento nem chega a existir para
 * aquele webhook, e é isso que faz o n8n parar de executar à toa.
 *
 * A maior parte dos casos é conferida na outbox, e não no destino HTTP, de
 * propósito: a pergunta aqui é "esta entrega foi criada?", e ler a tabela
 * responde isso sem depender do relógio do entregador. Os dois casos que
 * precisam do caminho inteiro (o webhook desativado que não pode escoar a fila,
 * e a entrega que sobrevive à saída de quem a originou) sobem o entregador de
 * verdade contra um servidor local.
 *
 * Cria as próprias contas e caixas, e apaga tudo no fim — nenhum caso depende
 * do que já estava no banco.
 *
 *   npx tsx scripts/test-webhook-escopo.ts
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { ConflictError } from '../src/core/domain/shared';
import { container } from '../src/infrastructure/container';
import { prisma } from '../src/infrastructure/db/prisma';
import { WebhookDeliveryRunner } from '../src/infrastructure/webhooks/webhook-delivery-runner';
import { dispararWebhooks } from '../src/infrastructure/webhooks/webhook-dispatch';
import type {
  SolintRefs,
  WebhookPayloadEmMontagem,
} from '../src/infrastructure/webhooks/webhook-dispatch';

const ESPERA_MS = 20_000;

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const sufixo = randomUUID().slice(0, 8);
const id = (nome: string) => `escopo-${sufixo}-${nome}`;

let sequencia = 0;
/** Cada disparo com id próprio: a outbox deduplica por `evento:mensagemId`. */
const proximaMensagem = () => `msg-${sufixo}-${++sequencia}`;

const criarConta = async (nome: string) =>
  prisma.account.create({
    data: { id: id(nome), name: `Conta ${nome} (teste de escopo)`, plan: 'teste' },
    select: { id: true },
  });

const criarCaixa = async (accountId: string, nome: string) =>
  prisma.inbox.create({
    data: {
      id: id(nome),
      accountId,
      name: `Caixa ${nome}`,
      channel: 'whatsapp',
      identifier: `55799000000${sequencia}`,
      status: 'desconectado',
      provider: 'baileys',
      businessHours: {},
      awayMessage: {},
      greeting: {},
    },
    select: { id: true, name: true },
  });

/** Um corpo mínimo: o que interessa aqui é `solint`, e não o conteúdo. */
const payloadDe = (
  contaId: string,
  caixaId: string | undefined,
): WebhookPayloadEmMontagem => {
  const solint: SolintRefs = {
    contaId,
    ...(caixaId ? { caixaEntradaId: caixaId } : {}),
    conversaId: `cv-${sufixo}`,
    contatoId: `ct-${sufixo}`,
    mensagemId: proximaMensagem(),
    conversaNova: false,
  };
  return {
    event: 'messages.upsert',
    instance: 'Caixa de teste',
    data: {
      key: { remoteJid: '557999999999@s.whatsapp.net', fromMe: false, id: solint.mensagemId! },
      message: { conversation: 'evento de teste' },
      contextInfo: null,
      messageType: 'conversation',
      messageTimestamp: Math.floor(Date.now() / 1000),
      instanceId: caixaId ?? '',
      source: 'teste',
    },
    date_time: new Date().toISOString(),
    sender: '557988888888@s.whatsapp.net',
    solint,
  };
};

/** Ids dos webhooks para os quais a outbox guardou este evento. */
const entreguesPara = async (mensagemId: string): Promise<readonly string[]> => {
  const linhas = await prisma.webhookDelivery.findMany({
    where: { dedupeKey: `mensagem.recebida:${mensagemId}` },
    select: { webhookId: true },
  });
  return linhas.map((linha) => linha.webhookId).sort();
};

/** Dispara e devolve quais webhooks receberam linha na outbox. */
const dispararDe = async (contaId: string, caixaId: string | undefined) => {
  const payload = payloadDe(contaId, caixaId);
  await dispararWebhooks('mensagem.recebida', payload);
  return {
    mensagemId: payload.solint.mensagemId!,
    webhookIds: await entreguesPara(payload.solint.mensagemId!),
  };
};

async function main() {
  const contaA = await criarConta('conta-a');
  const contaB = await criarConta('conta-b');
  const caixaA = await criarCaixa(contaA.id, 'caixa-a');
  const caixaB = await criarCaixa(contaA.id, 'caixa-b');
  const caixaDaOutraConta = await criarCaixa(contaB.id, 'caixa-outra');

  const recebidos: string[] = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (parte) => (corpo += parte));
    req.on('end', () => {
      recebidos.push(corpo);
      res.writeHead(200).end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/destino`;

  const eventos = ['mensagem.recebida'];

  try {
    console.log('\n1) Webhook de todas as caixas recebe de A e de B');
    const todas = await container.settings.createWebhook(contaA.id, {
      name: 'Todas as caixas',
      url,
      events: eventos,
      allInboxes: true,
      inboxIds: [],
    });
    check('nasce sem vínculo de caixa', todas.inboxIds.length === 0);
    const deA = await dispararDe(contaA.id, caixaA.id);
    const deB = await dispararDe(contaA.id, caixaB.id);
    check('recebeu o evento da caixa A', deA.webhookIds.includes(todas.id));
    check('recebeu o evento da caixa B', deB.webhookIds.includes(todas.id));

    console.log('\n2) Webhook restrito à caixa A não cria entrega para a caixa B');
    const soA = await container.settings.createWebhook(contaA.id, {
      name: 'Somente a caixa A',
      url,
      events: eventos,
      allInboxes: false,
      inboxIds: [caixaA.id],
    });
    const outroDeA = await dispararDe(contaA.id, caixaA.id);
    const outroDeB = await dispararDe(contaA.id, caixaB.id);
    check('recebeu da caixa autorizada', outroDeA.webhookIds.includes(soA.id));
    check(
      'NAO gerou linha na outbox para a caixa B',
      !outroDeB.webhookIds.includes(soA.id),
      outroDeB.webhookIds.join(', '),
    );

    console.log('\n3) Dois webhooks com seleções diferentes não se cruzam');
    const soB = await container.settings.createWebhook(contaA.id, {
      name: 'Somente a caixa B',
      url,
      events: eventos,
      allInboxes: false,
      inboxIds: [caixaB.id],
    });
    const cruzadoA = await dispararDe(contaA.id, caixaA.id);
    const cruzadoB = await dispararDe(contaA.id, caixaB.id);
    check(
      'evento de A vai para "todas" e para "só A"',
      cruzadoA.webhookIds.join('|') === [todas.id, soA.id].sort().join('|'),
      cruzadoA.webhookIds.join(', '),
    );
    check(
      'evento de B vai para "todas" e para "só B"',
      cruzadoB.webhookIds.join('|') === [todas.id, soB.id].sort().join('|'),
      cruzadoB.webhookIds.join(', '),
    );

    console.log('\n4) Evento sem caixa só alcança quem vale para todas');
    const semCaixa = await dispararDe(contaA.id, undefined);
    check(
      'somente o webhook de todas as caixas',
      semCaixa.webhookIds.join('|') === todas.id,
      semCaixa.webhookIds.join(', '),
    );

    console.log('\n5) Caixa de outra conta é recusada');
    let recusouNaCriacao = false;
    try {
      await container.settings.createWebhook(contaA.id, {
        name: 'Caixa alheia',
        url,
        events: eventos,
        allInboxes: false,
        inboxIds: [caixaDaOutraConta.id],
      });
    } catch (erro) {
      recusouNaCriacao = erro instanceof ConflictError;
    }
    check('createWebhook recusa caixa de outra conta', recusouNaCriacao);

    let recusouNaEdicao = false;
    try {
      await container.settings.updateWebhookInboxes(contaA.id, soA.id, {
        allInboxes: false,
        inboxIds: [caixaA.id, caixaDaOutraConta.id],
      });
    } catch (erro) {
      recusouNaEdicao = erro instanceof ConflictError;
    }
    check('updateWebhookInboxes recusa caixa de outra conta', recusouNaEdicao);
    const intacto = await prisma.webhook.findUnique({
      where: { id: soA.id },
      select: { inboxes: { select: { inboxId: true } } },
    });
    check(
      'a recusa não deixou vínculo pela metade',
      intacto?.inboxes.map((link) => link.inboxId).join('|') === caixaA.id,
      intacto?.inboxes.map((link) => link.inboxId).join(', '),
    );

    console.log('\n6) Contas diferentes não cruzam eventos');
    const daOutraConta = await container.settings.createWebhook(contaB.id, {
      name: 'Webhook da outra conta',
      url,
      events: eventos,
      allInboxes: true,
      inboxIds: [],
    });
    const eventoDeA = await dispararDe(contaA.id, caixaA.id);
    const eventoDaOutra = await dispararDe(contaB.id, caixaDaOutraConta.id);
    check(
      'webhook da conta B não recebe evento da conta A',
      !eventoDeA.webhookIds.includes(daOutraConta.id),
    );
    check(
      'webhooks da conta A não recebem evento da conta B',
      !eventoDaOutra.webhookIds.some((webhookId) => [todas.id, soA.id, soB.id].includes(webhookId)),
      eventoDaOutra.webhookIds.join(', '),
    );

    console.log('\n7) Repetir o mesmo evento continua deduplicado');
    const repetido = payloadDe(contaA.id, caixaA.id);
    await dispararWebhooks('mensagem.recebida', repetido);
    await dispararWebhooks('mensagem.recebida', repetido);
    const linhasRepetidas = await prisma.webhookDelivery.count({
      where: { webhookId: todas.id, dedupeKey: `mensagem.recebida:${repetido.solint.mensagemId}` },
    });
    check('uma linha só para o mesmo evento', linhasRepetidas === 1, String(linhasRepetidas));

    console.log('\n8) Restringir o escopo cancela as pendências incompatíveis');
    const pendentesAntes = await prisma.webhookDelivery.count({
      where: { webhookId: todas.id, status: 'pending' },
    });
    const mudanca = await container.settings.updateWebhookInboxes(contaA.id, todas.id, {
      allInboxes: false,
      inboxIds: [caixaA.id],
    });
    check('a caixa A entrou no registro da mudança', mudanca.added.join('|') === caixaA.id);
    check('o escopo passou a ser seletivo', mudanca.webhook.allInboxes === false);
    check(
      'pelo menos uma pendência foi cancelada',
      mudanca.canceledDeliveries > 0,
      `${mudanca.canceledDeliveries} de ${pendentesAntes}`,
    );
    const sobrouDeOutraCaixa = await prisma.webhookDelivery.count({
      where: {
        webhookId: todas.id,
        status: 'pending',
        OR: [{ inboxId: null }, { inboxId: { not: caixaA.id } }],
      },
    });
    check('nenhuma pendência de caixa não autorizada sobrou', sobrouDeOutraCaixa === 0);
    const canceladas = await prisma.webhookDelivery.findFirst({
      where: { webhookId: todas.id, status: 'canceled' },
      select: { attempts: true },
    });
    check('cancelamento não conta como tentativa', canceladas?.attempts === 0);

    console.log('\n9) Webhook desativado não escoa o que estava na fila');
    await dispararDe(contaA.id, caixaA.id);
    const pendenteDoSoA = await prisma.webhookDelivery.count({
      where: { webhookId: soA.id, status: 'pending' },
    });
    check('havia o que entregar', pendenteDoSoA > 0, String(pendenteDoSoA));
    await container.settings.toggleWebhook(contaA.id, soA.id, false);
    const aindaPendente = await prisma.webhookDelivery.count({
      where: { webhookId: soA.id, status: 'pending' },
    });
    check('a fila do webhook desativado foi cancelada', aindaPendente === 0, String(aindaPendente));

    // O entregador continua escoando a fila dos **outros** webhooks, e é por
    // isso que a conferência é por webhook e não por "nada chegou": contar as
    // chamadas do servidor acusaria falha justamente onde o resto funciona.
    const runner = new WebhookDeliveryRunner('teste-escopo');
    runner.start();
    await dormir(2_000);
    const escoou = await prisma.webhookDelivery.count({
      where: { webhookId: soA.id, status: 'delivered' },
    });
    check('nada do webhook desativado foi entregue', escoou === 0, String(escoou));

    console.log('\n10) A entrega não depende de quem a originou continuar por perto');
    // Nada aqui simula um navegador porque nada no caminho o envolve: a
    // requisição que originou o evento já respondeu antes de a fila ser lida.
    await container.settings.toggleWebhook(contaA.id, soA.id, true);
    recebidos.length = 0;
    await dispararDe(contaA.id, caixaA.id);
    const limite = Date.now() + ESPERA_MS;
    while (recebidos.length === 0 && Date.now() < limite) await dormir(100);
    check('o destino recebeu pela outbox', recebidos.length > 0, `${recebidos.length}`);
    await runner.stop();

    console.log('\n11) Excluir a última caixa selecionada desativa o webhook');
    const soParaB = await container.settings.createWebhook(contaA.id, {
      name: 'Vai ficar sem caixa',
      url,
      events: eventos,
      allInboxes: false,
      inboxIds: [caixaB.id],
    });
    const comDuas = await container.settings.createWebhook(contaA.id, {
      name: 'Sobra uma caixa',
      url,
      events: eventos,
      allInboxes: false,
      inboxIds: [caixaA.id, caixaB.id],
    });
    await container.settings.deleteInbox(contaA.id, caixaB.id, caixaB.name);

    const orfao = await prisma.webhook.findUnique({
      where: { id: soParaB.id },
      select: { isActive: true, inboxes: { select: { inboxId: true } } },
    });
    check('o vínculo saiu junto com a caixa', orfao?.inboxes.length === 0);
    check('o webhook sem nenhuma caixa foi desativado', orfao?.isActive === false);

    const sobrevivente = await prisma.webhook.findUnique({
      where: { id: comDuas.id },
      select: { isActive: true, inboxes: { select: { inboxId: true } } },
    });
    check(
      'quem ainda tem outra caixa continua ativo',
      sobrevivente?.isActive === true &&
        sobrevivente.inboxes.map((link) => link.inboxId).join('|') === caixaA.id,
      sobrevivente?.inboxes.map((link) => link.inboxId).join(', '),
    );
  } finally {
    servidor.close();
    // As contas levam webhooks, caixas, vínculos e entregas por cascata.
    await prisma.account
      .deleteMany({ where: { id: { in: [contaA.id, contaB.id] } } })
      .catch(() => undefined);
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
