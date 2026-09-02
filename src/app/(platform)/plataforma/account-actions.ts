'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { workspaceNameProblem } from '@/core/domain/account-provisioning';
import { hashPassword, passwordProblem } from '@/infrastructure/auth/password';
import { readSuperAdmin } from '@/infrastructure/auth/session';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { prisma } from '@/infrastructure/db/prisma';
import { provisionAccount } from '@/infrastructure/provisioning/provision-account';

/**
 * O ciclo de vida de uma conta, na mão de quem responde pela plataforma.
 *
 * Quatro ações, e nenhuma delas apaga linha: criar, suspender, reativar e
 * excluir. A exclusão marca `status = 'excluida'` em vez de rodar a cascata do
 * banco — uma conta de cliente carrega as conversas dela, as mensagens de todos
 * os clientes dela e o histórico de auditoria de quem trabalhou ali, e um
 * `DELETE` atenderia ao pedido destruindo justamente o que prova o que
 * aconteceu. Ver a nota de `Account.status` no schema.
 *
 * O efeito prático é o mesmo para quem estava dentro: `readSession()` recusa
 * conta fora de `ativa`, então as sessões abertas caem na requisição seguinte e
 * o login não encontra mais o workspace.
 */

export interface AccountActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly accountId?: string;
}

/**
 * A credencial que autoriza escolher qualquer conta.
 *
 * Devolve o administrador em vez de só validar, porque toda ação daqui precisa
 * dele para assinar a linha de auditoria — e buscá-lo duas vezes seria abrir
 * espaço para as duas respostas divergirem.
 */
const exigirSuperAdmin = async () => {
  const admin = await readSuperAdmin();
  if (!admin) throw new Error('Acesso restrito ao administrador da plataforma.');
  return admin;
};

const failureOf = (error: unknown, fallback: string): AccountActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const criarSchema = z.object({
  name: z.string().trim().min(1).max(80),
  document: z.union([z.literal(''), z.string().trim().max(24)]).optional(),
  adminName: z.string().trim().min(2, 'Informe o nome do administrador.').max(120),
  adminEmail: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  adminPassword: z.string().min(1, 'Defina a senha do administrador.').max(200),
});

/**
 * Cria a conta e o administrador dela, juntos.
 *
 * É o que restou de `signupAction`, com a diferença que importa: quem decide
 * que esta empresa existe é a plataforma, não quem preencheu o formulário. Os
 * dois nascem na mesma transação porque uma conta sem administrador é uma conta
 * inacessível — meio cadastro é pior que nenhum.
 */
export async function createAccountAction(input: unknown): Promise<AccountActionResult> {
  const parsed = criarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const problemaNome = workspaceNameProblem(parsed.data.name);
  if (problemaNome) return { ok: false, error: problemaNome };

  const problemaSenha = passwordProblem(parsed.data.adminPassword);
  if (problemaSenha) return { ok: false, error: problemaSenha };

  try {
    const admin = await exigirSuperAdmin();

    // O e-mail é a identidade global de login. Se já existe, esta pessoa já tem
    // senha — definir outra aqui tomaria o acesso de alguém que pode estar
    // atendendo em outra empresa.
    const existente = await prisma.user.findUnique({
      where: { email: parsed.data.adminEmail },
      select: { id: true },
    });
    if (existente) {
      return { ok: false, error: 'Já existe um acesso com este e-mail. Use outro endereço.' };
    }

    const contaId = `acc-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
    const userId = `user-${randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPassword(parsed.data.adminPassword);
    const nome = parsed.data.name.trim();
    const document = parsed.data.document?.trim();

    await prisma.$transaction(async (tx) => {
      // A pessoa primeiro: `provisionAccount` cria o vínculo de administrador,
      // e um vínculo aponta para um usuário que precisa existir.
      await tx.user.create({
        data: {
          id: userId,
          name: parsed.data.adminName,
          email: parsed.data.adminEmail,
          passwordHash,
          avatarTone: 'var(--color-brand-deep)',
        },
      });
      await provisionAccount(tx, {
        accountId: contaId,
        name: nome,
        ownerUserId: userId,
        ...(document ? { document } : {}),
      });
    });

    await writeAuditLog({
      accountId: contaId,
      actorId: admin.id,
      actorName: `${admin.name} (plataforma)`,
      action: 'membro.adicionado',
      targetType: 'membro',
      targetId: userId,
      targetName: parsed.data.adminName,
      metadata: {
        detalhe: 'conta criada pela plataforma, com o primeiro administrador',
        roleSlug: 'administrador',
      },
    }).catch(() => undefined);

    revalidatePath('/plataforma');
    return { ok: true, accountId: contaId };
  } catch (error) {
    console.error('[plataforma] Falha ao criar a conta:', error);
    return failureOf(error, 'Não foi possível criar a conta.');
  }
}

const estadoSchema = z.object({
  accountId: z.string().min(1).max(64),
  reason: z.string().trim().max(300).optional(),
  /** O nome digitado por extenso. A trava contra o clique errado. */
  confirmName: z.string().trim().min(1).max(80),
});

/**
 * Confere que a conta existe e que quem clicou digitou o nome dela.
 *
 * A comparação ignora caixa e espaços das pontas, e nada além disso: exigir o
 * nome exato é o ponto do gesto — ele obriga a pessoa a olhar para qual conta
 * está prestes a derrubar, que é justamente o que um clique de confirmação
 * genérico não obriga.
 */
const contaConfirmada = async (accountId: string, confirmName: string) => {
  // tenant-ok: a área de plataforma escolhe a conta de propósito, e só o
  // superadministrador chega aqui. Ver REGRAS-GLOBAIS.md §4.4.
  const conta = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, status: true },
  });
  if (!conta) throw new Error('Conta não encontrada.');

  const igual =
    conta.name.trim().toLocaleLowerCase('pt-BR') === confirmName.trim().toLocaleLowerCase('pt-BR');
  if (!igual) throw new Error('O nome digitado não confere com o da conta.');

  return conta;
};

/** Tira a conta do ar sem apagar nada. As sessões abertas caem na sequência. */
export async function suspendAccountAction(input: unknown): Promise<AccountActionResult> {
  const parsed = estadoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const admin = await exigirSuperAdmin();
    const conta = await contaConfirmada(parsed.data.accountId, parsed.data.confirmName);
    if (conta.status === 'excluida') {
      return { ok: false, error: 'Esta conta já foi excluída.' };
    }

    const motivo = parsed.data.reason?.trim();
    await prisma.account.update({
      where: { id: conta.id },
      data: {
        status: 'suspensa',
        suspendedAt: new Date(),
        suspendedReason: motivo || null,
      },
    });

    await writeAuditLog({
      accountId: conta.id,
      actorId: admin.id,
      actorName: `${admin.name} (plataforma)`,
      action: 'configuracao.alterada',
      targetType: 'workspace',
      targetId: conta.id,
      targetName: conta.name,
      metadata: {
        detalhe: motivo ? `conta suspensa: ${motivo}` : 'conta suspensa',
        plataforma: true,
      },
    }).catch(() => undefined);

    revalidatePath('/plataforma');
    revalidatePath(`/plataforma/${conta.id}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Não foi possível suspender a conta.');
  }
}

const reativarSchema = z.object({ accountId: z.string().min(1).max(64) });

/**
 * Devolve a conta ao ar.
 *
 * Sem confirmação por nome: reativar não destrói nada, e pedir o mesmo ritual
 * das ações perigosas ensinaria a digitar o nome no automático — o que
 * enfraquece a trava justamente onde ela precisa funcionar.
 */
export async function reactivateAccountAction(input: unknown): Promise<AccountActionResult> {
  const parsed = reativarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Conta inválida.' };

  try {
    const admin = await exigirSuperAdmin();
    // tenant-ok: área de plataforma. Ver REGRAS-GLOBAIS.md §4.4.
    const conta = await prisma.account.findUnique({
      where: { id: parsed.data.accountId },
      select: { id: true, name: true, status: true },
    });
    if (!conta) return { ok: false, error: 'Conta não encontrada.' };
    if (conta.status === 'ativa') return { ok: true };

    await prisma.account.update({
      where: { id: conta.id },
      data: { status: 'ativa', suspendedAt: null, suspendedReason: null },
    });

    await writeAuditLog({
      accountId: conta.id,
      actorId: admin.id,
      actorName: `${admin.name} (plataforma)`,
      action: 'configuracao.alterada',
      targetType: 'workspace',
      targetId: conta.id,
      targetName: conta.name,
      metadata: {
        detalhe: conta.status === 'excluida' ? 'conta restaurada' : 'conta reativada',
        plataforma: true,
      },
    }).catch(() => undefined);

    revalidatePath('/plataforma');
    revalidatePath(`/plataforma/${conta.id}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Não foi possível reativar a conta.');
  }
}

/**
 * Exclui a conta — marcando, não apagando.
 *
 * Para quem estava dentro o efeito é o de uma exclusão: ninguém entra mais, o
 * workspace some do seletor e do login. A diferença aparece do lado de cá, e é
 * a que importa: o dado continua íntegro e a conta pode ser restaurada. Uma
 * remoção física de verdade — se um dia for exigida por contrato ou por lei —
 * merece ser uma operação separada, com o seu próprio ritual, e não o efeito
 * colateral de um botão de tela.
 *
 * As sessões abertas **não** são revogadas em massa. `AuthSession` é do
 * usuário, não da conta: revogar por aqui derrubaria também o acesso de quem
 * atende noutra empresa pelo mesmo login, que não tem nada a ver com esta
 * exclusão. Quem estiver com a tela aberta cai na primeira requisição seguinte,
 * porque `readSession()` recusa conta fora de `ativa`.
 */
export async function deleteAccountAction(input: unknown): Promise<AccountActionResult> {
  const parsed = estadoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const admin = await exigirSuperAdmin();
    const conta = await contaConfirmada(parsed.data.accountId, parsed.data.confirmName);

    const motivo = parsed.data.reason?.trim();
    await prisma.account.update({
      where: { id: conta.id },
      data: {
        status: 'excluida',
        suspendedAt: new Date(),
        suspendedReason: motivo || 'Conta excluída pela plataforma.',
      },
    });

    await writeAuditLog({
      accountId: conta.id,
      actorId: admin.id,
      actorName: `${admin.name} (plataforma)`,
      action: 'configuracao.alterada',
      targetType: 'workspace',
      targetId: conta.id,
      targetName: conta.name,
      metadata: {
        detalhe: motivo ? `conta excluída: ${motivo}` : 'conta excluída',
        plataforma: true,
      },
    }).catch(() => undefined);

    revalidatePath('/plataforma');
    revalidatePath(`/plataforma/${conta.id}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Não foi possível excluir a conta.');
  }
}
