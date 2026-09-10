#!/usr/bin/env node
/**
 * Copia a mídia do Supabase Storage para o OCI Object Storage. Uso único, na
 * migração.
 *
 * Cada objeto `{caminho}` do bucket `{bucket}` no Supabase vira o objeto
 * `{bucket}/{caminho}` sob a PAR — o mesmo nome que o adaptador
 * (`src/infrastructure/storage/supabase-storage.ts`) monta para ler, e o mesmo
 * texto que `MediaObject.bucketPath` já guarda. Nada no banco precisa mudar.
 *
 * Pode rodar de novo: o `PUT` sobrescreve, então uma segunda passada só
 * completa o que a primeira não levou.
 *
 * Na VM, sem instalar nada (o .env da raiz traz a OBJECT_STORAGE_PAR_URL):
 *   docker run --rm --env-file .env \
 *     -e SUPABASE_URL=https://REF.supabase.co -e SUPABASE_SECRET_KEY=... \
 *     -v "$PWD/deploy:/deploy:ro" node:22-bookworm-slim node /deploy/copy-storage.mjs
 */

const BUCKETS = ['whatsapp-media', 'whatsapp-avatars'];
const CONCURRENCY = 8;
const PAGE = 1000;

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const par = process.env.OBJECT_STORAGE_PAR_URL?.trim();

if (!supabaseUrl || !supabaseKey || !par) {
  console.error('Defina SUPABASE_URL, SUPABASE_SECRET_KEY e OBJECT_STORAGE_PAR_URL.');
  process.exit(2);
}

const parBase = par.endsWith('/') ? par : `${par}/`;
const auth = { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey };

/** Lista um nível de pasta. Pasta vem com `id: null`; arquivo, com id. */
const listLevel = async (bucket, prefix) => {
  const items = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });
    if (!response.ok) {
      throw new Error(`listar ${bucket}/${prefix}: ${response.status} ${await response.text()}`);
    }
    const page = await response.json();
    items.push(...page);
    if (page.length < PAGE) return items;
  }
};

/**
 * Todos os caminhos de arquivo de um bucket, descendo pelas pastas.
 *
 * A pasta vai como prefixo SEM barra final (`acc-1/ibx-2`), do jeito que o
 * `supabase-js` chama `list('acc-1/ibx-2')`: a função `storage.search` do
 * Supabase conta os níveis separando o prefixo por `/`, e a barra final
 * acrescentaria um nível vazio. Os nomes voltam relativos à pasta.
 */
const listAll = async (bucket, folder = '') => {
  const paths = [];
  for (const item of await listLevel(bucket, folder)) {
    const path = folder ? `${folder}/${item.name}` : item.name;
    if (item.id === null) paths.push(...(await listAll(bucket, path)));
    else paths.push(path);
  }
  return paths;
};

const copyOne = async (bucket, path) => {
  const from = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    headers: auth,
  });
  if (!from.ok) throw new Error(`ler: ${from.status}`);
  const body = new Uint8Array(await from.arrayBuffer());

  // A URL da PAR nunca vai para o log: ela é o segredo do bucket.
  const to = await fetch(`${parBase}${encodeURI(`${bucket}/${path}`)}`, {
    method: 'PUT',
    headers: { 'Content-Type': from.headers.get('content-type') || 'application/octet-stream' },
    body,
  });
  if (!to.ok) throw new Error(`gravar: ${to.status} ${await to.text()}`);
  return body.byteLength;
};

let copied = 0;
let bytes = 0;
const failures = [];

for (const bucket of BUCKETS) {
  const paths = await listAll(bucket);
  console.log(`${bucket}: ${paths.length} objeto(s)`);

  let next = 0;
  const lane = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      try {
        bytes += await copyOne(bucket, path);
        copied += 1;
        if (copied % 100 === 0) console.log(`  ... ${copied} copiados`);
      } catch (error) {
        failures.push(`${bucket}/${path}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
}

console.log(`\nCopiados: ${copied} objeto(s), ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
if (failures.length > 0) {
  console.error(`Falharam ${failures.length}. Rode de novo para completar:`);
  for (const failure of failures.slice(0, 50)) console.error(`  - ${failure}`);
  process.exit(1);
}
