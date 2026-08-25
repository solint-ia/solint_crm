#!/usr/bin/env node
/**
 * Empacota o worker de WhatsApp num único arquivo ESM.
 *
 * **Por que empacotar em vez de rodar o TypeScript direto.** O projeto é
 * CommonJS (não há `type: module` no package.json), então o `tsx` carrega os
 * `.ts` pelo resolvedor CJS. O Baileys 7 é ESM e depende de
 * `whatsapp-rust-bridge`, que declara apenas a condição `import` nos seus
 * `exports`: pelo caminho CJS o `require` não acha nada e o worker morre no boot
 * com `ERR_PACKAGE_PATH_NOT_EXPORTED`. Era exatamente por isso que
 * `npm run worker` nunca chegou a subir — o arquivo existia, o comando existia,
 * e nada nunca rodou.
 *
 * Forçar o loader ESM do `tsx` também não resolve: o grafo mistura CJS e ESM e
 * esbarra em `ERR_REQUIRE_CYCLE_MODULE`. O esbuild resolve o mesmo `import` que
 * o Next resolve e entrega um `.mjs` de verdade, sem ambiguidade de loader.
 *
 * O cliente Prisma gerado fica **de fora** do pacote: ele carrega motores em
 * tempo de execução e, embutido, cai em `Dynamic require of ... is not
 * supported`. Sai como import de URL de arquivo, que o Node resolve sozinho.
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.cwd();
const generatedPrisma = pathToFileURL(
  path.join(root, 'src', 'generated', 'prisma', 'index.js'),
).href;

/** Mantém o cliente gerado fora do pacote, endereçado por URL absoluta. */
const externalizeGeneratedPrisma = {
  name: 'externalize-generated-prisma',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@\/generated\/prisma$/ }, () => ({
      path: generatedPrisma,
      external: true,
    }));
  },
};

await build({
  entryPoints: ['src/worker.mts'],
  outfile: '.worker/worker.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Dependências continuam externas: empacotá-las não traria ganho e quebraria
  // os pacotes que carregam binário nativo (Prisma, pg, Baileys).
  packages: 'external',
  plugins: [externalizeGeneratedPrisma],
  sourcemap: 'inline',
  logLevel: 'warning',
});

console.log('[build-worker] .worker/worker.mjs pronto.');
