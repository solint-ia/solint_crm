/**
 * Teste do disparo de webhooks contra um destino real.
 *
 * Sobe um servidor HTTP local, cadastra webhooks da conta apontando para ele,
 * dispara os eventos e confere o que chegou do outro lado — corpo, cabeçalhos e
 * assinatura. É a prova de que o caminho inteiro funciona, do banco ao destino.
 *
 * Os corpos são montados a partir de mensagens cruas do WhatsApp, como as que o
 * Baileys entrega. Cada caso cobre um formato que quem integra precisa receber
 * inteiro (áudio, citação, anúncio, imagem) e, junto, a garantia que motivou a
 * mudança: **nenhum array de bytes pode sobreviver no corpo entregue**. Essa
 * última é conferida por varredura recursiva, e não caso a caso, porque o
 * defeito que ela previne é justamente o campo binário que ninguém listou.
 */
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { WAMessage } from '@whiskeysockets/baileys';

import { prisma } from '../src/infrastructure/db/prisma';
import { WebhookDeliveryRunner } from '../src/infrastructure/webhooks/webhook-delivery-runner';
import { dispararWebhooks } from '../src/infrastructure/webhooks/webhook-dispatch';
import type { SolintRefs } from '../src/infrastructure/webhooks/webhook-dispatch';
import { buildUpsertPayload } from '../src/infrastructure/whatsapp/wa-webhook-payload';

const SEGREDO = 'segredo-de-teste';
const JID = '557981454771@s.whatsapp.net';
/** Id fixo para a caixa do teste: a entrega guarda `inboxId` com chave estrangeira. */
const CAIXA = 'ibx-teste';
/** Teto de espera por entrega. O entregador varre a fila, não responde na hora. */
const ESPERA_MS = 20_000;

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

interface Recebido {
  readonly corpo: string;
  readonly headers: http.IncomingHttpHeaders;
}

const REFS: SolintRefs = {
  contaId: '',
  caixaEntradaId: CAIXA,
  conversaId: 'cv-teste',
  contatoId: 'ct-teste',
  mensagemId: 'msg-teste',
  conversaNova: false,
};

/**
 * Cada disparo precisa de um id de mensagem próprio.
 *
 * A chave de deduplicação da outbox é `evento:mensagemId`, e ela é única por
 * webhook — repetir o mesmo id faria o segundo caso do teste ser descartado
 * como reprocessamento do Baileys, e o teste acusaria "nada chegou" onde o
 * comportamento está certo.
 */
let sequencia = 0;
const proximoId = () => `msg-teste-${++sequencia}`;

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Um `Long` do protobuf, na forma em que o Baileys o entrega. */
const long = (valor: number) => ({ low: valor, high: 0, unsigned: true });

/** Um bloco de bytes, na forma em que ele chega e enchia o corpo. */
const bytes = (tamanho: number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: tamanho }, (_, i) => [String(i), i % 256]));

const crua = (message: Record<string, unknown>, extra: Record<string, unknown> = {}): WAMessage =>
  ({
    key: {
      remoteJid: JID,
      remoteJidAlt: JID,
      fromMe: false,
      id: 'AC271E799AE911A4FC77623CAE91D610',
      participant: null,
      addressingMode: 'lid',
    },
    pushName: 'Cleide Correia Lima',
    status: 3,
    messageTimestamp: long(1787410667),
    message,
    ...extra,
  }) as unknown as WAMessage;

const montar = (raw: WAMessage, base64?: string) =>
  buildUpsertPayload({
    raw,
    instance: 'Odonto Excellence',
    instanceId: 'ibx-teste',
    sender: '5579999999999@s.whatsapp.net',
    solint: REFS,
    ...(base64 ? { base64 } : {}),
  });

/**
 * Sobrou algum array de bytes no corpo entregue?
 *
 * Devolve o caminho do primeiro encontrado — o caminho, e não só `true`, porque
 * "tem lixo em algum lugar" não conserta nada e `data.message.imageMessage
 * .jpegThumbnail` conserta.
 */
const acharBytes = (valor: unknown, caminho = ''): string | null => {
  if (!valor || typeof valor !== 'object') return null;

  if (Array.isArray(valor)) {
    for (const [i, item] of valor.entries()) {
      const achado = acharBytes(item, `${caminho}[${i}]`);
      if (achado) return achado;
    }
    return null;
  }

  const chaves = Object.keys(valor as Record<string, unknown>);
  if (chaves.length > 8 && chaves.every((c) => /^\d+$/.test(c))) return caminho || '(raiz)';

  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    const achado = acharBytes(item, caminho ? `${caminho}.${chave}` : chave);
    if (achado) return achado;
  }
  return null;
};

/** Caminho aninhado, para as conferências não virarem uma escada de `as`. */
const em = (corpo: unknown, caminho: string): unknown =>
  caminho
    .split('.')
    .reduce<unknown>(
      (atual, parte) => (atual as Record<string, unknown> | undefined)?.[parte],
      corpo,
    );

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
  const refs: SolintRefs = { ...REFS, contaId: account.id };

  // A entrega guarda a caixa de origem, com chave estrangeira. Sem uma caixa
  // real no banco, a outbox recusaria a linha antes de qualquer conferência.
  await prisma.inbox.upsert({
    where: { id: CAIXA },
    update: { accountId: account.id },
    create: {
      id: CAIXA,
      accountId: account.id,
      name: 'Odonto Excellence',
      channel: 'whatsapp',
      identifier: '5579999999999',
      status: 'desconectado',
      provider: 'baileys',
      businessHours: {},
      awayMessage: {},
      greeting: {},
    },
  });

  const webhook = await prisma.webhook.create({
    data: {
      accountId: account.id,
      name: 'Teste automatizado',
      url,
      events: ['mensagem.recebida', 'mensagem.enviada'],
      secret: SEGREDO,
      isActive: true,
    },
  });

  // Quem entrega é o runner, a partir da outbox: `dispararWebhooks` só
  // enfileira. Sem ele de pé, nenhum caso deste arquivo receberia nada.
  const runner = new WebhookDeliveryRunner('teste-webhook');
  runner.start();

  /** Espera o destino ser chamado `quantas` vezes, ou desiste. */
  const aguardar = async (quantas: number): Promise<void> => {
    const limite = Date.now() + ESPERA_MS;
    while (recebidos.length < quantas && Date.now() < limite) await dormir(100);
  };

  /** Espera até `condicao` valer, ou desiste. Devolve se valeu. */
  const aguardarAte = async (condicao: () => Promise<boolean>): Promise<boolean> => {
    const limite = Date.now() + ESPERA_MS;
    while (Date.now() < limite) {
      if (await condicao()) return true;
      await dormir(200);
    }
    return false;
  };

  /** Dispara e devolve o único corpo que chegou, já em objeto. */
  const disparar = async (
    evento: Parameters<typeof dispararWebhooks>[0],
    raw: WAMessage,
    base64?: string,
  ): Promise<Record<string, unknown>> => {
    recebidos.length = 0;
    await dispararWebhooks(evento, {
      ...montar(raw, base64),
      solint: { ...refs, mensagemId: proximoId() },
    });
    await aguardar(1);
    const entrega = recebidos[0];
    if (!entrega) throw new Error(`nada chegou ao destino para ${evento}`);
    return JSON.parse(entrega.corpo) as Record<string, unknown>;
  };

  try {
    console.log('\n1) Texto simples');
    const texto = await disparar(
      'mensagem.recebida',
      crua({
        messageContextInfo: { deviceListMetadata: { recipientKeyHash: bytes(10) } },
        conversation: 'Olá! Posso ter mais informações sobre isso?',
      }),
    );
    const entrega = recebidos[0]!;
    check('cabeçalho X-Solint-Event', entrega.headers['x-solint-event'] === 'mensagem.recebida');
    check('Content-Type é JSON', entrega.headers['content-type'] === 'application/json');
    check(
      'assinatura HMAC confere',
      entrega.headers['x-solint-signature'] ===
        `sha256=${createHmac('sha256', SEGREDO).update(entrega.corpo).digest('hex')}`,
    );
    check('event', texto.event === 'messages.upsert', String(texto.event));
    check('instance é o nome da caixa', texto.instance === 'Odonto Excellence');
    check(
      'destination é a URL deste destino',
      texto.destination === url,
      String(texto.destination),
    );
    check('sender', texto.sender === '5579999999999@s.whatsapp.net');
    check('date_time em ISO', typeof texto.date_time === 'string');
    check('key.remoteJid', em(texto, 'data.key.remoteJid') === JID);
    check('key.fromMe é booleano', em(texto, 'data.key.fromMe') === false);
    check('key.participant vira string vazia', em(texto, 'data.key.participant') === '');
    check('pushName', em(texto, 'data.pushName') === 'Cleide Correia Lima');
    check('status vira nome', em(texto, 'data.status') === 'DELIVERY_ACK');
    check('messageType', em(texto, 'data.messageType') === 'conversation');
    check(
      'messageTimestamp em segundos',
      em(texto, 'data.messageTimestamp') === 1787410667,
      String(em(texto, 'data.messageTimestamp')),
    );
    check('instanceId', em(texto, 'data.instanceId') === 'ibx-teste');
    check('source preenchido', typeof em(texto, 'data.source') === 'string');
    check(
      'conteúdo do texto',
      em(texto, 'data.message.conversation') === 'Olá! Posso ter mais informações sobre isso?',
    );
    check(
      'messageContextInfo descartado',
      em(texto, 'data.message.messageContextInfo') === undefined,
    );
    check('solint.conversaId para a resposta', em(texto, 'solint.conversaId') === 'cv-teste');

    console.log('\n2) Áudio gravado (ptt) com base64');
    const audio = await disparar(
      'mensagem.recebida',
      crua({
        audioMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7117-24/x.enc',
          mimetype: 'audio/ogg; codecs=opus',
          fileSha256: bytes(32),
          fileLength: long(6789),
          seconds: 7,
          ptt: true,
          mediaKey: bytes(32),
          waveform: bytes(64),
          streamingSidecar: bytes(128),
        },
      }),
      Buffer.from('bytes-de-audio-decifrado').toString('base64'),
    );
    check('messageType', em(audio, 'data.messageType') === 'audioMessage');
    check('ptt preservado', em(audio, 'data.message.audioMessage.ptt') === true);
    check('seconds preservado', em(audio, 'data.message.audioMessage.seconds') === 7);
    check(
      'mimetype preservado',
      em(audio, 'data.message.audioMessage.mimetype') === 'audio/ogg; codecs=opus',
    );
    check(
      'fileLength (Long) vira texto',
      em(audio, 'data.message.audioMessage.fileLength') === '6789',
      String(em(audio, 'data.message.audioMessage.fileLength')),
    );
    check(
      'base64 entregue',
      Buffer.from(String(em(audio, 'data.message.base64')), 'base64').toString() ===
        'bytes-de-audio-decifrado',
    );
    check('mediaKey descartada', em(audio, 'data.message.audioMessage.mediaKey') === undefined);
    check('fileSha256 descartado', em(audio, 'data.message.audioMessage.fileSha256') === undefined);

    console.log('\n3) Resposta a uma mensagem (citação)');
    const citacao = await disparar(
      'mensagem.recebida',
      crua({
        extendedTextMessage: {
          text: 'sim, esse mesmo',
          contextInfo: {
            stanzaId: '3EB0C767D097C1E1A5D2',
            participant: JID,
            quotedMessage: { conversation: 'Você quer dizer o implante?' },
          },
        },
      }),
    );
    check('messageType', em(citacao, 'data.messageType') === 'extendedTextMessage');
    check(
      'texto da resposta',
      em(citacao, 'data.message.extendedTextMessage.text') === 'sim, esse mesmo',
    );
    check(
      'citação no lugar de origem',
      em(citacao, 'data.message.extendedTextMessage.contextInfo.quotedMessage.conversation') ===
        'Você quer dizer o implante?',
    );
    check(
      'citação elevada para data.contextInfo',
      em(citacao, 'data.contextInfo.quotedMessage.conversation') === 'Você quer dizer o implante?',
    );
    check(
      'stanzaId da citada',
      em(citacao, 'data.contextInfo.stanzaId') === '3EB0C767D097C1E1A5D2',
    );

    console.log('\n4) Clique em anúncio (externalAdReply)');
    const anuncio = await disparar(
      'mensagem.recebida',
      crua({
        extendedTextMessage: {
          text: 'quero saber o preço',
          contextInfo: {
            conversionSource: 'FB_Ads',
            conversionDelaySeconds: 22,
            conversionData: bytes(427),
            mentionedJid: [],
            externalAdReply: {
              title: 'Odonto Excellence Aracaju',
              body: 'Uma mordida mais forte, um acidente...',
              mediaType: 2,
              thumbnailUrl: 'https://instagram.faju19-1.fna.fbcdn.net/v/t15.5256-10/x.jpg',
              sourceUrl: 'https://www.facebook.com/odontoexcellencearacaju/videos/1',
              ctwaClid: 'AfjnxCbUfFNQ3rA2xbXIP6ql4CkSnGA5EbP4U9YK',
              thumbnail: bytes(1400),
            },
          },
        },
      }),
    );
    check(
      'título do anúncio',
      em(anuncio, 'data.contextInfo.externalAdReply.title') === 'Odonto Excellence Aracaju',
    );
    check(
      'corpo do anúncio',
      String(em(anuncio, 'data.contextInfo.externalAdReply.body')).startsWith('Uma mordida'),
    );
    check(
      'ctwaClid preservado',
      em(anuncio, 'data.contextInfo.externalAdReply.ctwaClid') ===
        'AfjnxCbUfFNQ3rA2xbXIP6ql4CkSnGA5EbP4U9YK',
    );
    check('conversionSource', em(anuncio, 'data.contextInfo.conversionSource') === 'FB_Ads');
    check(
      'miniatura do anúncio descartada',
      em(anuncio, 'data.contextInfo.externalAdReply.thumbnail') === undefined,
    );
    check(
      'conversionData descartado',
      em(anuncio, 'data.contextInfo.conversionData') === undefined,
    );
    check(
      'mentionedJid vazio preservado',
      Array.isArray(em(anuncio, 'data.contextInfo.mentionedJid')),
    );

    console.log('\n5) Imagem com legenda');
    const imagem = await disparar(
      'mensagem.recebida',
      crua({
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'foi assim que quebrou',
          fileLength: long(184320),
          jpegThumbnail: bytes(900),
          mediaKey: bytes(32),
        },
      }),
      Buffer.from('bytes-da-imagem').toString('base64'),
    );
    check('messageType', em(imagem, 'data.messageType') === 'imageMessage');
    check(
      'legenda preservada',
      em(imagem, 'data.message.imageMessage.caption') === 'foi assim que quebrou',
    );
    check('base64 entregue', typeof em(imagem, 'data.message.base64') === 'string');
    check(
      'jpegThumbnail descartada',
      em(imagem, 'data.message.imageMessage.jpegThumbnail') === undefined,
    );

    console.log('\n6) Mensagem enviada (fromMe)');
    const saida = await disparar(
      'mensagem.enviada',
      crua(
        { conversation: 'Claro! Fica na Rua X, 100.' },
        { key: { remoteJid: JID, fromMe: true, id: '3EB0ABC', participant: null } },
      ),
    );
    check('key.fromMe verdadeiro', em(saida, 'data.key.fromMe') === true);
    check(
      'texto da saída',
      em(saida, 'data.message.conversation') === 'Claro! Fica na Rua X, 100.',
    );

    console.log('\n7) Nenhum array de bytes sobreviveu em nenhum corpo');
    for (const [nome, corpo] of [
      ['texto', texto],
      ['áudio', audio],
      ['citação', citacao],
      ['anúncio', anuncio],
      ['imagem', imagem],
      ['saída', saida],
    ] as const) {
      const achado = acharBytes(corpo);
      check(`corpo de ${nome} limpo`, achado === null, achado ?? '');
    }

    console.log('\n8) Evento NAO inscrito nao dispara');
    recebidos.length = 0;
    await dispararWebhooks('conversa.criada', {
      ...montar(crua({ conversation: 'oi' })),
      solint: { ...refs, mensagemId: proximoId() },
    });
    // Ausência não se prova esperando para sempre: dois ciclos de varredura do
    // entregador são folga suficiente para o que fosse sair já ter saído.
    await dormir(2_000);
    check('destino nao foi chamado', recebidos.length === 0, `${recebidos.length} chamada(s)`);
    check(
      'nenhuma entrega foi enfileirada',
      (await prisma.webhookDelivery.count({
        where: { webhookId: webhook.id, event: 'conversa.criada' },
      })) === 0,
    );

    console.log('\n9) Cada destino recebe a propria URL em destination');
    const segundaUrl = `${url}/segundo`;
    const segundo = await prisma.webhook.create({
      data: {
        accountId: account.id,
        name: 'Segundo destino',
        url: segundaUrl,
        events: ['mensagem.recebida'],
        isActive: true,
      },
    });
    recebidos.length = 0;
    await dispararWebhooks('mensagem.recebida', {
      ...montar(crua({ conversation: 'para os dois' })),
      solint: { ...refs, mensagemId: proximoId() },
    });
    await aguardar(2);
    const destinos = recebidos
      .map((r) => (JSON.parse(r.corpo) as { destination: string }).destination)
      .sort();
    check('os dois destinos receberam', recebidos.length === 2, `${recebidos.length}`);
    check(
      'destination de cada um é a própria URL',
      destinos.join('|') === [url, segundaUrl].sort().join('|'),
      destinos.join(' , '),
    );
    await prisma.webhook.delete({ where: { id: segundo.id } }).catch(() => undefined);

    console.log('\n10) Sucesso zera o contador e carimba a data');
    await aguardarAte(async () =>
      Boolean((await prisma.webhook.findUnique({ where: { id: webhook.id } }))?.lastTriggeredAt),
    );
    const depois = await prisma.webhook.findUnique({ where: { id: webhook.id } });
    check('failureCount zerado', depois?.failureCount === 0, String(depois?.failureCount));
    check('lastTriggeredAt gravado', Boolean(depois?.lastTriggeredAt));

    console.log('\n11) Destino fora do ar conta a falha e NAO lanca');
    await prisma.webhook.update({
      where: { id: webhook.id },
      // Porta fechada de propósito: recusa a conexão na hora.
      data: { url: 'http://127.0.0.1:1/nao-existe' },
    });
    let lancou = false;
    try {
      await dispararWebhooks('mensagem.recebida', {
        ...montar(crua({ conversation: 'ninguem ouve' })),
        solint: { ...refs, mensagemId: proximoId() },
      });
    } catch {
      lancou = true;
    }
    check('nao lancou (gravacao da mensagem fica a salvo)', !lancou);
    const contou = await aguardarAte(async () => {
      const linha = await prisma.webhook.findUnique({ where: { id: webhook.id } });
      return (linha?.failureCount ?? 0) >= 1;
    });
    const comFalha = await prisma.webhook.findUnique({ where: { id: webhook.id } });
    check('failureCount incrementado', contou, String(comFalha?.failureCount));
    check(
      'entrega volta para a fila em vez de sumir',
      (await prisma.webhookDelivery.count({
        where: { webhookId: webhook.id, status: { in: ['pending', 'processing'] } },
      })) >= 1,
    );
  } finally {
    await runner.stop();
    await prisma.webhook.delete({ where: { id: webhook.id } }).catch(() => undefined);
    await prisma.inbox.delete({ where: { id: CAIXA } }).catch(() => undefined);
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
