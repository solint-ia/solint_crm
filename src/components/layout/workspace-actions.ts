'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { landingRouteFor } from '@/config/navigation';
import type { Permission, PermissionOverrides } from '@/core/domain/user';
import { effectivePermissions } from '@/core/domain/user';
import { reissueSessionToken } from '@/infrastructure/auth/session';
import { container } from '@/infrastructure/container';
import { prisma, readJson } from '@/infrastructure/db/prisma';

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
 *
 * A troca **não** vira linha de auditoria. Era `workspace.trocado`, e registrava
 * o movimento de quem já estava autorizado a fazê-lo — o que o administrador da
 * conta de destino precisa saber é o que a pessoa fez lá dentro, e isso as
 * outras linhas já contam.
 */
export async function switchWorkspaceAction(input: unknown): Promise<WorkspaceActionResult> {
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Workspace inválido.' };

  const session = await container.session.getCurrentSession();
  const { accountId } = parsed.data;
  if (accountId === session.account.id) return { ok: true };

  const vinculo = await prisma.membership.findUnique({
    where: { userId_accountId: { userId: session.user.id, accountId } },
    include: { account: { select: { id: true, name: true, status: true } } },
  });
  if (!vinculo) {
    return { ok: false, error: 'Você não participa deste workspace.' };
  }
  // O seletor já não oferece conta suspensa, mas `accountId` chega do navegador
  // e o seletor não é a autorização — sem esta linha, um id digitado à mão
  // assinaria um token para uma conta que `readSession()` recusa, e a pessoa
  // cairia num laço de redirecionamento para o login.
  if (vinculo.account.status !== 'ativa') {
    return { ok: false, error: 'Este workspace está suspenso.' };
  }

  await reissueSessionToken(session.user.id, session.tokenId, accountId);

  // A conta ativa atravessa o layout inteiro (rail, topbar, seletor), então o
  // alvo é o layout e não a rota atual.
  revalidatePath('/', 'layout');
  redirect(await rotaDeEntrada(session.user.id, accountId, vinculo.roleSlug));
}

/**
 * Criar workspace saiu daqui.
 *
 * Era o mesmo buraco do cadastro público por outra porta: qualquer pessoa
 * logada provisionava contas novas e nascia administradora delas, com uma quota
 * como único freio. Agora quem cria conta é o superadministrador, em
 * `/plataforma/nova`, que é onde existe a informação que falta a um botão
 * dentro do CRM — quem é o cliente, e quem responde por ele.
 */
