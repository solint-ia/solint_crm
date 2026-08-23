'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { PERMISSIONS } from '@/core/domain/user';
import { hashPassword, passwordProblem, verifyPassword } from '@/infrastructure/auth/password';
import { createSession, destroyCurrentSession, touchUser } from '@/infrastructure/auth/session';
import { prisma, toJson } from '@/infrastructure/db/prisma';

export interface AuthActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Atraso mínimo de resposta em falha de login.
 *
 * Sem ele, "e-mail inexistente" responde na hora e "senha errada" demora o
 * tempo do scrypt — a diferença entrega quais e-mails existem na base. O piso
 * de tempo iguala os dois caminhos.
 */
const MIN_FAILURE_MS = 400;

const settle = async <T>(started: number, value: T): Promise<T> => {
  const elapsed = Date.now() - started;
  if (elapsed < MIN_FAILURE_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_FAILURE_MS - elapsed));
  }
  return value;
};

const requestMeta = async () => {
  const list = await headers();
  return {
    userAgent: list.get('user-agent') ?? undefined,
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  };
};

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

export async function loginAction(input: unknown): Promise<AuthActionResult> {
  const started = Date.now();
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Mensagem única para e-mail inexistente e senha errada: dizer qual dos dois
  // falhou transforma a tela de login num verificador de cadastro.
  const invalid = { ok: false as const, error: 'E-mail ou senha inválidos.' };
  if (!user) return settle(started, invalid);

  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) return settle(started, invalid);

  const meta = await requestMeta();
  await createSession(user.id, user.accountId, meta);
  await touchUser(user.id);

  return { ok: true };
}

export async function logoutAction(): Promise<never> {
  await destroyCurrentSession();
  redirect('/login');
}

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto.'),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  company: z.string().trim().min(2, 'Informe o nome da empresa.'),
  password: z.string(),
});

/**
 * Cadastro: cria a conta, o papel de administrador e o primeiro usuário.
 *
 * Os três nascem juntos numa transação. Uma conta sem administrador seria
 * inacessível, e um usuário sem papel não teria permissão nenhuma — meio
 * cadastro é pior que nenhum.
 */
export async function signupAction(input: unknown): Promise<AuthActionResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const weak = passwordProblem(parsed.data.password);
  if (weak) return { ok: false, error: weak };

  const taken = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (taken) return { ok: false, error: 'Já existe uma conta com este e-mail.' };

  const accountId = `acc-${Date.now().toString(36)}`;
  const userId = `user-${Date.now().toString(36)}`;
  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.$transaction(async (tx) => {
    await tx.account.create({
      data: { id: accountId, name: parsed.data.company, plan: 'starter' },
    });
    await tx.role.create({
      data: {
        id: `role-admin-${accountId}`,
        accountId,
        slug: 'administrador',
        name: 'Administrador',
        description: 'Acesso total, incluindo faturamento, integrações e segurança.',
        permissionsJson: toJson(PERMISSIONS),
        isSystem: true,
      },
    });
    await tx.user.create({
      data: {
        id: userId,
        accountId,
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        roleSlug: 'administrador',
        avatarTone: 'var(--color-brand-deep)',
        availability: 'disponivel',
        teamsJson: '[]',
      },
    });
    await tx.accountSettings.create({
      data: { accountId, billingJson: toJson({
        planName: 'Starter',
        priceLabel: 'Gratuito',
        renewalLabel: '—',
        usage: [],
        invoices: [],
      }) },
    });
  });

  const meta = await requestMeta();
  await createSession(userId, accountId, meta);

  return { ok: true };
}

const recoverSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
});

/**
 * Recuperação de senha.
 *
 * Responde igual para e-mail existente e inexistente — a tela de recuperação é
 * o outro lugar clássico onde se enumera a base de usuários. O envio do e-mail
 * em si depende de um serviço de entrega, que ainda não existe no projeto.
 */
export async function recoverPasswordAction(input: unknown): Promise<AuthActionResult> {
  const parsed = recoverSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Informe um e-mail válido.' };
  }
  return { ok: true };
}
