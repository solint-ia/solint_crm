/**
 * Teste das correções da varredura do worker que rodam sem WhatsApp.
 *
 * Cada seção tranca um defeito que existia e passava calado:
 *
 *  1. a consulta do Prisma é preguiçosa: `void prisma.x.updateMany()` sem
 *     `then`/`catch` nunca chega ao banco. Era a renovação do lease dos envios
 *     agendados. A seção prova a premissa contra o banco de verdade;
 *  2. resposta definitiva do destino (404, 410) encerra a entrega na primeira e
 *     solta a fila do webhook; 429 e 5xx seguem com recuo;
 *  3. a retenção apaga só o que está encerrado e velho — nunca o pendente;
 *  4. apagar credenciais exige a posse da sessão (dono **e** versão da trava);
 *  5. um pedido de conexão diferente substitui o pendente em vez de sumir, e
 *     "Desconectar" grava a intenção antes do comando.
 *
 * A seção 5 simula a batida do worker, então **não pode** rodar com um worker
 * de verdade no ar: ele executaria os `connect` e abriria socket no WhatsApp.
 * O teste confere isso antes e pula a seção se ouvir um worker.
 *
 *   npx tsx scripts/test-varredura-worker.ts
 */
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { prisma } from '../src/infrastructure/db/prisma';
import { wipeAuthState } from '../src/infrastructure/whatsapp/auth/postgres-auth-state';
import { QueueWhatsAppChannel } from '../src/infrastructure/whatsapp/queue-channel';
import { publishWorkerBeat, waitForWorker } from '../src/infrastructure/whatsapp/worker-presence';
import { WebhookDeliveryRunner } from '../src/infrastructure/webhooks/webhook-delivery-runner';
import {
  EntregaWebhookError,
  dispararWebhooks,
  type WebhookPayloadEmMontagem,
} from '../src/infrastructure/webhooks/webhook-dispatch';
import { WebhookRetentionRunner } from '../src/infrastructure/webhooks/webhook-retention-runner';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DIA = 86_400_000;
const atras = (dias: number) => new Date(Date.now() - dias * DIA);

const sufixo = randomUUID().slice(0, 8);
const CONTA = `acc-varredura-${sufixo}`;
const CAIXA = `ibx-varredura-${sufixo}`;
const CAIXA_VIZINHA = `ibx-vizinha-${sufixo}`;

const esperar = async (condicao: () => Promise<boolean>, prazoMs: number): Promise<boolean> => {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    if (await condicao()) return true;
    await sleep(250);
  }
  return condicao();
};

const criarCaixa = (id: string) =>
  prisma.inbox.create({
    data: {
      id,
      accountId: CONTA,
      name: id,
      channel: 'whatsapp',
      identifier: id,
      status: 'desconectado',
      provider: 'baileys',
      businessHours: {},
      greeting: {},
    },
  });

async function premissaDoPrisma() {
  console.log('\n1) Premissa: a consulta do Prisma só executa quando alguém a assina');
  const nome = `teste-preguica-${sufixo}`;
  await prisma.backgroundLease.create({
    data: { name: nome, owner: 'original', leaseUntil: new Date(Date.now() + 60_000) },
  });
  try {
    void prisma.backgroundLease.updateMany({ where: { name: nome }, data: { owner: 'so-void' } });
    await sleep(600);
    const depoisDoVoid = await prisma.backgroundLease.findUnique({ where: { name: nome } });
    check('com `void` sozinho nada chega ao banco', depoisDoVoid?.owner === 'original', depoisDoVoid?.owner);

    void prisma.backgroundLease
      .updateMany({ where: { name: nome }, data: { owner: 'com-catch' } })
      .catch(() => undefined);
    await sleep(600);
    const depoisDoCatch = await prisma.backgroundLease.findUnique({ where: { name: nome } });
    check('com `.catch` a escrita acontece', depoisDoCatch?.owner === 'com-catch', depoisDoCatch?.owner);
  } finally {
    await prisma.backgroundLease.deleteMany({ where: { name: nome } });
  }
}

function classificacaoHttp() {
  console.log('\n2a) Classificação da resposta do destino');
  for (const status of [400, 401, 403, 404, 410, 413, 422]) {
    check(`${status} é definitiva`, new EntregaWebhookError(status).permanente);
  }
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    check(`${status} é temporária`, !new EntregaWebhookError(status).permanente);
  }
}

async function entregasContraDestinoReal() {
  console.log('\n2b) Entregador contra um destino local');
  const recebidos = new Map<string, number>();
  const servidor = http.createServer((req, res) => {
    const caminho = req.url ?? '/';
    recebidos.set(caminho, (recebidos.get(caminho) ?? 0) + 1);
    req.resume();
    req.on('end', () => {
      const status = caminho === '/ok' ? 200 : Number(caminho.slice(1));
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const porta = (servidor.address() as AddressInfo).port;

  const destinos = ['404', '410', '429', '503', 'ok'] as const;
  const webhooks = new Map<string, string>();
  for (const destino of destinos) {
    const criado = await prisma.webhook.create({
      data: {
        accountId: CONTA,
        name: `destino ${destino}`,
        url: `http://127.0.0.1:${porta}/${destino}`,
        events: ['mensagem.recebida'],
        isActive: true,
        allInboxes: true,
      },
      select: { id: true },
    });
    webhooks.set(destino, criado.id);
  }

  const disparar = (mensagemId: string) => {
    const payload: WebhookPayloadEmMontagem = {
      event: 'messages.upsert',
      instance: 'Caixa da varredura',
      data: {
        key: { remoteJid: '5599900000003@s.whatsapp.net', fromMe: false, id: mensagemId },
        message: { conversation: 'oi' },
        contextInfo: null,
        messageType: 'conversation',
        messageTimestamp: Math.floor(Date.now() / 1000),
        instanceId: CAIXA,
        source: 'teste',
      },
      date_time: new Date().toISOString(),
      sender: '5579988888888@s.whatsapp.net',
      solint: {
        contaId: CONTA,
        caixaEntradaId: CAIXA,
        conversaId: 'cv-inexistente',
        contatoId: 'ct-inexistente',
        mensagemId,
        conversaNova: false,
      },
    };
    return dispararWebhooks('mensagem.recebida', payload, { throwOnError: true });
  };
  await disparar(`m1-${sufixo}`);
  await disparar(`m2-${sufixo}`);

  const linha = (destino: string, mensagem: string) =>
    prisma.webhookDelivery.findFirst({
      where: { webhookId: webhooks.get(destino), dedupeKey: `mensagem.recebida:${mensagem}-${sufixo}` },
      select: { status: true, attempts: true, availableAt: true, lastError: true },
    });

  const runner = new WebhookDeliveryRunner(`teste-${sufixo}`);
  runner.start();
  try {
    const assentou = await esperar(async () => {
      const [a, b, c, d, e, f, g] = await Promise.all([
        linha('404', 'm2'),
        linha('410', 'm2'),
        linha('ok', 'm2'),
        linha('429', 'm1'),
        linha('503', 'm1'),
        linha('404', 'm1'),
        linha('410', 'm1'),
      ]);
      return (
        a?.status === 'failed' &&
        b?.status === 'failed' &&
        c?.status === 'delivered' &&
        (d?.attempts ?? 0) >= 1 &&
        (e?.attempts ?? 0) >= 1 &&
        f?.status === 'failed' &&
        g?.status === 'failed'
      );
    }, 20_000);
    check('as entregas assentaram em até 20s', assentou);

    for (const destino of ['404', '410']) {
      const m1 = await linha(destino, 'm1');
      const m2 = await linha(destino, 'm2');
      check(`${destino}: a primeira falha na primeira tentativa`, m1?.status === 'failed' && m1.attempts === 1, `${m1?.status}/${m1?.attempts}`);
      check(`${destino}: a seguinte não fica presa atrás dela`, m2?.status === 'failed' && m2.attempts === 1, `${m2?.status}/${m2?.attempts}`);
      check(`${destino}: o destino foi chamado uma vez por entrega`, recebidos.get(`/${destino}`) === 2, `${recebidos.get(`/${destino}`)}`);
      check(`${destino}: o motivo fica registrado`, m1?.lastError === `destino respondeu ${destino}`, m1?.lastError ?? '-');
    }
    for (const destino of ['429', '503']) {
      const m1 = await linha(destino, 'm1');
      const m2 = await linha(destino, 'm2');
      check(`${destino}: volta para a fila`, m1?.status === 'pending' && m1.attempts === 1, `${m1?.status}/${m1?.attempts}`);
      check(
        `${destino}: com recuo (próxima tentativa no futuro)`,
        (m1?.availableAt.getTime() ?? 0) > Date.now(),
        m1 ? `${Math.round((m1.availableAt.getTime() - Date.now()) / 1000)}s` : '-',
      );
      check(`${destino}: a seguinte espera a ordem`, m2?.status === 'pending' && m2.attempts === 0, `${m2?.status}/${m2?.attempts}`);
    }
    const ok1 = await linha('ok', 'm1');
    const ok2 = await linha('ok', 'm2');
    check('200: as duas entregues', ok1?.status === 'delivered' && ok2?.status === 'delivered');
  } finally {
    await runner.stop();
    servidor.close();
  }
}

async function retencao() {
  console.log('\n3) Retenção das filas de webhook');
  const webhook = await prisma.webhook.create({
    data: { accountId: CONTA, name: 'retenção', url: 'http://127.0.0.1:1/x', events: [], isActive: false, allInboxes: true },
    select: { id: true },
  });
  const fonte = (nome: string, status: string, dias: number) => ({
    accountId: CONTA,
    event: 'mensagem.recebida',
    payload: {},
    dedupeKey: `ret-${sufixo}-${nome}`,
    status,
    createdAt: atras(dias),
  });
  await prisma.webhookEventOutbox.createMany({
    data: [
      fonte('fonte-concluida-velha', 'completed', 2),
      fonte('fonte-concluida-nova', 'completed', 0.1),
      fonte('fonte-falha-velha', 'failed', 8),
      fonte('fonte-falha-nova', 'failed', 6),
      fonte('fonte-pendente-velha', 'pending', 30),
    ],
  });
  const entrega = (nome: string, status: string, dias: number) => ({
    webhookId: webhook.id,
    accountId: CONTA,
    event: 'mensagem.recebida',
    payload: {},
    dedupeKey: `ret-${sufixo}-${nome}`,
    status,
    createdAt: atras(dias),
  });
  await prisma.webhookDelivery.createMany({
    data: [
      entrega('entregue-velha', 'delivered', 4),
      entrega('entregue-nova', 'delivered', 2),
      entrega('cancelada-velha', 'canceled', 4),
      entrega('falha-velha', 'failed', 15),
      entrega('falha-nova', 'failed', 13),
      entrega('pendente-velha', 'pending', 30),
      entrega('processando-velha', 'processing', 30),
    ],
  });

  const runner = new WebhookRetentionRunner(`teste-${sufixo}`);
  await (runner as unknown as { tick(): Promise<void> }).tick();

  const sobrou = async (tabela: 'fonte' | 'entrega', nome: string) =>
    tabela === 'fonte'
      ? (await prisma.webhookEventOutbox.count({ where: { dedupeKey: `ret-${sufixo}-${nome}` } })) === 1
      : (await prisma.webhookDelivery.count({ where: { webhookId: webhook.id, dedupeKey: `ret-${sufixo}-${nome}` } })) === 1;

  check('evento-fonte concluído há 2 dias: apagado', !(await sobrou('fonte', 'fonte-concluida-velha')));
  check('evento-fonte concluído há 2h: fica', await sobrou('fonte', 'fonte-concluida-nova'));
  check('evento-fonte falho há 8 dias: apagado', !(await sobrou('fonte', 'fonte-falha-velha')));
  check('evento-fonte falho há 6 dias: fica', await sobrou('fonte', 'fonte-falha-nova'));
  check('evento-fonte pendente de 30 dias: fica', await sobrou('fonte', 'fonte-pendente-velha'));
  check('entrega concluída há 4 dias: apagada', !(await sobrou('entrega', 'entregue-velha')));
  check('entrega concluída há 2 dias: fica', await sobrou('entrega', 'entregue-nova'));
  check('entrega cancelada há 4 dias: apagada', !(await sobrou('entrega', 'cancelada-velha')));
  check('entrega falha há 15 dias: apagada', !(await sobrou('entrega', 'falha-velha')));
  check('entrega falha há 13 dias: fica', await sobrou('entrega', 'falha-nova'));
  check('entrega pendente de 30 dias: fica', await sobrou('entrega', 'pendente-velha'));
  check('entrega em processamento: fica', await sobrou('entrega', 'processando-velha'));
  const lease = await prisma.backgroundLease.findUnique({ where: { name: 'webhook-retention' } });
  check('a trava da retenção é devolvida no fim', lease === null, lease ? lease.owner : '');

  await prisma.webhookEventOutbox.deleteMany({ where: { dedupeKey: { startsWith: `ret-${sufixo}-` } } });
}

async function apagarCredenciais() {
  console.log('\n4) Apagar credenciais exige a posse da sessão');
  const bytes = () => randomBytes(16);
  for (const inboxId of [CAIXA, CAIXA_VIZINHA]) {
    await prisma.whatsAppConnection.create({
      data: {
        inboxId,
        status: 'desconectado',
        credsCipher: bytes(),
        credsIv: bytes(),
        credsTag: bytes(),
        credsKeyId: 'chave-teste',
        lockOwner: 'worker-dono',
        lockVersion: 5,
        lockExpiresAt: new Date(Date.now() + 30_000),
      },
    });
    await prisma.whatsAppKey.createMany({
      data: ['a', 'b', 'c'].map((keyId) => ({
        inboxId,
        category: 'session',
        keyId,
        valueCipher: bytes(),
        valueIv: bytes(),
        valueTag: bytes(),
      })),
    });
  }

  const estado = async (inboxId: string) => {
    const conexao = await prisma.whatsAppConnection.findUnique({
      where: { inboxId },
      select: { credsCipher: true, credsIv: true, credsTag: true, credsKeyId: true },
    });
    const chaves = await prisma.whatsAppKey.count({ where: { inboxId } });
    return {
      temCreds: Boolean(conexao?.credsCipher || conexao?.credsIv || conexao?.credsTag || conexao?.credsKeyId),
      chaves,
    };
  };

  check('outro dono: recusa', !(await wipeAuthState(CAIXA, { workerId: 'worker-intruso', lockVersion: 5 })));
  check('versão vencida da trava: recusa', !(await wipeAuthState(CAIXA, { workerId: 'worker-dono', lockVersion: 4 })));
  const intacto = await estado(CAIXA);
  check('recusado, nada foi apagado', intacto.temCreds && intacto.chaves === 3, JSON.stringify(intacto));

  check('dono e versão certos: apaga', await wipeAuthState(CAIXA, { workerId: 'worker-dono', lockVersion: 5 }));
  const apagado = await estado(CAIXA);
  check('credenciais e id da chave zerados', !apagado.temCreds);
  check('chaves da caixa removidas', apagado.chaves === 0, `${apagado.chaves}`);
  const vizinha = await estado(CAIXA_VIZINHA);
  check('a caixa vizinha não foi tocada', vizinha.temCreds && vizinha.chaves === 3, JSON.stringify(vizinha));
}

async function pedidosDeConexao() {
  console.log('\n5) Pedidos de conexão e a intenção de "Desconectar"');
  if (await waitForWorker(6_500)) {
    console.log('  PULADO  há um worker de verdade no ar; ele executaria os `connect`.');
    return;
  }
  // Batida simulada: `startSession` recusa sem worker. Ninguém consome a fila.
  void publishWorkerBeat('worker-simulado-do-teste');
  const batida = setInterval(() => void publishWorkerBeat('worker-simulado-do-teste'), 1_000);
  try {
    await prisma.whatsAppConnection.update({
      where: { inboxId: CAIXA },
      data: { autoConnect: false, lockOwner: null, lockExpiresAt: null },
    });
    const canal = new QueueWhatsAppChannel();
    const dono = { userId: 'usr-teste', userName: 'Atendente de Teste', accountId: CONTA };
    const connects = () =>
      prisma.whatsAppCommand.findMany({
        where: { inboxId: CAIXA, kind: 'connect' },
        orderBy: { sequence: 'asc' },
        select: { id: true, status: true, error: true, payload: true },
      });

    await canal.startSession(dono, { inboxId: CAIXA });
    const conexao = await prisma.whatsAppConnection.findUnique({
      where: { inboxId: CAIXA },
      select: { autoConnect: true, status: true },
    });
    check('"Conectar" liga a intenção de novo', conexao?.autoConnect === true);
    check('e marca a caixa como conectando', conexao?.status === 'conectando', conexao?.status);

    await canal.startSession(dono, { inboxId: CAIXA });
    const repetido = await connects();
    check('o mesmo pedido reaproveita o da fila', repetido.length === 1, `${repetido.length}`);

    // Outra janela de histórico é um pedido diferente.
    await canal.startSession(dono, { inboxId: CAIXA, historyDays: 7 });
    const trocado = await connects();
    check('pedido diferente cria outro comando', trocado.length === 2, `${trocado.length}`);
    check(
      'o anterior é encerrado com motivo',
      trocado[0]?.status === 'failed' && trocado[0].error === 'Substituído por um novo pedido de conexão.',
      `${trocado[0]?.status}: ${trocado[0]?.error}`,
    );
    const novo = (trocado[1]?.payload ?? {}) as { pairingMethod?: string; phoneNumber?: string };
    check('o novo leva o método e o número', novo.pairingMethod === 'phone' && novo.phoneNumber === '5579999999999');

    await canal.disconnect(CONTA, CAIXA);
    const depois = await prisma.whatsAppConnection.findUnique({
      where: { inboxId: CAIXA },
      select: { autoConnect: true },
    });
    const desconectar = await prisma.whatsAppCommand.count({
      where: { inboxId: CAIXA, kind: 'disconnect', status: 'pending' },
    });
    check('"Desconectar" desliga a intenção na hora', depois?.autoConnect === false);
    check('e enfileira o comando para o worker', desconectar === 1, `${desconectar}`);
  } finally {
    clearInterval(batida);
  }
}

async function main() {
  await premissaDoPrisma();
  classificacaoHttp();

  await prisma.account.create({ data: { id: CONTA, name: `Varredura ${sufixo}`, plan: 'teste' } });
  try {
    await criarCaixa(CAIXA);
    await criarCaixa(CAIXA_VIZINHA);
    await entregasContraDestinoReal();
    await retencao();
    await apagarCredenciais();
    await pedidosDeConexao();
  } finally {
    // A conta leva caixas, conexões, chaves, comandos, webhooks e entregas.
    await prisma.account.delete({ where: { id: CONTA } }).catch(() => {
      console.error(`\n  Atenção: a conta de teste ${CONTA} não pôde ser removida.`);
    });
  }
}

main()
  .then(async () => {
    console.log(
      falhas.length === 0
        ? '\nTodos os testes passaram.\n'
        : `\n${falhas.length} teste(s) falharam: ${falhas.join(', ')}\n`,
    );
    await prisma.$disconnect();
    process.exit(falhas.length === 0 ? 0 : 1);
  })
  .catch(async (erro) => {
    console.error('\nErro no teste:', erro);
    await prisma.$disconnect();
    process.exit(1);
  });
