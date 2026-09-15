import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Session } from '../src/core/domain/user';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/core/domain/user';
import { startFakeParServer } from './fake-par-server';

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const REPO_ROOT = process.cwd();
const suffix = randomUUID().slice(0, 8);
const ACCOUNT = `acc-dedup-${suffix}`;
const OTHER_ACCOUNT = `acc-dedup-other-${suffix}`;
const BACKFILL_ACCOUNT = `acc-dedup-backfill-${suffix}`;
const INBOX_A = `ibx-dedup-a-${suffix}`;
const INBOX_B = `ibx-dedup-b-${suffix}`;
const INBOX_OTHER = `ibx-dedup-o-${suffix}`;
const SAME = Buffer.from(`mesmo-conteudo-${suffix}`);
const CONCURRENT = Buffer.from(`conteudo-concorrente-${suffix}`);
const FAILED = Buffer.from(`conteudo-com-falha-${suffix}`);

const checksumOf = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const publicIdOf = (url: string | undefined): string => url?.split('/').pop() ?? '';
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

const sessionFor = (accountId: string): Session => ({
  tokenId: `token-${accountId}`,
  user: {
    id: `user-${accountId}`,
    accountId,
    name: 'Pessoa do teste',
    email: 'teste@localhost',
    roleSlug: 'administrador',
    avatarTone: 'slate',
    availability: 'disponivel',
    teams: [],
    signatureEnabled: false,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    twoFactorEnabled: false,
  },
  account: { id: accountId, name: 'Conta do teste', plan: 'starter' },
  permissions: [],
  availableAccounts: [],
  inboxAccess: 'todas',
});

async function main() {
  if (!process.env.DATABASE_URL?.includes('127.0.0.1:55432')) {
    throw new Error('ABORTADO: test-media-dedup exige o Postgres descartável em 127.0.0.1:55432.');
  }

  const fakePar = await startFakeParServer();
  process.env.OBJECT_STORAGE_PAR_URL = fakePar.url;
  const testCwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'solint-media-dedup-'));
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

  const [
    { prisma },
    { container },
    { mediaStore },
    messageRoute,
    blobRoute,
    { backfillMediaBlobs },
  ] = await Promise.all([
    import('../src/infrastructure/db/prisma'),
    import('../src/infrastructure/container'),
    import('../src/infrastructure/whatsapp/wa-media-store'),
    import('../src/app/api/whatsapp/media/[id]/route'),
    import('../src/app/api/whatsapp/media/b/[blobId]/route'),
    import('./backfill-media-blobs'),
  ]);

  const rawToken = `sk_live_dedup_${suffix}`;
  const originalGetSession = container.session.getSession.bind(container.session);
  let cookieSession: Session | null = null;
  container.session.getSession = async () => cookieSession;

  try {
    await prisma.account.createMany({
      data: [
        { id: ACCOUNT, name: 'Dedup', plan: 'starter' },
        { id: OTHER_ACCOUNT, name: 'Dedup outra', plan: 'starter' },
        { id: BACKFILL_ACCOUNT, name: 'Dedup backfill', plan: 'starter' },
      ],
    });
    await prisma.inbox.createMany({
      data: [
        {
          id: INBOX_A,
          accountId: ACCOUNT,
          name: 'A',
          channel: 'whatsapp',
          identifier: `A-${suffix}`,
          status: 'conectado',
          provider: 'baileys',
          businessHours: {},
          greeting: {},
        },
        {
          id: INBOX_B,
          accountId: ACCOUNT,
          name: 'B',
          channel: 'whatsapp',
          identifier: `B-${suffix}`,
          status: 'conectado',
          provider: 'baileys',
          businessHours: {},
          greeting: {},
        },
        {
          id: INBOX_OTHER,
          accountId: OTHER_ACCOUNT,
          name: 'Outra',
          channel: 'whatsapp',
          identifier: `O-${suffix}`,
          status: 'conectado',
          provider: 'baileys',
          businessHours: {},
          greeting: {},
        },
      ],
    });
    await prisma.apiToken.create({
      data: {
        accountId: ACCOUNT,
        name: 'Token dedup',
        tokenHash: tokenHash(rawToken),
        tokenPrefix: rawToken.slice(0, 12),
        permissions: [],
      },
    });

    console.log('\n1) Deduplicação por conta');
    const beforeSame = fakePar.totalPuts();
    const firstUrl = await mediaStore.save(
      `same-a-${suffix}`,
      SAME,
      { mimeType: 'image/webp', fileName: 'primeira.webp' },
      { accountId: ACCOUNT, inboxId: INBOX_A, kind: 'mensagem' },
    );
    const secondUrl = await mediaStore.save(
      `same-b-${suffix}`,
      SAME,
      { mimeType: 'image/webp', fileName: 'segunda.webp' },
      { accountId: ACCOUNT, inboxId: INBOX_A, kind: 'mensagem' },
    );
    check('dois sourceId fazem um PUT', fakePar.totalPuts() - beforeSame === 1);

    const sameRows = await prisma.mediaObject.findMany({
      where: { accountId: ACCOUNT, checksum: checksumOf(SAME) },
      orderBy: { sourceId: 'asc' },
    });
    check('dois MediaObject foram criados', sameRows.length === 2);
    check(
      'os dois apontam para o mesmo blob',
      Boolean(sameRows[0]?.blobId && sameRows.every((row) => row.blobId === sameRows[0]?.blobId)),
    );
    check(
      'um MediaBlob foi criado',
      (await prisma.mediaBlob.count({
        where: { accountId: ACCOUNT, checksum: checksumOf(SAME) },
      })) === 1,
    );

    const thirdUrl = await mediaStore.save(
      `same-c-${suffix}`,
      SAME,
      { mimeType: 'image/webp' },
      { accountId: ACCOUNT, inboxId: INBOX_B, kind: 'mensagem' },
    );
    check('outra caixa da mesma conta não faz PUT', fakePar.totalPuts() - beforeSame === 1);
    check(
      'outra caixa usa o mesmo blob',
      (await prisma.mediaBlob.count({
        where: { accountId: ACCOUNT, checksum: checksumOf(SAME) },
      })) === 1,
    );

    const beforeOther = fakePar.totalPuts();
    const otherUrl = await mediaStore.save(
      `same-other-${suffix}`,
      SAME,
      { mimeType: 'image/webp' },
      { accountId: OTHER_ACCOUNT, inboxId: INBOX_OTHER, kind: 'mensagem' },
    );
    check('outra conta faz seu próprio PUT', fakePar.totalPuts() - beforeOther === 1);
    const crossAccountBlobs = await prisma.mediaBlob.findMany({
      where: { checksum: checksumOf(SAME) },
    });
    check('mesmos bytes em duas contas geram dois blobs', crossAccountBlobs.length === 2);
    check(
      'cada caminho leva o prefixo da conta',
      crossAccountBlobs.every((blob) => blob.bucketPath.includes(`/${blob.accountId}/`)),
    );

    const documentUrl = await mediaStore.save(
      `same-document-${suffix}`,
      SAME,
      { mimeType: 'application/pdf', fileName: 'contrato.pdf' },
      { accountId: ACCOUNT, inboxId: INBOX_A, kind: 'mensagem' },
    );
    const documentRow = await prisma.mediaObject.findUnique({
      where: { id: publicIdOf(documentUrl) },
    });
    check('mensagem preserva MIME próprio', documentRow?.mimeType === 'application/pdf');
    check('mensagem preserva nome próprio', documentRow?.fileName === 'contrato.pdf');

    console.log('\n2) Concorrência e reentrega');
    const concurrentUrls = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        mediaStore.save(
          `concurrent-${index}-${suffix}`,
          CONCURRENT,
          { mimeType: 'image/jpeg' },
          { accountId: ACCOUNT, inboxId: INBOX_A, kind: 'mensagem' },
        ),
      ),
    );
    check('cinco saves concorrentes devolvem URL', concurrentUrls.every(Boolean));
    check(
      'concorrência cria um blob',
      (await prisma.mediaBlob.count({
        where: { accountId: ACCOUNT, checksum: checksumOf(CONCURRENT) },
      })) === 1,
    );
    check(
      'concorrência cria cinco objetos',
      (await prisma.mediaObject.count({
        where: { accountId: ACCOUNT, checksum: checksumOf(CONCURRENT) },
      })) === 5,
    );

    const putsBeforeRepeat = fakePar.totalPuts();
    await mediaStore.save(
      `concurrent-0-${suffix}`,
      CONCURRENT,
      { mimeType: 'image/jpeg' },
      { accountId: ACCOUNT, inboxId: INBOX_A, kind: 'mensagem' },
    );
    check('reentrega do mesmo sourceId não faz PUT', fakePar.totalPuts() === putsBeforeRepeat);

    console.log('\n3) Avatar e falha de Storage');
    const avatarSource = `avatar-${suffix}`;
    const avatarData = Buffer.from(`avatar-${suffix}`);
    const avatarNew = Buffer.from(`avatar-novo-${suffix}`);
    const putsBeforeAvatar = fakePar.totalPuts();
    const avatarUrl = await mediaStore.save(
      avatarSource,
      avatarData,
      { mimeType: 'image/jpeg' },
      { accountId: ACCOUNT, kind: 'avatar' },
    );
    await mediaStore.save(
      avatarSource,
      avatarData,
      { mimeType: 'image/jpeg' },
      { accountId: ACCOUNT, kind: 'avatar' },
    );
    check('avatar igual faz um único PUT', fakePar.totalPuts() - putsBeforeAvatar === 1);
    const avatarRowBefore = await prisma.mediaObject.findUnique({
      where: { id: publicIdOf(avatarUrl) },
    });
    await mediaStore.save(
      avatarSource,
      avatarNew,
      { mimeType: 'image/jpeg' },
      { accountId: ACCOUNT, kind: 'avatar' },
    );
    const avatarRowAfter = await prisma.mediaObject.findUnique({
      where: { id: publicIdOf(avatarUrl) },
    });
    check('avatar novo faz outro PUT', fakePar.totalPuts() - putsBeforeAvatar === 2);
    check(
      'avatar novo preserva o caminho',
      avatarRowBefore?.bucketPath === avatarRowAfter?.bucketPath,
    );
    check('avatar não cria blob', avatarRowAfter?.blobId === null);

    fakePar.failNextPuts();
    const failedUrl = await mediaStore.save(
      `failed-${suffix}`,
      FAILED,
      { mimeType: 'image/png' },
      { accountId: ACCOUNT, inboxId: INBOX_A, kind: 'mensagem' },
    );
    check('falha no PUT devolve undefined', failedUrl === undefined);
    check(
      'falha no PUT não cria blob',
      (await prisma.mediaBlob.count({
        where: { accountId: ACCOUNT, checksum: checksumOf(FAILED) },
      })) === 0,
    );

    console.log('\n4) Rotas por mensagem e por blob');
    const firstId = publicIdOf(firstUrl);
    const secondId = publicIdOf(secondUrl);
    const requestMessage = (id: string, authorization?: string) =>
      messageRoute.GET(
        new Request(`http://localhost/api/whatsapp/media/${id}`, {
          headers: authorization ? { Authorization: authorization } : {},
        }),
        { params: Promise.resolve({ id }) },
      );

    cookieSession = sessionFor(ACCOUNT);
    const redirectA = await requestMessage(firstId);
    const redirectB = await requestMessage(secondId);
    check('cookie recebe 302 para mídia renderizável', redirectA.status === 302);
    check(
      'duplicadas recebem o mesmo Location',
      redirectA.headers.get('location') === redirectB.headers.get('location'),
    );

    cookieSession = null;
    const bearer = await requestMessage(firstId, `Bearer ${rawToken}`);
    check('Bearer recebe 200 direto', bearer.status === 200, String(bearer.status));
    check('Bearer recebe os bytes', Buffer.from(await bearer.arrayBuffer()).equals(SAME));

    cookieSession = sessionFor(ACCOUNT);
    const documentResponse = await requestMessage(publicIdOf(documentUrl));
    check('documento não redireciona', documentResponse.status === 200);
    const avatarResponse = await requestMessage(publicIdOf(avatarUrl));
    check('avatar não redireciona', avatarResponse.status === 200);

    const location = redirectA.headers.get('location') ?? '';
    const blobId = location.split('/').pop() ?? '';
    const requestBlob = (accountId: string, range?: string) => {
      cookieSession = sessionFor(accountId);
      return blobRoute.GET(
        new Request(`http://localhost${location}`, {
          headers: range ? { Range: range } : {},
        }),
        { params: Promise.resolve({ blobId }) },
      );
    };
    const foreignBlob = await requestBlob(OTHER_ACCOUNT);
    check('blob de outra conta responde 404', foreignBlob.status === 404);
    const ownBlob = await requestBlob(ACCOUNT);
    check('blob da conta responde 200', ownBlob.status === 200);
    check('blob é immutable', ownBlob.headers.get('cache-control')?.includes('immutable') === true);
    const rangedBlob = await requestBlob(ACCOUNT, 'bytes=0-3');
    check(
      'blob aceita Range',
      rangedBlob.status === 206 && (await rangedBlob.arrayBuffer()).byteLength === 4,
    );

    console.log('\n5) Backfill idempotente');
    const legacyData = Buffer.from(`legado-${suffix}`);
    const legacyChecksum = checksumOf(legacyData);
    const canonicalPath = `whatsapp-media/${BACKFILL_ACCOUNT}/antiga/canonico.bin`;
    const orphanPath = `whatsapp-media/${BACKFILL_ACCOUNT}/antiga/duplicado.bin`;
    fakePar.objects.set(canonicalPath, legacyData);
    fakePar.objects.set(orphanPath, legacyData);
    await prisma.mediaObject.createMany({
      data: [
        {
          id: `legacy-a-${suffix}`,
          accountId: BACKFILL_ACCOUNT,
          bucketPath: canonicalPath,
          mimeType: 'application/octet-stream',
          sizeBytes: legacyData.length,
          checksum: legacyChecksum,
          sourceId: `legacy-source-a-${suffix}`,
          scopeKey: 'sem-caixa',
          mediaKind: 'mensagem',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: `legacy-b-${suffix}`,
          accountId: BACKFILL_ACCOUNT,
          bucketPath: orphanPath,
          mimeType: 'application/octet-stream',
          sizeBytes: legacyData.length,
          checksum: legacyChecksum,
          sourceId: `legacy-source-b-${suffix}`,
          scopeKey: 'sem-caixa',
          mediaKind: 'mensagem',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    const simulation = await backfillMediaBlobs({
      apply: false,
      accountId: BACKFILL_ACCOUNT,
      quiet: true,
    });
    check('simulação relata duas linhas', simulation.linkedRows === 2);
    check(
      'simulação não cria blob',
      (await prisma.mediaBlob.count({ where: { accountId: BACKFILL_ACCOUNT } })) === 0,
    );
    check(
      'simulação não vincula linhas',
      (await prisma.mediaObject.count({
        where: { accountId: BACKFILL_ACCOUNT, blobId: { not: null } },
      })) === 0,
    );

    const applied = await backfillMediaBlobs({
      apply: true,
      accountId: BACKFILL_ACCOUNT,
      verify: true,
      quiet: true,
    });
    check('apply vincula duas linhas', applied.linkedRows === 2);
    check('apply cria um blob', applied.createdBlobs === 1);
    check(
      'lista um caminho órfão',
      applied.orphanPaths.length === 1 && applied.orphanPaths[0]?.bucketPath === orphanPath,
    );
    const linked = await prisma.mediaObject.findMany({ where: { accountId: BACKFILL_ACCOUNT } });
    check(
      'apply reponta para o canônico',
      linked.every((row) => row.bucketPath === canonicalPath && Boolean(row.blobId)),
    );

    const secondRun = await backfillMediaBlobs({
      apply: true,
      accountId: BACKFILL_ACCOUNT,
      quiet: true,
    });
    check(
      'segunda execução não muda nada',
      secondRun.groups === 0 && secondRun.linkedRows === 0 && secondRun.createdBlobs === 0,
    );
    const readA = await mediaStore.read(`legacy-a-${suffix}`, { accountId: BACKFILL_ACCOUNT });
    const readB = await mediaStore.read(`legacy-b-${suffix}`, { accountId: BACKFILL_ACCOUNT });
    check(
      'read continua servindo as duas linhas',
      Boolean(
        readA &&
        readB &&
        (await readA.bytes()).equals(legacyData) &&
        (await readB.bytes()).equals(legacyData),
      ),
    );

    check(
      'URLs das gravações são válidas',
      [firstUrl, secondUrl, thirdUrl, otherUrl].every(Boolean),
    );
  } finally {
    container.session.getSession = originalGetSession;
    await prisma.account.deleteMany({
      where: { id: { in: [ACCOUNT, OTHER_ACCOUNT, BACKFILL_ACCOUNT] } },
    });
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
        ? '\nTodos os testes de deduplicação passaram.\n'
        : `\n${failures.length} falha(s): ${failures.join(', ')}\n`,
    );
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error('\nErro no teste de deduplicação:', error);
    process.exit(1);
  });
