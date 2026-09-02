'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { z } from 'zod';
import { landingRouteFor } from '@/config/navigation';
import { SUPERADMIN_PERMISSIONS } from '@/core/domain/user';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { readSuperAdmin, setPlatformActuation } from '@/infrastructure/auth/session';
import { prisma } from '@/infrastructure/db/prisma';

/**
 * Entrar e sair de uma conta como superadministrador.
 *
 * As duas ações fazem uma coisa só: reassinar o cookie com a reivindicação de
 * atuação de plataforma ligada ou desligada. Quem monta a sessão a partir dela é
 * `readSession()`, e é lá que a autoridade é reconferida contra o banco a cada
 * requisição — ver `platformSession`.
 *
 * Ficam separadas de `switchWorkspaceAction`, que continua exigindo vínculo:
 * aquela é a troca de workspace do usuário comum, e misturar as duas colocaria
 * um caminho sem vínculo dentro do fluxo que existe para verificá-lo.
 */

export interface PlatformActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const entrarSchema = z.object({ accountId: z.string().min(1).max(64) });

/**
 * Abre o CRM de uma conta com poderes completos.
 *
 * A conta é conferida antes de assinar qualquer coisa: um `accountId` que não
 * existe produziria uma sessão apontando para o vazio, e o erro apareceria
 * longe daqui, como uma tela em branco.
 */
export async function enterAccountAction(input: unknown): Promise<PlatformActionResult> {
  const parsed = entrarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Conta inválida.' };

  const admin = await readSuperAdmin();
  if (!admin) return { ok: false, error: 'Sessão de plataforma não encontrada.' };

  const { accountId } = parsed.data;
  // tenant-ok: a área de plataforma escolhe a conta de propósito, e só o
  // superadministrador chega aqui. Ver REGRAS-GLOBAIS.md §4.4.
  const conta = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true },
  });
  if (!conta) return { ok: false, error: 'Conta não encontrada.' };

  if (!(await setPlatformActuation(conta.id))) {
    return { ok: false, error: 'Não foi possível entrar na conta.' };
  }

  /**
   * A entrada é um evento, não só a escrita que vier depois.
   *
   * Saber que alguém **olhou** a conta de um cliente é metade da prestação de
   * contas, e é a metade que nenhuma outra linha do histórico registra.
   */
  await writeAuditLog({
    accountId: conta.id,
    actorId: admin.id,
    actorName: `${admin.name} (plataforma)`,
    action: 'sessao.login',
    targetType: 'workspace',
    targetId: conta.id,
    targetName: conta.name,
    metadata: { plataforma: true, evento: 'entrou na conta', email: admin.email },
  }).catch(() => undefined);

  // A mesma regra de entrada de todo mundo, com as permissões que ele terá lá
  // dentro. Um destino fixo aqui seria uma segunda resposta para a pergunta que
  // `landingRouteFor` já responde, livre para divergir dela depois.
  //
  // Fora de qualquer `try`: `redirect` funciona lançando, e capturá-lo
  // transformaria a navegação num erro silencioso.
  redirect(landingRouteFor(SUPERADMIN_PERMISSIONS));
}

/** Encerra a atuação e devolve o superadministrador ao console. */
export async function leaveAccountAction(): Promise<PlatformActionResult> {
  const admin = await readSuperAdmin();
  if (!admin) return { ok: false, error: 'Sessão de plataforma não encontrada.' };

  if (!(await setPlatformActuation(null))) {
    return { ok: false, error: 'Não foi possível sair da conta.' };
  }

  redirect('/plataforma' as Route);
}
