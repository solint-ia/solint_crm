'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { PERMISSIONS } from '@/core/domain/user';
import { hashPassword, passwordProblem, verifyPassword } from '@/infrastructure/auth/password';
import { createSession, destroyCurrentSession, touchUser } from '@/infrastructure/auth/session';
import { prisma, asJson } from '@/infrastructure/db/prisma';

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

  // Em qual workspace abrir. O mais antigo é o padrão razoável; trocar de conta
  // é uma ação depois de entrar, não uma escolha na tela de login.
  // tenant-ok: entre contas por necessidade — no login ainda nao ha conta ativa,
  // e e justamente esta consulta que decide qual sera.
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) {
    // Aqui a senha já está certa, então não há mais o que proteger contra
    // enumeração: vale dizer a verdade em vez de repetir "e-mail ou senha".
    return settle(started, {
      ok: false,
      error: 'Sua conta não está vinculada a nenhum workspace. Fale com o administrador.',
    });
  }

  const meta = await requestMeta();
  await createSession(user.id, membership.accountId, meta);
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
        permissions: asJson(PERMISSIONS),
        isSystem: true,
      },
    });
    await tx.user.create({
      data: {
        id: userId,
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        avatarTone: 'var(--color-brand-deep)',
      },
    });
    // Quem cria a conta é administrador dela. Papel, equipes e disponibilidade
    // vivem no vínculo: são do par pessoa+conta, não da pessoa.
    await tx.membership.create({
      data: {
        userId,
        accountId,
        roleSlug: 'administrador',
        availability: 'disponivel',
      },
    });
    await tx.accountSettings.create({
      data: {
        accountId,
        billing: asJson({
          planName: 'Starter',
          priceLabel: 'Gratuito',
          renewalLabel: '—',
          usage: [],
          invoices: [],
        }),
      },
    });
    // Caixa de entrada padrão
    await tx.inbox.create({
      data: {
        id: `ibx-${accountId}`,
        accountId,
        name: 'WhatsApp Principal',
        channel: 'whatsapp',
        identifier: 'whatsapp-primary',
        status: 'ativo',
        provider: 'baileys',
        businessHours: asJson({ enabled: false, timezone: 'America/Sao_Paulo', schedule: [] }),
        awayMessage: asJson({ enabled: false, message: '' }),
        greeting: asJson({ enabled: false, message: '' }),
      },
    });
    // Funil de vendas comercial padrão
    const pipelineId = `pip-${accountId}`;
    await tx.pipeline.create({
      data: {
        id: pipelineId,
        accountId,
        name: 'Funil Comercial',
      },
    });
    await tx.pipelineStage.createMany({
      data: [
        { id: `stg-1-${accountId}`, pipelineId, name: 'Novo Lead', order: 1, color: '#3b82f6' },
        { id: `stg-2-${accountId}`, pipelineId, name: 'Qualificação', order: 2, color: '#f59e0b' },
        { id: `stg-3-${accountId}`, pipelineId, name: 'Proposta', order: 3, color: '#8b5cf6' },
        { id: `stg-4-${accountId}`, pipelineId, name: 'Negociação', order: 4, color: '#ec4899' },
        { id: `stg-5-${accountId}`, pipelineId, name: 'Fechado', order: 5, color: '#10b981', isWon: true },
      ],
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
