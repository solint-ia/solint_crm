/**
 * Envio pela API oficial contra um servidor falso da Graph API.
 *
 * Sem banco e sem a Meta de verdade: `META_GRAPH_BASE_URL` aponta para um
 * servidor HTTP local que registra o que chegou e responde como a Meta.
 *
 *   npx tsx scripts/test-api-oficial-envio.ts
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { CloudConnection } from '../src/infrastructure/whatsapp/cloud/cloud-connection';
import {
  markCloudRead,
  sendCloudMedia,
  sendCloudTemplate,
  sendCloudText,
} from '../src/infrastructure/whatsapp/cloud/cloud-sender';
import { CloudApiError } from '../src/infrastructure/whatsapp/cloud/graph-client';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

interface Chamada {
  readonly method: string;
  readonly url: string;
  readonly auth: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

const chamadas: Chamada[] = [];
let proximaResposta: { status: number; body: unknown } | null = null;

const lerCorpo = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
  });

const servidor = createServer(async (req, res) => {
  const body = await lerCorpo(req);
  chamadas.push({
    method: req.method ?? '',
    url: req.url ?? '',
    auth: req.headers.authorization,
    contentType: req.headers['content-type'],
    body,
  });
  const resposta =
    proximaResposta ??
    (req.url?.endsWith('/media')
      ? { status: 200, body: { id: 'MEDIA-UP' } }
      : { status: 200, body: { messages: [{ id: `wamid.${chamadas.length}` }], success: true } });
  proximaResposta = null;
  res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(resposta.body));
});

const conn: CloudConnection = {
  inboxId: 'ibx-teste',
  accountId: 'acc-teste',
  mode: 'manual',
  coexistence: false,
  wabaId: 'WABA',
  phoneNumberId: 'PN123',
  displayPhoneNumber: '+5511900000000',
  status: 'conectado',
  token: 'EAATOKENDETESTE1234567890',
  webhookKey: 'k',
};

async function main() {
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address() as AddressInfo;
  process.env.META_GRAPH_BASE_URL = `http://127.0.0.1:${port}/v25.0`;

  console.log('\n1) Texto');
  const wamid = await sendCloudText(conn, { phone: '+5579999998888' }, 'olá', {
    externalId: 'wamid.citada',
    fromMe: false,
    text: 'x',
  });
  const texto = chamadas.at(-1);
  const corpoTexto = JSON.parse(texto?.body ?? '{}');
  check('devolve o wamid', wamid.startsWith('wamid.'), wamid);
  check('vai para /PN123/messages', texto?.url === '/v25.0/PN123/messages', texto?.url);
  check('token no Authorization', texto?.auth === `Bearer ${conn.token}`);
  check('destino e corpo', corpoTexto.to === '5579999998888' && corpoTexto.text?.body === 'olá');
  check('citação em context', corpoTexto.context?.message_id === 'wamid.citada');

  console.log('\n2) Mídia');
  const imagem = Buffer.alloc(1024, 1);
  await sendCloudMedia(
    conn,
    { phone: '+5579999998888' },
    {
      kind: 'image',
      data: imagem,
      mimeType: 'image/jpeg',
      caption: 'foto',
    },
  );
  const upload = chamadas.at(-2);
  const envioMidia = JSON.parse(chamadas.at(-1)?.body ?? '{}');
  check(
    'sobe primeiro em /media (multipart)',
    upload?.url === '/v25.0/PN123/media' &&
      Boolean(upload?.contentType?.startsWith('multipart/form-data')),
  );
  check(
    'envia com o id da mídia',
    envioMidia.type === 'image' && envioMidia.image?.id === 'MEDIA-UP',
  );
  check('legenda preservada', envioMidia.image?.caption === 'foto');

  await sendCloudMedia(
    conn,
    { phone: '+5579999998888' },
    {
      kind: 'image',
      data: Buffer.alloc(10, 1),
      mimeType: 'image/webp',
      fileName: 'figura.webp',
    },
  );
  const webp = JSON.parse(chamadas.at(-1)?.body ?? '{}');
  check(
    'imagem em formato não aceito vai como documento',
    webp.type === 'document' && webp.document?.filename === 'figura.webp',
  );

  console.log('\n3) Template e leitura');
  await sendCloudTemplate(
    conn,
    { channelThreadId: 'bsuid:BR.1' },
    {
      name: 'boas_vindas',
      language: 'pt_BR',
      bodyValues: ['Maria'],
    },
  );
  const tpl = JSON.parse(chamadas.at(-1)?.body ?? '{}');
  check('template por BSUID', tpl.recipient === 'BR.1' && tpl.template?.name === 'boas_vindas');
  check('variáveis no corpo', tpl.template?.components?.[0]?.parameters?.[0]?.text === 'Maria');

  await markCloudRead(conn, 'wamid.lida');
  const leitura = JSON.parse(chamadas.at(-1)?.body ?? '{}');
  check('leitura por message_id', leitura.status === 'read' && leitura.message_id === 'wamid.lida');

  console.log('\n4) Recusas');
  proximaResposta = { status: 400, body: { error: { code: 131047, message: 'Re-engagement' } } };
  try {
    await sendCloudText(conn, { phone: '+5579999998888' }, 'tarde demais');
    check('janela fechada lança', false);
  } catch (error) {
    check(
      'janela fechada vira erro claro e não retentável',
      error instanceof CloudApiError && error.code === 131047 && !error.retentavel,
      error instanceof Error ? error.message : '',
    );
  }
  proximaResposta = { status: 401, body: { error: { code: 190, message: 'Invalid OAuth' } } };
  try {
    await sendCloudText(conn, { phone: '+5579999998888' }, 'x');
  } catch (error) {
    check('token inválido identificado', error instanceof CloudApiError && error.tokenInvalido);
  }
}

main()
  .catch((erro) => {
    console.error('\nErro no teste:', erro);
    falhas.push('exceção');
  })
  .finally(() => {
    servidor.close();
    if (falhas.length > 0) {
      console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
      process.exit(1);
    }
    console.log('\nTodos os testes de envio da API oficial passaram.');
    process.exit(0);
  });
