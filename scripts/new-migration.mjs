/**
 * Cria uma migração comparando o banco com o `schema.prisma`.
 *
 * **Por que isto existe, em vez de `prisma migrate dev`.** O `migrate dev`
 * precisa de um *shadow database* — um banco descartável onde ele reaplica o
 * histórico para calcular o diff. No Supabase o usuário do pooler não pode
 * `CREATE DATABASE`, e o comando morre com `P1017: server has closed the
 * connection`, que não diz nada sobre shadow database.
 *
 * A primeira migração passa porque, com o banco vazio, não há o que diferenciar.
 * A segunda é que falha — normalmente longe do momento em que dava para
 * entender o motivo.
 *
 * Aqui o diff é feito direto contra o banco real (`migrate diff`), gravado como
 * migração e aplicado com `migrate deploy`, que não usa shadow database.
 *
 *   npm run db:migrate -- nome-da-migracao
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const name = process.argv[2];

if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Uso: npm run db:migrate -- nome-em-minusculas-com-hifens');
  process.exit(1);
}

// Chama o binário do Prisma direto pelo Node, sem shell: passar argumentos por
// shell no Windows os concatena sem escapar, e o próprio Node avisa (DEP0190).
const PRISMA = path.join('node_modules', 'prisma', 'build', 'index.js');

const run = (args) => execFileSync(process.execPath, [PRISMA, ...args], { encoding: 'utf-8' });

// `--exit-code` faz o comando devolver 2 quando há diferença. Sem ele, um
// esquema já sincronizado geraria uma migração vazia e um commit inútil.
let sql;
try {
  sql = run([
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
    '--exit-code',
  ]);
  console.log('Nada a migrar: o banco já corresponde ao esquema.');
  process.exit(0);
} catch (error) {
  if (error.status !== 2) {
    console.error(error.stdout ?? error.message);
    process.exit(1);
  }
  sql = error.stdout;
}

// A primeira linha é o cabeçalho do CLI, não SQL.
const body = sql
  .split('\n')
  .filter((line) => !line.startsWith('Loaded Prisma config'))
  .join('\n')
  .trim();

if (!body) {
  console.log('Diff vazio.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

const dir = path.join('prisma', 'migrations', `${stamp}_${name.replace(/-/g, '_')}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'migration.sql'), `${body}\n`, 'utf-8');

console.log(`\nMigração escrita em ${dir}\n`);
console.log(
  body
    .split('\n')
    .filter((l) => l.startsWith('--'))
    .join('\n'),
);
console.log('\nAplicando...\n');

console.log(run(['migrate', 'deploy']));
