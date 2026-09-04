/**
 * Teste do depósito de mídia contra o Supabase Storage real.
 *
 * A prova que importa é a do meio: **apagar o cache local e ler de novo**. Se a
 * leitura funcionar com o disco vazio, os bytes vieram do Storage — que é
 * exatamente a propriedade que faltava, e a causa dos `404` nas fotos de perfil.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../src/infrastructure/db/prisma';
import { isStorageConfigured } from '../src/infrastructure/storage/supabase-storage';
import { mediaStore } from '../src/infrastructure/whatsapp/wa-media-store';

const CACHE_DIR = path.resolve(process.cwd(), '.media', 'whatsapp');
const TMP_CACHE_DIR = path.join(os.tmpdir(), 'solint-crm', 'media', 'whatsapp');

/** PNG 1x1 valido — o menor conteudo real possivel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function main() {
  console.log('\n0) Configuracao');
  check('Storage configurado', isStorageConfigured());
  if (!isStorageConfigured()) return;

  const account = await prisma.account.findFirst({ select: { id: true } });
  if (!account) throw new Error('Nenhuma conta no banco para testar.');
  const inbox = await prisma.inbox.findFirst({
    where: { accountId: account.id, channel: 'whatsapp' },
    select: { id: true },
  });

  const id = 'teste-media-storage';
  const mediaScope = {
    accountId: account.id,
    ...(inbox ? { inboxId: inbox.id } : {}),
    kind: 'mensagem' as const,
  };

  console.log('\n1) Gravar (Storage + MediaObject + cache)');
  const url = await mediaStore.save(
    id,
    PNG,
    { mimeType: 'image/png', fileName: 'pixel.png' },
    mediaScope,
  );
  check(
    'save devolveu a URL da rota',
    Boolean(url?.startsWith('/api/whatsapp/media/')),
    url ?? '(nada)',
  );

  const row = await prisma.mediaObject.findFirst({
    where: { accountId: account.id, sourceId: id },
  });
  const publicId = row?.id ?? '';
  check('MediaObject registrado', Boolean(row), row?.bucketPath ?? '-');
  check(
    'caminho carrega o inquilino',
    Boolean(row?.bucketPath.includes(account.id)),
    `accountId=${account.id}`,
  );
  check('tamanho e checksum gravados', row?.sizeBytes === PNG.length && Boolean(row?.checksum));

  console.log('\n2) Ler com cache quente');
  const hot = await mediaStore.read(publicId, { accountId: account.id });
  check('leitura do cache', hot?.size === PNG.length, `${hot?.size} bytes, ${hot?.mimeType}`);
  check('bytes conferem', Boolean(hot && (await hot.bytes()).equals(PNG)));

  console.log('\n3) A prova: apagar o cache e ler de novo');
  await fsp.rm(CACHE_DIR, { recursive: true, force: true });
  const empty = await fsp.readdir(CACHE_DIR).catch(() => []);
  check('cache local vazio', empty.length === 0);

  const t0 = Date.now();
  const cold = await mediaStore.read(publicId, { accountId: account.id });
  check(
    'leitura com disco vazio (veio do Storage)',
    cold?.size === PNG.length,
    `${Date.now() - t0}ms`,
  );
  check('mimeType preservado', cold?.mimeType === 'image/png', cold?.mimeType ?? '-');
  check('nome do arquivo preservado', cold?.fileName === 'pixel.png', cold?.fileName ?? '-');
  check('bytes conferem', Boolean(cold && (await cold.bytes()).equals(PNG)));

  console.log('\n4) has() enxerga o que o outro processo gravou');
  await fsp.rm(CACHE_DIR, { recursive: true, force: true });
  check('has() sem cache local', await mediaStore.has(id, mediaScope));

  console.log('\n5) clear() nao destroi a midia');
  await mediaStore.clear();
  const survived = await mediaStore.read(publicId, { accountId: account.id });
  check(
    'mídia sobrevive ao clear() da desconexao',
    survived?.size === PNG.length,
    'era isto que quebrava os avatares',
  );

  // A prova que faltava. Todos os testes acima rodam num disco gravável, e é
  // por isso que passavam enquanto a produção respondia `404`: a leitura fria
  // gravava o cache e relia dele. Na função serverless da Vercel nada disso é
  // possível — `process.cwd()` é somente leitura —, e a leitura voltava vazia
  // com os bytes já em memória. Bloquear os dois diretórios candidatos
  // reproduz aquele ambiente sem depender de permissão de sistema de arquivos.
  console.log('\n6) Ler sem lugar nenhum para o cache (o caso da Vercel)');
  await mediaStore.clear();
  await fsp.rm(CACHE_DIR, { recursive: true, force: true });
  await fsp.rm(TMP_CACHE_DIR, { recursive: true, force: true });
  // Um *arquivo* onde o diretório deveria estar: o mkdir falha, como falharia
  // num sistema de arquivos somente leitura.
  await fsp.mkdir(path.dirname(CACHE_DIR), { recursive: true });
  await fsp.writeFile(CACHE_DIR, '', 'utf-8');
  await fsp.mkdir(path.dirname(TMP_CACHE_DIR), { recursive: true });
  await fsp.writeFile(TMP_CACHE_DIR, '', 'utf-8');

  try {
    const readOnly = await mediaStore.read(publicId, { accountId: account.id });
    check(
      'leitura funciona sem cache gravável',
      readOnly?.size === PNG.length,
      'era exatamente este o 404 das fotos de perfil',
    );
    check('bytes conferem', Boolean(readOnly && (await readOnly.bytes()).equals(PNG)));
  } finally {
    await fsp.rm(CACHE_DIR, { force: true });
    await fsp.rm(TMP_CACHE_DIR, { force: true });
  }

  // Limpeza
  await prisma.mediaObject
    .deleteMany({ where: { accountId: account.id, sourceId: id } })
    .catch(() => undefined);
  await fsp.rm(CACHE_DIR, { recursive: true, force: true });
}

main()
  .then(async () => {
    console.log(
      failures.length === 0
        ? '\nTodos os testes passaram.\n'
        : `\n${failures.length} falha(s): ${failures.join(', ')}\n`,
    );
    await prisma.$disconnect();
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\nErro no teste:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
