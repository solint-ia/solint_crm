'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { landingRouteFor } from '@/config/navigation';
import type { Permission } from '@/core/domain/user';
import { SYSTEM_ROLES, systemRoleId } from '@/core/domain/system-roles';
import { defaultBusinessHours } from '@/core/domain/business-hours';
import { hashPassword, passwordProblem, verifyPassword } from '@/infrastructure/auth/password';
import { createSession, destroyCurrentSession, touchUser } from '@/infrastructure/auth/session';
import { prisma, asJson } from '@/infrastructure/db/prisma';

export interface AuthActionResult {
  readonly ok: boolean;
  readonly error?: string;
  /**
   * Para onde ir depois de entrar.
   *
   * Decidido aqui, e não no formulário, porque só o servidor conhece as
   * permissões do papel — o cliente teria de adivinhar, e adivinhava
   * `/dashboard` para todo mundo.
   */
  readonly destino?: string;
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

  const role = await prisma.role.findFirst({
    where: { accountId: membership.accountId, slug: membership.roleSlug },
    select: { permissions: true },
  });
  const permissions = (
    Array.isArray(role?.permissions) ? role.permissions : []
  ) as readonly Permission[];

  return { ok: true, destino: landingRouteFor(permissions) };
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
    // Os dois papéis nascem com a conta. Antes só o de administrador era
    // criado, e quem convidasse um colaborador só podia oferecer acesso total
    // — não havia outro papel para escolher.
    await tx.role.createMany({
      data: SYSTEM_ROLES.map((role) => ({
        id: systemRoleId(accountId, role.slug),
        accountId,
        slug: role.slug,
        name: role.name,
        description: role.description,
        permissions: asJson(role.permissions),
        isSystem: true,
      })),
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
        // Forma canônica do domínio. Antes gravava `{ enabled, timezone, schedule }`
        // — outra forma, de uma versão anterior — e toda conta criada pelo
        // cadastro nascia com a tela de Configurações quebrada.
        businessHours: asJson(defaultBusinessHours()),
        // `text`, nunca `message`. O campo já se chamou `message` aqui e o
        // domínio sempre leu `text`: a caixa nascia sem texto nenhum e a tela
        // de Configurações recusava salvar qualquer alteração nela.
        awayMessage: asJson({ enabled: false, text: '' }),
        greeting: asJson({ enabled: false, text: '' }),
        closingMessage: asJson({ enabled: false, text: '' }),
        waitingMessage: asJson({ enabled: false, text: '' }),
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
        {
          id: `stg-5-${accountId}`,
          pipelineId,
          name: 'Fechado',
          order: 5,
          color: '#10b981',
          isWon: true,
        },
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
