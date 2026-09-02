'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { landingRouteFor } from '@/config/navigation';
import type { Permission, PermissionOverrides } from '@/core/domain/user';
import { effectivePermissions } from '@/core/domain/user';
import { verifyPassword } from '@/infrastructure/auth/password';
import { createSession, destroyCurrentSession, touchUser } from '@/infrastructure/auth/session';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';

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

  // Em qual workspace abrir. O mais antigo é o padrão razoável; trocar de conta
  // é uma ação depois de entrar, não uma escolha na tela de login.
  // Contas suspensas ou excluídas ficam de fora da escolha: entrar numa delas
  // acabaria em `readSession()` devolvendo `null` e no laço de redirecionamento
  // para o login, sem nunca dizer por quê. Ver a nota de `account.status`.
  // tenant-ok: entre contas por necessidade — no login ainda nao ha conta ativa,
  // e e justamente esta consulta que decide qual sera.
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, account: { status: 'ativa' } },
    orderBy: { createdAt: 'asc' },
  });

  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) {
    if (membership) {
      const meta = await requestMeta();
      void writeAuditLog({
        accountId: membership.accountId,
        actorId: user.id,
        actorName: user.name,
        action: 'sessao.login_falhou',
        targetType: 'sessao',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return settle(started, invalid);
  }

  /**
   * O superadministrador entra pela área de plataforma.
   *
   * Checado **antes** da exigência de vínculo porque quem administra webhooks e
   * tokens de todas as contas normalmente não é membro de nenhuma — sem isto, o
   * login dele terminaria em "não está vinculada a nenhum workspace". O `act` do
   * token fica com a primeira conta quando existe uma, ou com string vazia: a
   * área `/plataforma` não usa esse campo, ela resolve a identidade por `sub`.
   */
  if (user.isSuperAdmin) {
    const meta = await requestMeta();
    await createSession(user.id, membership?.accountId ?? '', meta);
    await touchUser(user.id);
    return { ok: true, destino: '/plataforma' };
  }

  if (!membership) {
    // Aqui a senha já está certa, então não há mais o que proteger contra
    // enumeração: vale dizer a verdade em vez de repetir "e-mail ou senha".
    //
    // As duas verdades são diferentes, e confundi-las manda a pessoa procurar a
    // pessoa errada: "sem workspace" é assunto do administrador dela;
    // "suspenso" é assunto de quem administra a plataforma, e o administrador
    // dela não tem como resolver.
    // tenant-ok: mesma razao da consulta acima — nao ha conta ativa no login, e
    // esta pergunta e justamente sobre o estado das contas desta pessoa.
    const suspenso = await prisma.membership.findFirst({
      where: { userId: user.id },
      select: { account: { select: { status: true, suspendedReason: true } } },
    });
    if (suspenso && suspenso.account.status !== 'ativa') {
      return settle(started, {
        ok: false,
        error:
          suspenso.account.suspendedReason?.trim() ||
          'O acesso desta empresa está suspenso. Fale com o suporte Solint.',
      });
    }
    return settle(started, {
      ok: false,
      error: 'Sua conta não está vinculada a nenhum workspace. Fale com o administrador.',
    });
  }

  const meta = await requestMeta();
  await createSession(user.id, membership.accountId, meta);
  await touchUser(user.id);
  void writeAuditLog({
    accountId: membership.accountId,
    actorId: user.id,
    actorName: user.name,
    action: 'sessao.login',
    targetType: 'sessao',
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const role = await prisma.role.findFirst({
    where: { accountId: membership.accountId, slug: membership.roleSlug },
    select: { permissions: true },
  });
  // Mesmo cálculo de `readSession()`: o destino do login precisa considerar a
  // personalização individual, senão alguém com o Kanban concedido à parte
  // cairia numa tela que o papel dele sozinho não abriria.
  const permissions = effectivePermissions(
    (Array.isArray(role?.permissions) ? role.permissions : []) as readonly Permission[],
    readJson<PermissionOverrides | null>(membership.permissionOverrides, null),
  );

  return { ok: true, destino: landingRouteFor(permissions) };
}

/**
 * Sair não vira linha de auditoria.
 *
 * Era `sessao.logout`, e não respondia pergunta nenhuma: quem tem o login já
 * registrado não precisa da confirmação de que fechou a aba, e o par
 * entra/sai dobrava o volume do registro sem dobrar a informação. O que importa
 * de saída de sessão é a **forçada** — `sessao.encerrada` —, porque essa alguém
 * fez em outra pessoa.
 */
export async function logoutAction(): Promise<never> {
  await destroyCurrentSession();
  redirect('/login');
}

/**
 * O cadastro público não existe mais.
 *
 * `signupAction` criava conta, papel de administrador e usuário para qualquer
 * um que preenchesse o formulário — o que faz sentido num produto de
 * autoatendimento e nenhum aqui, onde cada conta é um cliente com contrato. Na
 * prática era um botão para encher o banco de workspaces vazios, e mais uma
 * porta de entrada que ninguém revisava.
 *
 * Quem cria conta agora é o superadministrador, em `/plataforma/nova`. Ver
 * `createAccountAction` — mesmo provisionamento, com um dono definido por quem
 * responde pela plataforma.
 */

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
