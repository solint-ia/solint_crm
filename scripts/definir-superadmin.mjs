/**
 * Liga (ou desliga) o superadministrador da plataforma.
 *
 * A migração `20260831220000_superadmin_de_plataforma` marca o e-mail combinado
 * no momento em que roda — mas migração roda uma vez só, e um usuário criado
 * *depois* dela nunca receberia a flag. Este script existe para esse caso, e é
 * idempotente: rodar de novo não muda nada.
 *
 *   node -r dotenv/config scripts/definir-superadmin.mjs alguem@exemplo.com
 *   node -r dotenv/config scripts/definir-superadmin.mjs alguem@exemplo.com --remover
 *
 * Quando o usuário ainda não existe — o caso do administrador da plataforma,
 * que não passa pelo cadastro normal porque não pertence a workspace nenhum —
 * ele pode ser criado aqui, com nome e senha:
 *
 *   node -r dotenv/config scripts/definir-superadmin.mjs alguem@exemplo.com
 *     --criar --nome="Nome da Pessoa" --senha="uma senha forte"
 *
 * A senha vai por argumento e fica no histórico do shell. É aceitável para uma
 * conta criada uma vez, por quem administra o banco — mas troque-a pelo próprio
 * produto depois, e limpe o histórico se a máquina for compartilhada.
 *
 * Usa `DIRECT_URL` (pooler em modo sessão) porque é script avulso, fora do
 * runtime da aplicação.
 */
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const [, , emailArg, ...flags] = process.argv;
const remover = flags.includes('--remover');
const criar = flags.includes('--criar');
const valorDe = (nome) => {
  const encontrado = flags.find((f) => f.startsWith(`--${nome}=`));
  return encontrado ? encontrado.slice(nome.length + 3) : undefined;
};

/**
 * Mesmo formato de `src/infrastructure/auth/password.ts`.
 *
 * Reescrito e não importado porque aquele arquivo é TypeScript com alias `@/`,
 * e este script roda em Node puro. O formato é o contrato: `scrypt$sal$hash`,
 * com sal de 16 bytes e chave de 64 — mudar qualquer um dos três aqui geraria
 * um hash que o login não reconhece.
 */
const scrypt = promisify(scryptCb);
const hashPassword = async (senha) => {
  const sal = randomBytes(16);
  const derivado = await scrypt(senha, sal, 64);
  return `scrypt$${sal.toString('hex')}$${derivado.toString('hex')}`;
};

if (!emailArg) {
  console.error('Uso: node -r dotenv/config scripts/definir-superadmin.mjs <email> [--remover]');
  process.exit(1);
}

// O e-mail é guardado em minúsculas (ver o comentário do campo no schema).
const email = emailArg.trim().toLowerCase();

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DIRECT_URL (ou DATABASE_URL) no ambiente.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) });

try {
  let user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });

  if (!user && !criar) {
    console.error(
      `Nenhum usuário com o e-mail ${email}.
` +
        'Crie a conta pelo produto, ou passe --criar --nome="..." --senha="..." aqui.',
    );
    process.exit(1);
  }

  if (!user) {
    const nome = valorDe('nome');
    const senha = valorDe('senha');
    if (!nome || !senha) {
      console.error('--criar exige --nome="..." e --senha="...".');
      process.exit(1);
    }
    // O mesmo piso do produto: uma senha curta aqui viraria a porta mais fraca
    // do sistema inteiro, já que esta conta enxerga todas as contas.
    if (senha.length < 10) {
      console.error('A senha do administrador da plataforma precisa de ao menos 10 caracteres.');
      process.exit(1);
    }

    // Sem `Membership`: quem administra a plataforma não pertence a workspace
    // nenhum, e `loginAction` já checa `isSuperAdmin` antes de exigir vínculo.
    user = await prisma.user.create({
      data: {
        id: `user-${randomBytes(6).toString('hex')}`,
        name: nome,
        email,
        passwordHash: await hashPassword(senha),
        avatarTone: 'var(--color-brand-deep)',
        isSuperAdmin: true,
      },
      select: { id: true, name: true },
    });
    console.log(`Conta criada para ${nome} (${email}).`);
  }

  await prisma.user.update({ where: { email }, data: { isSuperAdmin: !remover } });
  console.log(
    remover
      ? `${user.name} (${email}) deixou de ser superadministrador.`
      : `${user.name} (${email}) agora é superadministrador — entra em /plataforma.`,
  );

  const todos = await prisma.user.findMany({
    where: { isSuperAdmin: true },
    select: { email: true },
    orderBy: { email: 'asc' },
  });
  console.log('Superadministradores hoje:', todos.map((u) => u.email).join(', ') || '(nenhum)');
} finally {
  await prisma.$disconnect();
}
