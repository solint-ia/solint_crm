/**
 * Teste do disparo de webhooks contra um destino real.
 *
 * Sobe um servidor HTTP local, cadastra um webhook da conta apontando para ele,
 * dispara o evento e confere o que chegou do outro lado — corpo, cabeçalhos e
 * assinatura. É a prova de que o caminho inteiro funciona, do banco ao destino.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { prisma } from '../src/infrastructure/db/prisma';
import { dispararWebhooks } from '../src/infrastructure/webhooks/webhook-dispatch';

const SEGREDO = 'segredo-de-teste';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

interface Recebido {
  readonly corpo: string;
  readonly headers: http.IncomingHttpHeaders;
}

async function main() {
  const recebidos: Recebido[] = [];

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (parte) => (corpo += parte));
    req.on('end', () => {
      recebidos.push({ corpo, headers: req.headers });
      res.writeHead(200).end('{"ok":true}');
    });
  });

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/webhook-de-teste`;
  console.log(`\nDestino de teste ouvindo em ${url}`);

  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) throw new Error('Nenhuma conta no banco para testar.');

  const webhook = await prisma.webhook.create({
    data: {
      accountId: account.id,
      name: 'Teste automatizado',
      url,
      events: ['mensagem.recebida'],
      secret: SEGREDO,
      isActive: true,
    },
  });

  try {
    console.log('\n1) Evento inscrito e ativo');
    await dispararWebhooks('mensagem.recebida', {
      contaId: account.id,
      caixaEntradaId: 'ibx-teste',
      conversa: { id: 'cv-teste', nova: false },
      contato: {
        id: 'ct-teste',
        nome: 'Fulano de Teste',
        telefone: '+5579998396408',
        jid: '557998396408@s.whatsapp.net',
        ehGrupo: false,
        etiquetas: ['vip', 'novo'],
      },
      mensagem: {
        id: 'msg-teste',
        tipo: 'text',
        texto: 'oii',
        deMim: false,
        autor: 'contact',
        autorNome: 'Fulano de Teste',
        recebidaEm: new Date().toISOString(),
      },
    });

    check('destino recebeu exatamente 1 chamada', recebidos.length === 1, `${recebidos.length}`);
    const entrega = recebidos[0];
    if (!entrega) throw new Error('nada chegou ao destino');

    const payload = JSON.parse(entrega.corpo) as Record<string, unknown>;
    check('cabeçalho X-Solint-Event', entrega.headers['x-solint-event'] === 'mensagem.recebida');
    check('Content-Type é JSON', entrega.headers['content-type'] === 'application/json');
    check(
      'assinatura HMAC confere',
      entrega.headers['x-solint-signature'] ===
        `sha256=${createHmac('sha256', SEGREDO).update(entrega.corpo).digest('hex')}`,
    );
    check('evento no corpo', payload.evento === 'mensagem.recebida');
    check('enviadoEm em ISO', typeof payload.enviadoEm === 'string');

    const contato = payload.contato as Record<string, unknown>;
    check('jid presente', contato.jid === '557998396408@s.whatsapp.net', String(contato.jid));
    check('nome presente', contato.nome === 'Fulano de Teste');
    check('telefone em E.164', contato.telefone === '+5579998396408');
    check('etiquetas vieram', Array.isArray(contato.etiquetas) && contato.etiquetas.length === 2);

    const mensagem = payload.mensagem as Record<string, unknown>;
    check('tipo da mensagem', mensagem.tipo === 'text', String(mensagem.tipo));
    check('texto da mensagem', mensagem.texto === 'oii');
    check('marca de quem enviou', mensagem.deMim === false);

    console.log('\n2) Evento NAO inscrito nao dispara');
    recebidos.length = 0;
    await dispararWebhooks('conversa.resolvida', {
      contaId: account.id,
      conversa: { id: 'cv-teste', nova: false },
      contato: {
        id: 'ct-teste',
        nome: 'Fulano',
        telefone: '',
        jid: 'x@s.whatsapp.net',
        ehGrupo: false,
        etiquetas: [],
      },
      mensagem: {
        id: 'm',
        tipo: 'text',
        texto: '',
        deMim: false,
        autor: 'contact',
        recebidaEm: new Date().toISOString(),
      },
    });
    check('destino nao foi chamado', recebidos.length === 0, `${recebidos.length} chamada(s)`);

    console.log('\n3) Sucesso zera o contador e carimba a data');
    const depois = await prisma.webhook.findUnique({ where: { id: webhook.id } });
    check('failureCount zerado', depois?.failureCount === 0, String(depois?.failureCount));
    check('lastTriggeredAt gravado', Boolean(depois?.lastTriggeredAt));

    console.log('\n4) Destino fora do ar conta a falha e NAO lanca');
    await prisma.webhook.update({
      where: { id: webhook.id },
      // Porta fechada de propósito: recusa a conexão na hora.
      data: { url: 'http://127.0.0.1:1/nao-existe' },
    });
    let lancou = false;
    try {
      await dispararWebhooks('mensagem.recebida', {
        contaId: account.id,
        conversa: { id: 'cv-teste', nova: false },
        contato: {
          id: 'ct-teste',
          nome: 'Fulano',
          telefone: '',
          jid: 'x@s.whatsapp.net',
          ehGrupo: false,
          etiquetas: [],
        },
        mensagem: {
          id: 'm',
          tipo: 'text',
          texto: '',
          deMim: false,
          autor: 'contact',
          recebidaEm: new Date().toISOString(),
        },
      });
    } catch {
      lancou = true;
    }
    check('nao lancou (gravacao da mensagem fica a salvo)', !lancou);
    const comFalha = await prisma.webhook.findUnique({ where: { id: webhook.id } });
    check('failureCount incrementado', comFalha?.failureCount === 1, String(comFalha?.failureCount));
  } finally {
    await prisma.webhook.delete({ where: { id: webhook.id } }).catch(() => undefined);
    servidor.close();
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
  .catch(async (err) => {
    console.error('\nErro no teste:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
