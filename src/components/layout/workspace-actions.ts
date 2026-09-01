'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { landingRouteFor } from '@/config/navigation';
import {
  MAX_WORKSPACES_POR_USUARIO,
  WORKSPACE_NAME_MAX,
  WORKSPACE_NAME_MIN,
  workspaceNameProblem,
} from '@/core/domain/account-provisioning';
import type { Permission, PermissionOverrides } from '@/core/domain/user';
import { effectivePermissions } from '@/core/domain/user';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { reissueSessionToken } from '@/infrastructure/auth/session';
import { container } from '@/infrastructure/container';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { provisionAccount } from '@/infrastructure/provisioning/provision-account';

export interface WorkspaceActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Onde a pessoa cai ao entrar na conta de destino.
 *
 * Não dá para reaproveitar `session.permissions`: elas são da conta de onde ela
 * está saindo, e o papel muda de workspace para workspace — administrador aqui
 * pode ser colaborador ali. Mandar todo mundo para `/dashboard` faria quem só
 * atende ver uma tela de acesso negado como primeira impressão do workspace
 * novo.
 */
const rotaDeEntrada = async (userId: string, accountId: string, roleSlug: string) => {
  const [role, vinculo] = await Promise.all([
    prisma.role.findUnique({ where: { accountId_slug: { accountId, slug: roleSlug } } }),
    prisma.membership.findUnique({
      where: { userId_accountId: { userId, accountId } },
      select: { permissionOverrides: true },
    }),
  ]);

  const permissoes = effectivePermissions(
    readJson<readonly Permission[]>(role?.permissions, []),
    readJson<PermissionOverrides | null>(vinculo?.permissionOverrides, null),
  );
  return landingRouteFor(permissoes);
};

const switchSchema = z.object({ accountId: z.string().min(1).max(64) });

/**
 * Troca a conta ativa da sessão.
 *
 * A conferência do vínculo é a autorização de verdade, e por isso acontece
 * aqui: `accountId` chega do navegador, e confiar nele seria deixar qualquer
 * pessoa assinar um token para a conta de qualquer outra empresa. Só existe
 * troca para conta em que a pessoa tem `Membership`.
 */
export async function switchWorkspaceAction(input: unknown): Promise<WorkspaceActionResult> {
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Workspace inválido.' };

  const session = await container.session.getCurrentSession();
  const { accountId } = parsed.data;
  if (accountId === session.account.id) return { ok: true };

  const vinculo = await prisma.membership.findUnique({
    where: { userId_accountId: { userId: session.user.id, accountId } },
    include: { account: { select: { id: true, name: true } } },
  });
  if (!vinculo) {
    return { ok: false, error: 'Você não participa deste workspace.' };
  }

  await reissueSessionToken(session.user.id, session.tokenId, accountId);

  // Registrado na conta de **destino**: é lá que a presença desta pessoa passa
  // a valer, e é lá que o administrador procura por quem entrou.
  await writeAuditLog({
    accountId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'workspace.trocado',
    targetType: 'workspace',
    targetId: accountId,
    targetName: vinculo.account.name,
    metadata: { de: session.account.id, deNome: session.account.name },
  });

  // A conta ativa atravessa o layout inteiro (rail, topbar, seletor), então o
  // alvo é o layout e não a rota atual.
  revalidatePath('/', 'layout');
  redirect(await rotaDeEntrada(session.user.id, accountId, vinculo.roleSlug));
}

const createSchema = z.object({
  name: z.string().trim().min(WORKSPACE_NAME_MIN).max(WORKSPACE_NAME_MAX),
  document: z.union([z.literal(''), z.string().trim().max(24)]).optional(),
});

/**
 * Cria um workspace novo e entra nele.
 *
 * Quem cria é administrador do que criou — mesma regra do cadastro público, que
 * qualquer pessoa já pode usar com outro e-mail. O que existe aqui e não lá é a
 * **quota**: um formulário de criação sem teto é um botão que insere linhas em
 * cinco tabelas quantas vezes alguém quiser clicar. Contam só as contas que a
 * pessoa administra; participar de dez workspaces por convite não a impede de
 * criar o primeiro dela.
 */
export async function createWorkspaceAction(input: unknown): Promise<WorkspaceActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  const problema = workspaceNameProblem(parsed.data.name);
  if (problema) return { ok: false, error: problema };

  const session = await container.session.getCurrentSession();

  // tenant-ok: a quota é da pessoa e atravessa contas de propósito. Escopar por
  // `accountId` aqui contaria sempre 1 e o teto nunca valeria para nada.
  const criados = await prisma.membership.count({
    where: { userId: session.user.id, roleSlug: 'administrador' },
  });
  if (criados >= MAX_WORKSPACES_POR_USUARIO) {
    return {
      ok: false,
      error: `Você já administra ${MAX_WORKSPACES_POR_USUARIO} workspaces, que é o limite por conta.`,
    };
  }

  const name = parsed.data.name.trim();
  const document = parsed.data.document?.trim();
  const accountId = `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    await prisma.$transaction((tx) =>
      provisionAccount(tx, {
        accountId,
        name,
        ownerUserId: session.user.id,
        ...(document ? { document } : {}),
      }),
    );
  } catch (error) {
    console.error('[workspace] Falha ao criar o workspace:', error);
    return { ok: false, error: 'Não foi possível criar o workspace. Tente de novo.' };
  }

  await reissueSessionToken(session.user.id, session.tokenId, accountId);

  await writeAuditLog({
    accountId,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'workspace.criado',
    targetType: 'workspace',
    targetId: accountId,
    targetName: name,
  });

  revalidatePath('/', 'layout');
  // Cai onde ele precisa agir: um workspace novo não atende ninguém enquanto o
  // WhatsApp não estiver pareado.
  redirect('/configuracoes?secao=caixas');
}
