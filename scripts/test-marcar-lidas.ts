/**
 * Teste do "marcar todas como lidas".
 *
 * O que ele prova, em ordem de importância:
 *
 *  1. a leitura em lote só zera **até a contagem que a tela mostrava** — a
 *     mensagem que chega no meio do clique continua não lida, em vez de sumir
 *     numa leitura que ninguém fez;
 *  2. o recorte por conta e por caixa vale no `WHERE`: id de outra equipe ou de
 *     outra conta não é zerado nem aparece na resposta;
 *  3. os avisos do sininho das conversas lidas se apagam — só os da pessoa e os
 *     da conta inteira, sem confundir `/conversas/x-1` com `/conversas/x-10`;
 *  4. o anúncio em tempo real sai em fatias que cabem no `NOTIFY`;
 *  5. a confirmação no WhatsApp vira **um** comando por caixa, e o worker
 *     percorre o lote parando se a sessão cair;
 *  6. a Server Action amarra tudo isso, com permissão e validação.
 *
 * Roda contra um banco descartável, dentro de contas criadas e apagadas aqui.
 * As seções que enfileiram comandos simulam a batida do worker e são puladas
 * se houver um worker de verdade ligado ao banco.
 *
 *   npx tsx scripts/test-marcar-lidas.ts
 */
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

// Só o tipo: carregar a action de verdade exige trocar `server-only` antes (seção 6).
import type * as Acoes from '../src/app/(workspace)/conversas/actions';
import { defaultBusinessHours } from '../src/core/domain/business-hours';
import { MARK_READ_BATCH_LIMIT } from '../src/core/domain/conversation';
import type { Session } from '../src/core/domain/user';
import { container } from '../src/infrastructure/container';
import { CHANNELS } from '../src/infrastructure/db/postgres-pubsub';
import { asJson, prisma } from '../src/infrastructure/db/prisma';
import { QueueWhatsAppChannel } from '../src/infrastructure/whatsapp/queue-channel';
import { CommandConsumer } from '../src/infrastructure/whatsapp/worker/command-consumer';
import { publishWorkerBeat, waitForWorker } from '../src/infrastructure/whatsapp/worker-presence';
import {
  waEventBus,
  type ConversationEventPayload,
} from '../src/infrastructure/whatsapp/whatsapp-events';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const esperarAte = async (condicao: () => boolean, prazoMs: number) => {
  const fim = Date.now() + prazoMs;
  while (!condicao() && Date.now() < fim) await esperar(100);
};

const sufixo = randomUUID().slice(0, 8);
const CONTA = `acc-lidas-${sufixo}`;
const OUTRA_CONTA = `acc-lidas-outra-${sufixo}`;
const CAIXA_A = `ibx-lidas-a-${sufixo}`;
const CAIXA_B = `ibx-lidas-b-${sufixo}`;
const CAIXA_OUTRA = `ibx-lidas-o-${sufixo}`;
const CONTATO = `ct-lidas-${sufixo}`;
const CONTATO_OUTRO = `ct-lidas-o-${sufixo}`;
const USUARIO = `usr-lidas-${sufixo}`;
const COLEGA = `usr-lidas-colega-${sufixo}`;
const WORKER_SIMULADO = `worker-simulado-lidas-${sufixo}`;
const cv = (nome: string) => `cv-lidas-${sufixo}-${nome}`;
const ntf = (nome: string) => `ntf-lidas-${sufixo}-${nome}`;

const criarCaixa = (accountId: string, id: string, nome: string) =>
  prisma.inbox.create({
    data: {
      id,
      accountId,
      name: nome,
      channel: 'whatsapp',
      identifier: `${nome} ${sufixo}`,
      status: 'conectado',
      provider: 'baileys',
      businessHours: asJson(defaultBusinessHours()),
      awayMessage: asJson({}),
      greeting: asJson({ enabled: false, message: '' }),
    },
  });

const criarConversa = (
  accountId: string,
  contactId: string,
  inboxId: string,
  id: string,
  unreadCount: number,
) =>
  prisma.conversation.create({
    data: {
      id,
      accountId,
      contactId,
      channel: 'whatsapp',
      inboxId,
      queue: 'Atendimento',
      status: 'aberta',
      statusLabel: 'Aberta',
      unreadCount,
    },
  });

const naoLidas = async (id: string) =>
  (await prisma.conversation.findUnique({ where: { id }, select: { unreadCount: true } }))
    ?.unreadCount;

const definir = (id: string, unreadCount: number) =>
  prisma.conversation.update({ where: { id }, data: { unreadCount } });

const avisoLido = async (nome: string) =>
  (await prisma.notification.findUnique({ where: { id: ntf(nome) }, select: { read: true } }))
    ?.read;

/** Grava o que o barramento emite, sem abrir `LISTEN` nenhum. */
const espiarBarramento = () => {
  const emitidos: ConversationEventPayload[] = [];
  const original = waEventBus.emitConversation.bind(waEventBus);
  waEventBus.emitConversation = (payload) => {
    emitidos.push(payload);
    original(payload);
  };
  const soltar = () => {
    // Apagar a propriedade da instância devolve o método do protótipo.
    delete (waEventBus as { emitConversation?: unknown }).emitConversation;
  };
  return { emitidos, soltar };
};

const idsDoPayload = (payload: unknown) =>
  [...(((payload ?? {}) as { conversationIds?: string[] }).conversationIds ?? [])].sort().join();

async function repositorio() {
  console.log('\n1) Repositório: zera só até onde a tela viu');
  await criarConversa(CONTA, CONTATO, CAIXA_A, cv('1'), 3);
  await criarConversa(CONTA, CONTATO, CAIXA_A, cv('2'), 1);
  await criarConversa(CONTA, CONTATO, CAIXA_A, cv('3'), 0);
  await criarConversa(CONTA, CONTATO, CAIXA_B, cv('4'), 2);
  // A tela mostrava 5; a sexta mensagem chegou enquanto a pessoa clicava.
  await criarConversa(CONTA, CONTATO, CAIXA_A, cv('5'), 6);
  await criarConversa(OUTRA_CONTA, CONTATO_OUTRO, CAIXA_OUTRA, cv('outra'), 4);

  const r = await container.conversations.markManyAsRead(
    CONTA,
    [
      { conversationId: cv('1'), unreadCount: 3 },
      { conversationId: cv('2'), unreadCount: 1 },
      { conversationId: cv('2'), unreadCount: 1 },
      { conversationId: cv('3'), unreadCount: 1 },
      { conversationId: cv('4'), unreadCount: 2 },
      { conversationId: cv('5'), unreadCount: 5 },
      { conversationId: cv('outra'), unreadCount: 4 },
    ],
    'todas',
  );

  const marcadas = new Set(r.marked.map((m) => m.id));
  check(
    'zera as vistas com a contagem certa (1, 2 e 4)',
    marcadas.size === 3 && [cv('1'), cv('2'), cv('4')].every((id) => marcadas.has(id)),
    [...marcadas].join(', '),
  );
  check(
    'devolve a caixa e o canal de cada uma',
    r.marked.find((m) => m.id === cv('4'))?.inboxId === CAIXA_B &&
      r.marked.find((m) => m.id === cv('1'))?.inboxId === CAIXA_A &&
      r.marked.every((m) => m.channel === 'whatsapp'),
  );
  check(
    'no banco, 1, 2 e 4 ficaram em zero',
    (await naoLidas(cv('1'))) === 0 &&
      (await naoLidas(cv('2'))) === 0 &&
      (await naoLidas(cv('4'))) === 0,
  );
  check(
    'a mensagem que chegou depois do clique continua não lida',
    (await naoLidas(cv('5'))) === 6,
    `${await naoLidas(cv('5'))}`,
  );
  check(
    'e volta em "remaining" com a contagem atual',
    r.remaining.length === 1 &&
      r.remaining[0]?.conversationId === cv('5') &&
      r.remaining[0]?.unreadCount === 6,
    JSON.stringify(r.remaining),
  );
  check(
    'conversa que já estava lida não entra em nada',
    !marcadas.has(cv('3')) && !r.remaining.some((x) => x.conversationId === cv('3')),
  );
  check(
    'conversa de outra conta não é tocada',
    (await naoLidas(cv('outra'))) === 4 && !marcadas.has(cv('outra')),
  );
  check('nem aparece na resposta', !r.remaining.some((x) => x.conversationId === cv('outra')));

  console.log('\n   recorte por caixa');
  await definir(cv('1'), 2);
  await definir(cv('4'), 2);
  const soA = await container.conversations.markManyAsRead(
    CONTA,
    [
      { conversationId: cv('1'), unreadCount: 2 },
      { conversationId: cv('4'), unreadCount: 2 },
    ],
    [CAIXA_A],
  );
  check(
    'quem só alcança a caixa A zera só a da A',
    soA.marked.length === 1 && soA.marked[0]?.id === cv('1'),
    soA.marked.map((m) => m.id).join(', '),
  );
  check('a da caixa B continua não lida', (await naoLidas(cv('4'))) === 2);
  check('e não vaza em "remaining"', soA.remaining.length === 0, JSON.stringify(soA.remaining));

  const semEquipe = await container.conversations.markManyAsRead(
    CONTA,
    [{ conversationId: cv('4'), unreadCount: 2 }],
    [],
  );
  check(
    'sem equipe nenhuma, nada é zerado',
    semEquipe.marked.length === 0 && (await naoLidas(cv('4'))) === 2,
  );
  const vazio = await container.conversations.markManyAsRead(CONTA, [], 'todas');
  check('lista vazia não escreve nada', vazio.marked.length === 0 && vazio.remaining.length === 0);

  console.log('\n   muitas contagens diferentes numa chamada');
  const muitas = Array.from({ length: 25 }, (_, i) => ({
    conversationId: cv(`m${i}`),
    unreadCount: i + 1,
  }));
  for (const { conversationId, unreadCount } of muitas) {
    await criarConversa(CONTA, CONTATO, CAIXA_A, conversationId, unreadCount);
  }
  const lote = await container.conversations.markManyAsRead(CONTA, muitas, 'todas');
  const aindaNaoLidas = await prisma.conversation.count({
    where: { id: { in: muitas.map((m) => m.conversationId) }, unreadCount: { gt: 0 } },
  });
  check(
    '25 contagens distintas zeradas de uma vez',
    lote.marked.length === 25 && aindaNaoLidas === 0,
    `${lote.marked.length} marcadas, ${aindaNaoLidas} ainda não lidas`,
  );
}

async function avisos() {
  console.log('\n2) Avisos do sininho');
  const aviso = (nome: string, userId: string | null, href: string | null) =>
    prisma.notification.create({
      data: {
        id: ntf(nome),
        accountId: CONTA,
        userId,
        kind: 'mensagem',
        text: 'teste',
        timeLabel: '10:00',
        href,
      },
    });
  await aviso('meu', USUARIO, `/conversas/${cv('1')}`);
  await aviso('conta', null, `/conversas/${cv('2')}?origem=sininho`);
  await aviso('colega', COLEGA, `/conversas/${cv('1')}`);
  await aviso('outra-conversa', USUARIO, `/conversas/${cv('3')}`);
  // `cv('1')` + "0" é `cv('10')`: o prefixo casaria, o id não.
  await aviso('prefixo', USUARIO, `/conversas/${cv('1')}0`);
  await aviso('contato', USUARIO, `/contatos/${cv('1')}`);
  await aviso('sem-link', USUARIO, null);

  await container.notifications.markConversationsAsRead(CONTA, USUARIO, [cv('1'), cv('2')]);

  check('o aviso da pessoa sobre a conversa lida se apaga', (await avisoLido('meu')) === true);
  check(
    'o aviso da conta inteira também, mesmo com parâmetros no link',
    (await avisoLido('conta')) === true,
  );
  check('o do colega continua aceso', (await avisoLido('colega')) === false);
  check('o de outra conversa continua aceso', (await avisoLido('outra-conversa')) === false);
  check('"x-10" não é confundido com "x-1"', (await avisoLido('prefixo')) === false);
  check(
    'link que não é de conversa fica como estava',
    (await avisoLido('contato')) === false && (await avisoLido('sem-link')) === false,
  );
}

async function tempoReal() {
  console.log('\n3) Anúncio em tempo real');
  // Uma conexão à parte: o `postgresPubSub` deste processo descarta o próprio
  // eco nos canais de evento, então só um ouvinte de fora enxerga o que foi ao fio.
  const ouvinte = new Client({ connectionString: process.env.DATABASE_URL });
  await ouvinte.connect();
  const noFio: ConversationEventPayload[] = [];
  ouvinte.on('notification', (msg) => {
    if (msg.channel !== CHANNELS.CONVERSATIONS || !msg.payload) return;
    const { data } = JSON.parse(msg.payload) as { data: ConversationEventPayload };
    if (data.accountId === CONTA && data.type === 'conversations_read') noFio.push(data);
  });
  await ouvinte.query(`LISTEN ${CHANNELS.CONVERSATIONS}`);

  // Ids no teto de tamanho: é o pior caso para o `NOTIFY`.
  const idsLongos = Array.from({ length: 95 }, (_, i) => `${i}-`.padEnd(128, 'x'));
  const espia = espiarBarramento();
  try {
    waEventBus.emitConversationsRead(CONTA, CAIXA_A, idsLongos);
  } finally {
    espia.soltar();
  }
  const { emitidos } = espia;

  check(
    '95 ids viram 3 eventos (40 + 40 + 15)',
    emitidos.map((e) => e.conversationIds?.length).join('+') === '40+40+15',
    emitidos.map((e) => e.conversationIds?.length).join('+'),
  );
  check(
    'todos da caixa, e nenhum finge ser de uma conversa só',
    emitidos.every(
      (e) => e.type === 'conversations_read' && e.inboxId === CAIXA_A && e.conversationId === '',
    ),
  );
  check(
    'nenhum id perdido nem fora de ordem',
    emitidos.flatMap((e) => e.conversationIds ?? []).join() === idsLongos.join(),
  );
  const maior = Math.max(...emitidos.map((e) => Buffer.byteLength(JSON.stringify(e))));
  check('o maior evento cabe no NOTIFY com folga', maior < 7_000, `${maior} bytes`);

  await esperarAte(() => noFio.length >= 3, 8_000);
  await ouvinte.end();
  check('os 3 atravessaram o NOTIFY', noFio.length === 3, `${noFio.length}`);
  check(
    'com os ids e a caixa — o recorte do payload não os corta',
    noFio.flatMap((e) => e.conversationIds ?? []).length === 95 &&
      noFio.every((e) => e.inboxId === CAIXA_A),
  );
}

async function worker() {
  console.log('\n4) Worker: percorre o lote e para se a sessão cair');
  const chamadas: string[] = [];
  let conectada = true;
  let cairDepoisDe = Number.POSITIVE_INFINITY;
  const sessao = {
    get isConnected() {
      return conectada;
    },
    async markAsRead(conversationId: string) {
      chamadas.push(conversationId);
      if (chamadas.length >= cairDepoisDe) conectada = false;
    },
  };
  let sessaoDaCaixa: typeof sessao | undefined = sessao;
  const gerente = { workerId: 'worker-do-teste', get: () => sessaoDaCaixa };
  const consumidor = new CommandConsumer(gerente as never) as unknown as {
    executeCommand(cmd: {
      id: string;
      sequence: bigint;
      inboxId: string;
      kind: string;
      payload: unknown;
      attempts: number;
      expiresAt: Date | null;
    }): Promise<void>;
  };
  const rodar = (payload: unknown) =>
    consumidor.executeCommand({
      id: `cmd-${randomUUID()}`,
      sequence: BigInt(1),
      inboxId: CAIXA_A,
      kind: 'read',
      payload,
      attempts: 0,
      expiresAt: null,
    });

  await rodar({ conversationIds: ['a', 'b', 'c'] });
  check('lote: marca as três, na ordem', chamadas.join() === 'a,b,c', chamadas.join());

  chamadas.length = 0;
  await rodar({ conversationId: 'z' });
  check('o comando de uma conversa só continua valendo', chamadas.join() === 'z', chamadas.join());

  chamadas.length = 0;
  cairDepoisDe = 2;
  await rodar({ conversationIds: ['a', 'b', 'c', 'd'] });
  check('a sessão caiu no meio: para onde caiu', chamadas.join() === 'a,b', chamadas.join());

  chamadas.length = 0;
  conectada = true;
  cairDepoisDe = Number.POSITIVE_INFINITY;
  sessaoDaCaixa = undefined;
  await rodar({ conversationIds: ['a'] });
  check('sem sessão, descarta sem erro', chamadas.length === 0);
  sessaoDaCaixa = sessao;

  const invalidos: [string, unknown][] = [
    ['ids que não são texto', { conversationIds: [1, 2] }],
    ['lista vazia', { conversationIds: [] }],
    ['sem nada', {}],
  ];
  for (const [nome, payload] of invalidos) {
    const erro = await rodar(payload).then(
      () => null,
      (e: Error) => e.message,
    );
    check(
      `recusa payload inválido (${nome})`,
      erro === 'Comando de leitura sem identificação da conversa.' && chamadas.length === 0,
      String(erro),
    );
  }
}

async function filaDoWhatsApp() {
  console.log('\n5) Confirmação no WhatsApp: um comando por caixa');
  const canal = new QueueWhatsAppChannel();
  await canal.markReadMany(CONTA, CAIXA_A, [cv('1'), cv('2'), cv('5')]);
  const comandos = await prisma.whatsAppCommand.findMany({
    where: { inboxId: CAIXA_A, kind: 'read' },
  });
  check('um único comando de leitura', comandos.length === 1, `${comandos.length}`);
  check(
    'com as três conversas no payload',
    JSON.stringify((comandos[0]?.payload as { conversationIds?: string[] })?.conversationIds) ===
      JSON.stringify([cv('1'), cv('2'), cv('5')]),
    JSON.stringify(comandos[0]?.payload),
  );
  await canal.markReadMany(CONTA, CAIXA_A, []);
  check(
    'lista vazia não enfileira nada',
    (await prisma.whatsAppCommand.count({ where: { inboxId: CAIXA_A, kind: 'read' } })) === 1,
  );
  await prisma.whatsAppCommand.deleteMany({ where: { inboxId: { in: [CAIXA_A, CAIXA_B] } } });
}

async function acao() {
  console.log('\n6) Server Action, de ponta a ponta');
  // `server-only` barra o import fora do Next — é a proteção dele. Aqui o teste
  // é o servidor, então entra o módulo vazio, o mesmo que o Next usa no servidor.
  // Pelo caminho do arquivo: o `exports` do pacote não expõe `empty.js`.
  const moduloVazio = pathToFileURL(path.resolve('node_modules/server-only/empty.js')).href;
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === 'server-only'
        ? { url: moduloVazio, shortCircuit: true }
        : nextResolve(specifier, context),
  });
  let acoes: typeof Acoes;
  try {
    acoes = await import('../src/app/(workspace)/conversas/actions');
  } catch (erro) {
    check('a action carrega fora do Next', false, (erro as Error).message);
    return;
  }

  await definir(cv('1'), 2);
  await definir(cv('2'), 1);
  await definir(cv('4'), 3);
  await definir(cv('5'), 7);
  await prisma.notification.create({
    data: {
      id: ntf('acao'),
      accountId: CONTA,
      userId: USUARIO,
      kind: 'mensagem',
      text: 'teste',
      timeLabel: '10:00',
      href: `/conversas/${cv('4')}`,
    },
  });

  const sessaoCom = (extra: Partial<Session>) =>
    ({
      tokenId: 'token-do-teste',
      user: { id: USUARIO },
      account: { id: CONTA },
      permissions: ['conversas:ler'],
      availableAccounts: [],
      inboxAccess: 'todas',
      ...extra,
    }) as unknown as Session;
  const provedor = container.session as unknown as {
    getCurrentSession: () => Promise<Session>;
  };
  let sessaoAtual = sessaoCom({});
  provedor.getCurrentSession = async () => sessaoAtual;

  const espia = espiarBarramento();
  let r: Awaited<ReturnType<typeof acoes.markConversationsReadAction>>;
  try {
    r = await acoes.markConversationsReadAction({
      conversations: [
        { conversationId: cv('1'), unreadCount: 2 },
        { conversationId: cv('2'), unreadCount: 1 },
        { conversationId: cv('4'), unreadCount: 3 },
        { conversationId: cv('5'), unreadCount: 6 },
      ],
    });
  } finally {
    espia.soltar();
  }

  check('responde ok, com 3 marcadas', r.ok && r.marked === 3, JSON.stringify(r));
  check(
    'a que recebeu mensagem no caminho volta com a contagem atual',
    r.remaining?.length === 1 &&
      r.remaining[0]?.conversationId === cv('5') &&
      r.remaining[0]?.unreadCount === 7,
    JSON.stringify(r.remaining),
  );
  const anuncios = espia.emitidos.filter((e) => e.type === 'conversations_read');
  const daCaixa = (inboxId: string) => anuncios.find((e) => e.inboxId === inboxId);
  check(
    'um anúncio por caixa, com as conversas dela',
    anuncios.length === 2 &&
      idsDoPayload(daCaixa(CAIXA_A)) === [cv('1'), cv('2')].sort().join() &&
      idsDoPayload(daCaixa(CAIXA_B)) === cv('4'),
    anuncios.map((e) => `${e.inboxId}: ${e.conversationIds?.join(' ')}`).join(' | '),
  );
  check(
    'nenhuma conversa inteira foi para o fio',
    espia.emitidos.every((e) => e.conversation === undefined),
  );
  check('o aviso da conversa lida se apagou', (await avisoLido('acao')) === true);

  const comandos = await prisma.whatsAppCommand.findMany({
    where: { inboxId: { in: [CAIXA_A, CAIXA_B] }, kind: 'read' },
  });
  const comandoDa = (inboxId: string) => comandos.find((c) => c.inboxId === inboxId)?.payload;
  check(
    'um comando de leitura por caixa, só com as zeradas',
    comandos.length === 2 &&
      idsDoPayload(comandoDa(CAIXA_A)) === [cv('1'), cv('2')].sort().join() &&
      idsDoPayload(comandoDa(CAIXA_B)) === cv('4'),
    comandos.map((c) => `${c.inboxId}: ${JSON.stringify(c.payload)}`).join(' | '),
  );

  console.log('\n   permissão, recorte e validação');
  await definir(cv('1'), 1);
  sessaoAtual = sessaoCom({ permissions: [] });
  const semPermissao = await acoes.markConversationsReadAction({
    conversations: [{ conversationId: cv('1'), unreadCount: 1 }],
  });
  check(
    'sem "conversas:ler", recusa e não escreve',
    !semPermissao.ok && (await naoLidas(cv('1'))) === 1,
    JSON.stringify(semPermissao),
  );

  sessaoAtual = sessaoCom({ inboxAccess: [CAIXA_A] });
  await definir(cv('4'), 3);
  const foraDoAlcance = await acoes.markConversationsReadAction({
    conversations: [{ conversationId: cv('4'), unreadCount: 3 }],
  });
  check(
    'id de caixa fora do alcance: nada é zerado',
    foraDoAlcance.ok && foraDoAlcance.marked === 0 && (await naoLidas(cv('4'))) === 3,
    JSON.stringify(foraDoAlcance),
  );

  sessaoAtual = sessaoCom({});
  const invalidos: [string, unknown][] = [
    ['lista vazia', { conversations: [] }],
    ['contagem zero', { conversations: [{ conversationId: cv('1'), unreadCount: 0 }] }],
    [
      `mais de ${MARK_READ_BATCH_LIMIT}`,
      {
        conversations: Array.from({ length: MARK_READ_BATCH_LIMIT + 1 }, (_, i) => ({
          conversationId: cv(`x${i}`),
          unreadCount: 1,
        })),
      },
    ],
    ['lixo', 'marcar tudo'],
  ];
  for (const [nome, entrada] of invalidos) {
    const resultado = await acoes.markConversationsReadAction(entrada);
    check(`recusa entrada inválida (${nome})`, !resultado.ok, JSON.stringify(resultado));
  }
  check('e nada foi escrito por elas', (await naoLidas(cv('1'))) === 1);
}

async function main() {
  await prisma.account.create({ data: { id: CONTA, name: `Lidas ${sufixo}`, plan: 'teste' } });
  await prisma.account.create({
    data: { id: OUTRA_CONTA, name: `Lidas outra ${sufixo}`, plan: 'teste' },
  });
  await prisma.user.createMany({
    data: [USUARIO, COLEGA].map((id) => ({
      id,
      name: id,
      email: `${id}@exemplo.test`,
      passwordHash: 'x',
      avatarTone: 'slate',
    })),
  });

  try {
    await criarCaixa(CONTA, CAIXA_A, 'Caixa A');
    await criarCaixa(CONTA, CAIXA_B, 'Caixa B');
    await criarCaixa(OUTRA_CONTA, CAIXA_OUTRA, 'Caixa da outra conta');
    await prisma.contact.create({
      data: {
        id: CONTATO,
        accountId: CONTA,
        name: 'Cliente',
        phone: '5579911110001',
        channel: 'whatsapp',
        avatarTone: 'slate',
      },
    });
    await prisma.contact.create({
      data: {
        id: CONTATO_OUTRO,
        accountId: OUTRA_CONTA,
        name: 'Cliente',
        phone: '5579911110002',
        channel: 'whatsapp',
        avatarTone: 'slate',
      },
    });

    await repositorio();
    await avisos();
    await tempoReal();
    await worker();

    // As duas últimas enfileiram comandos, e o enfileiramento exige worker vivo.
    if (await waitForWorker(6_500)) {
      console.log('\n5) e 6) PULADAS: há um worker de verdade ligado a este banco.');
      return;
    }
    void publishWorkerBeat(WORKER_SIMULADO);
    const batida = setInterval(() => void publishWorkerBeat(WORKER_SIMULADO), 1_000);
    try {
      await filaDoWhatsApp();
      await acao();
    } finally {
      clearInterval(batida);
    }
  } finally {
    // As contas levam caixas, contatos, conversas, avisos e comandos.
    await prisma.account
      .deleteMany({ where: { id: { in: [CONTA, OUTRA_CONTA] } } })
      .catch(() =>
        console.error(`\n  Atenção: as contas de teste (${sufixo}) não foram removidas.`),
      );
    await prisma.user
      .deleteMany({ where: { id: { in: [USUARIO, COLEGA] } } })
      .catch(() =>
        console.error(`\n  Atenção: os usuários de teste (${sufixo}) não foram removidos.`),
      );
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
    // A escuta e o publicador do `NOTIFY` seguram o processo aberto.
    process.exit(falhas.length === 0 ? 0 : 1);
  })
  .catch(async (erro) => {
    console.error('\nErro no teste:', erro);
    await prisma.$disconnect();
    process.exit(1);
  });
