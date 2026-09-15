import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { proto, type WAMessage } from '@whiskeysockets/baileys';

import { startFakeParServer } from './fake-par-server';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const REPO_ROOT = process.cwd();
const suffix = randomUUID().slice(0, 8);
const ACCOUNT = `acc-media-range-${suffix}`;
const OTHER_ACCOUNT = `acc-media-range-other-${suffix}`;
const SOURCE_ID = `video-range-${suffix}`;
const DATA = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

async function main() {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) {
    throw new Error('ABORTADO: test-media-range exige o Postgres descartável em 127.0.0.1:55432.');
  }

  const fakePar = await startFakeParServer();
  process.env.OBJECT_STORAGE_PAR_URL = fakePar.url;
  const testCwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'solint-media-range-'));
  process.chdir(testCwd);

  const emptyServerOnly = pathToFileURL(
    path.resolve(REPO_ROOT, 'node_modules/server-only/empty.js'),
  ).href;
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === 'server-only'
        ? { url: emptyServerOnly, shortCircuit: true }
        : nextResolve(specifier, context),
  });

  const [{ prisma }, { container }, { mediaStore }, messageContent, route] = await Promise.all([
    import('../src/infrastructure/db/prisma'),
    import('../src/infrastructure/container'),
    import('../src/infrastructure/whatsapp/wa-media-store'),
    import('../src/infrastructure/whatsapp/wa-message-content'),
    import('../src/app/api/whatsapp/media/[id]/route'),
  ]);

  const rawToken = `sk_live_range_${suffix}`;
  const otherRawToken = `sk_live_range_other_${suffix}`;
  const getSession = container.session.getSession.bind(container.session);
  container.session.getSession = async () => null;

  try {
    await prisma.account.createMany({
      data: [
        { id: ACCOUNT, name: 'Teste Range', plan: 'starter' },
        { id: OTHER_ACCOUNT, name: 'Teste Range Outra', plan: 'starter' },
      ],
    });
    await prisma.apiToken.createMany({
      data: [
        {
          accountId: ACCOUNT,
          name: 'Token range',
          tokenHash: tokenHash(rawToken),
          tokenPrefix: rawToken.slice(0, 12),
          permissions: [],
        },
        {
          accountId: OTHER_ACCOUNT,
          name: 'Token range outra',
          tokenHash: tokenHash(otherRawToken),
          tokenPrefix: otherRawToken.slice(0, 12),
          permissions: [],
        },
      ],
    });

    const url = await mediaStore.save(
      SOURCE_ID,
      DATA,
      { mimeType: 'video/mp4', fileName: 'video.mp4' },
      { accountId: ACCOUNT, kind: 'mensagem' },
    );
    const id = url?.split('/').pop() ?? '';
    check('mídia de teste foi gravada', Boolean(id), url ?? 'sem URL');

    const get = (token: string, range?: string) =>
      route.GET(
        new Request(`http://localhost/api/whatsapp/media/${id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(range ? { Range: range } : {}),
          },
        }),
        { params: Promise.resolve({ id }) },
      );

    console.log('\n1) Faixas a partir do cache em disco');
    const first = await get(rawToken, 'bytes=0-99');
    const firstBytes = Buffer.from(await first.arrayBuffer());
    check('bytes=0-99 responde 206', first.status === 206, String(first.status));
    check('faixa tem 100 bytes', firstBytes.length === 100, String(firstBytes.length));
    check('Content-Range correto', first.headers.get('content-range') === 'bytes 0-99/256');
    check('bytes da faixa conferem', firstBytes.equals(DATA.subarray(0, 100)));

    console.log('\n2) Faixas a partir do Storage');
    await mediaStore.clear();
    const suffixResponse = await get(rawToken, 'bytes=-10');
    const suffixBytes = Buffer.from(await suffixResponse.arrayBuffer());
    check('bytes=-10 responde 206', suffixResponse.status === 206);
    check('sufixo confere', suffixBytes.equals(DATA.subarray(246)));
    check(
      'leitura fria fez GET na PAR',
      [...fakePar.getCounts.values()].some((count) => count > 0),
    );

    const openEnded = await get(rawToken, 'bytes=100-');
    check('bytes=100- tem 156 bytes', (await openEnded.arrayBuffer()).byteLength === 156);
    check(
      'faixa aberta tem Content-Range',
      openEnded.headers.get('content-range') === 'bytes 100-255/256',
    );

    console.log('\n3) Sem faixa, múltiplas e inválidas');
    const multiple = await get(rawToken, 'bytes=0-1,5-9');
    check('faixas múltiplas preservam 200', multiple.status === 200);
    check(
      'faixas múltiplas recebem corpo inteiro',
      (await multiple.arrayBuffer()).byteLength === 256,
    );

    const invalid = await get(rawToken, 'bytes=999-');
    check('faixa fora do tamanho responde 416', invalid.status === 416);
    check('416 informa o tamanho', invalid.headers.get('content-range') === 'bytes */256');

    const full = await get(rawToken);
    check('sem Range responde 200', full.status === 200);
    check('sem Range anuncia Accept-Ranges', full.headers.get('accept-ranges') === 'bytes');

    const foreign = await get(otherRawToken, 'bytes=0-9');
    check('outra conta recebe 404', foreign.status === 404, String(foreign.status));

    console.log('\n4) Miniatura do payload do WhatsApp');
    const thumbnail = Uint8Array.from([1, 2, 3, 4]);
    const decoded = messageContent.decodeWaMessage(
      proto.WebMessageInfo.create({
        message: {
          videoMessage: {
            mimetype: 'video/mp4',
            fileLength: 10,
            jpegThumbnail: thumbnail,
          },
        },
      }) as WAMessage,
    );
    check('decode preserva jpegThumbnail', Boolean(decoded?.media?.jpegThumbnail?.length === 4));
    const content = decoded?.media
      ? messageContent.mediaContent(decoded.media, '/video', '/poster')
      : null;
    check(
      'mediaContent inclui posterUrl',
      content?.type === 'video' && content.posterUrl === '/poster',
    );
  } finally {
    container.session.getSession = getSession;
    await prisma.account.deleteMany({ where: { id: { in: [ACCOUNT, OTHER_ACCOUNT] } } });
    await prisma.$disconnect();
    await fakePar.close();
    process.chdir(REPO_ROOT);
    await fsp.rm(testCwd, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(
      failures.length === 0
        ? '\nTodos os testes de Range passaram.\n'
        : `\n${failures.length} falha(s): ${failures.join(', ')}\n`,
    );
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error('\nErro no teste de Range:', error);
    process.exit(1);
  });
