/**
 * Verificação da Fase 0: as três conexões do Supabase respondem?
 *
 * Existe porque os três erros mais comuns nesta etapa apontam todos para o
 * lugar errado:
 *
 *   - senha com `@` não codificado  -> `ENOTFOUND` (parece erro de DNS)
 *   - host direto, rede sem IPv6    -> `ENETUNREACH` (parece firewall)
 *   - usuário `postgres` no pooler  -> `28P01` (parece senha errada)
 *
 * Este script traduz cada um deles para a causa real. Rode com:
 *   npm run db:check
 */
import { Buffer } from 'node:buffer';
import pg from 'pg';

/** Papel de cada URL. `listen` só é verdadeiro onde `LISTEN` precisa funcionar. */
const TARGETS = [
  {
    env: 'DATABASE_URL',
    role: 'runtime da aplicação',
    expect: { port: 6543, pgbouncer: true, listen: false },
  },
  {
    env: 'DIRECT_URL',
    role: 'migrações (prisma migrate)',
    expect: { port: 5432, pgbouncer: false, listen: false },
  },
  {
    env: 'WORKER_DATABASE_URL',
    role: 'worker de WhatsApp (Fase 3)',
    expect: { port: 5432, pgbouncer: false, listen: true },
    optional: true,
  },
];

const PLACEHOLDER = /PROJECT_REF|SENHA_CODIFICADA|REGIAO/;

/** Traduz o erro do driver para a causa provável, que raramente é a literal. */
const explain = (error, url) => {
  const code = error.code ?? '';
  const message = error.message ?? String(error);

  if (code === 'ENOTFOUND') {
    return url && url.password === ''
      ? 'host não resolvido — e a senha está vazia na URL. Quase sempre é `@` não codificado na senha: use %40.'
      : 'host não resolvido. Confira o nome no painel e se a senha tem caracteres que precisam de %-encoding.';
  }
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    return 'host inalcançável. O host direto `db.<ref>.supabase.co` só tem endereço IPv6 — troque pelo pooler `aws-0-<regiao>.pooler.supabase.com`, que tem IPv4.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
    return 'sem resposta na porta. Confira a porta (6543 = transação, 5432 = sessão) e se a saída para a internet está liberada.';
  }
  if (code === '28P01') {
    return 'autenticação recusada. No pooler o usuário é `postgres.<PROJECT_REF>`, não `postgres` — este é o erro mais comum ao copiar a senha e esquecer o usuário.';
  }
  if (code === '3D000') return 'banco inexistente. No Supabase o nome é `postgres`.';
  if (code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'certificado recusado. Acrescente `?sslmode=require` à URL.';
  }
  return message;
};

const parse = (raw) => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const check = async (target) => {
  const raw = process.env[target.env];
  const label = `${target.env}  (${target.role})`;

  if (!raw) {
    return { label, level: target.optional ? 'skip' : 'fail', note: 'não definida no .env' };
  }
  if (PLACEHOLDER.test(raw)) {
    return {
      label,
      level: 'fail',
      note: 'ainda contém marcador do .env.example — não foi preenchida',
    };
  }
  if (!/^postgres(ql)?:\/\//.test(raw)) {
    // Sem esta checagem, uma URL de SQLite chega ao driver e volta como
    // "SASL: client password must be a string" -- erro de autenticacao para
    // um problema de esquema de URL.
    const kind = raw.startsWith('file:') ? 'ainda aponta para SQLite' : 'esquema desconhecido';
    return { label, level: 'fail', note: `não é uma URL Postgres (${kind})` };
  }

  const url = parse(raw);
  const warnings = [];

  if (url) {
    const port = Number(url.port || 5432);
    if (port !== target.expect.port) {
      warnings.push(`porta ${port}, esperada ${target.expect.port}`);
    }
    const hasPgbouncer = raw.includes('pgbouncer=true');
    if (target.expect.pgbouncer && !hasPgbouncer) {
      warnings.push('falta `pgbouncer=true` — o modo transação não suporta prepared statements');
    }
    if (!target.expect.pgbouncer && hasPgbouncer) {
      warnings.push('`pgbouncer=true` aqui é errado: esta URL precisa de sessão');
    }
    if (url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co')) {
      warnings.push('host direto (só IPv6). Prefira o pooler.');
    }
    if (url.hostname.includes('pooler') && !url.username.includes('.')) {
      warnings.push('no pooler o usuário deve ser `postgres.<PROJECT_REF>`');
    }
    // `\b` no fim importa: sem ele, `connection_limit=10` casa por prefixo.
    if (/connection_limit=1\b/.test(raw) && target.env === 'WORKER_DATABASE_URL') {
      warnings.push(
        '`connection_limit=1` no worker: ele grava lotes e mantém LISTEN ao mesmo tempo',
      );
    }
  }

  const client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 12_000 });

  try {
    await client.connect();
    const { rows } = await client.query(
      "select current_user as usuario, current_database() as banco, split_part(version(), ' ', 2) as versao",
    );
    const info = rows[0];

    // `LISTEN` no modo transação do pgBouncer conecta e depois não entrega nada:
    // falha silenciosa. Melhor descobrir aqui do que na Fase 6.
    if (target.expect.listen) {
      await client.query('LISTEN solint_check');
      await client.query('UNLISTEN solint_check');
    }

    return {
      label,
      level: warnings.length > 0 ? 'warn' : 'ok',
      note: `Postgres ${info.versao} · usuário ${info.usuario} · banco ${info.banco}`,
      warnings,
    };
  } catch (error) {
    return { label, level: 'fail', note: explain(error, url), warnings };
  } finally {
    await client.end().catch(() => undefined);
  }
};

const ICON = { ok: '  OK  ', warn: ' AVISO', fail: ' FALHA', skip: ' PULA ' };

const main = async () => {
  console.log('\nVerificando as conexões do Supabase\n');

  const results = [];
  for (const target of TARGETS) {
    const result = await check(target);
    results.push(result);
    console.log(`[${ICON[result.level]}] ${result.label}`);
    console.log(`          ${result.note}`);
    for (const warning of result.warnings ?? []) console.log(`          · ${warning}`);
    console.log('');
  }

  // A chave de cifra é da Fase 3, mas custa uma linha checar agora e evita
  // descobrir que ela tem 31 bytes no meio de um pareamento.
  const key = Buffer.from(process.env.WA_ENCRYPTION_KEY ?? '', 'base64url');
  const keyOk = key.length === 32;
  console.log(`[${keyOk ? ICON.ok : ICON.fail}] WA_ENCRYPTION_KEY`);
  console.log(
    `          ${keyOk ? '32 bytes' : `${key.length} bytes — precisa de exatamente 32 em base64url`}\n`,
  );

  const failed = results.some((r) => r.level === 'fail') || !keyOk;
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
