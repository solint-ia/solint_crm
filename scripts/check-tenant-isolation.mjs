/**
 * Confere que nenhuma consulta Prisma escapa sem o `accountId`.
 *
 * **Por que isto existe.** Com o Prisma conectando como dono das tabelas, o RLS
 * do Postgres não faz nada: o dono ignora as políticas. O isolamento entre
 * inquilinos é, portanto, disciplina de aplicação — e as 10 portas em
 * `src/core/ports` já recebem `accountId` como primeiro parâmetro, sem exceção.
 *
 * O que faltava era tornar essa disciplina **verificável**. Um `findMany`
 * distraído sem `where: { accountId }` compila, passa nos testes de uma conta
 * só, e vaza dado de cliente na segunda. Este script é o que pega isso.
 *
 * O que ele NÃO prova: que as consultas escopadas pelo pai (mensagem por
 * conversa, etapa por funil) estão certas. Essas ele lista para leitura humana,
 * porque provar estaticamente exigiria seguir a origem do id.
 *
 *   npm run check:tenant
 */
import fs from 'node:fs';
import path from 'node:path';

/** Modelos com coluna `accountId`: toda consulta tem de citá-la. */
const SCOPED = new Set([
  'contact',
  'conversation',
  'label',
  'pipeline',
  'deal',
  'aiAgent',
  'notification',
  'automation',
  'inbox',
  'knowledgeCategory',
  'knowledgeArticle',
  'accountSettings',
  'role',
  'membership',
  'team',
  'webhook',
  'apiToken',
  'customAttributeDefinition',
  'cannedResponse',
  'macro',
  'auditLogEntry',
  'campaign',
  'segment',
  'messageTemplate',
  'invite',
  'task',
  'mediaObject',
]);

/** Escopados pelo pai. Listados para leitura, não cobrados. */
const VIA_PARENT = new Set([
  'message',
  'pipelineStage',
  'authSession',
  'whatsAppConnection',
  'whatsAppKey',
  'whatsAppCommand',
  'campaignRecipient',
]);

/** Globais de propósito: a pessoa e a conta não pertencem a uma conta. */
const GLOBAL = new Set(['user', 'account']);

/** Métodos que leem ou escrevem linhas — `$transaction` e afins não entram. */
const METHODS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
  'create',
  'createMany',
]);

const ROOTS = [
  'src/infrastructure/repositories/prisma',
  'src/infrastructure/whatsapp',
  'src/infrastructure/auth',
  'src/app',
];

const walk = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

/** Lê o argumento entre parênteses balanceados a partir de `open`. */
const readArgs = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
};

const CALL = /\bprisma\.([a-zA-Z]+)\.([a-zA-Z]+)\s*\(/g;
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Exceção explícita: `// tenant-ok: <motivo>` nas três linhas acima da consulta.
 *
 * Consulta deliberadamente entre contas existe — listar os workspaces de uma
 * pessoa é exatamente isso. O que não pode existir é exceção **silenciosa**: o
 * marcador obriga a escrever o motivo ao lado do código, onde quem revisar vai
 * ler. Afrouxar o script globalmente esconderia as duas legítimas junto com a
 * próxima ilegítima.
 */
const isAllowed = (lines, line) =>
  lines.slice(Math.max(0, line - 4), line - 1).some((row) => /\/\/\s*tenant-ok:/.test(row));

const violations = [];
const parentScoped = [];
const exceptions = [];
let checked = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf-8');
    const lines = text.split(/\r?\n/);
    const rel = file.replace(/\\/g, '/');

    for (const match of text.matchAll(CALL)) {
      const [, model, method] = match;
      if (!METHODS.has(method)) continue;

      const args = readArgs(text, match.index + match[0].length - 1);
      const line = lineOf(text, match.index);
      const where = `${rel}:${line}`;

      if (GLOBAL.has(model)) continue;

      if (VIA_PARENT.has(model)) {
        parentScoped.push(`${where}  prisma.${model}.${method}`);
        continue;
      }

      if (!SCOPED.has(model)) {
        violations.push(`${where}  modelo desconhecido: '${model}' — acrescente-o a este script`);
        continue;
      }

      if (isAllowed(lines, line)) {
        exceptions.push(`${where}  prisma.${model}.${method}`);
        continue;
      }

      checked += 1;
      if (!/\baccountId\b/.test(args)) {
        violations.push(`${where}  prisma.${model}.${method} sem accountId`);
      }
    }
  }
}

console.log(`\nIsolamento por conta: ${checked} consultas verificadas em modelos com accountId\n`);

if (parentScoped.length > 0) {
  console.log(`Escopadas pelo pai (${parentScoped.length}) — não cobradas, leia se mudar algo:`);
  for (const item of parentScoped) console.log(`  · ${item}`);
  console.log('');
}

if (exceptions.length > 0) {
  console.log(`Exceções declaradas com // tenant-ok: (${exceptions.length}):`);
  for (const item of exceptions) console.log(`  · ${item}`);
  console.log('');
}

if (violations.length > 0) {
  console.error(`FALHA — ${violations.length} consulta(s) sem escopo de conta:\n`);
  for (const item of violations) console.error(`  ✗ ${item}`);
  console.error('');
  process.exit(1);
}

console.log('OK — nenhuma consulta escapou.\n');
