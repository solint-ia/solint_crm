'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { landingRouteFor } from '@/config/navigation';
import { isLimitReached, workspaceLimitMessage } from '@/core/domain/account-limits';
import { workspaceNameProblem } from '@/core/domain/account-provisioning';
import {
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  buildLogoUrl,
  isAllowedLogoMimeType,
} from '@/core/domain/image-upload';
import type { Permission, PermissionOverrides } from '@/core/domain/user';
import { canCreateWorkspace, effectivePermissions } from '@/core/domain/user';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { reissueSessionToken, setPlatformActuation } from '@/infrastructure/auth/session';
import { container } from '@/infrastructure/container';
import { asJson, prisma, readJson } from '@/infrastructure/db/prisma';
import { provisionAccount } from '@/infrastructure/provisioning/provision-account';
import { BUCKETS, storage } from '@/infrastructure/storage/supabase-storage';

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
 * Quantos workspaces uma pessoa pode administrar.
 *
 * O freio que sobra depois da trava de papel: sem ele, um administrador
 * provisionaria contas sem fim, cada uma com caixa, funil e papéis.
 */
const MAX_WORKSPACES_POR_USUARIO = 10;

/**
 * Cria um workspace novo, com a pessoa como administradora, e entra nele.
 *
 * **Quem pode.** Já existiu uma versão aberta a qualquer pessoa logada, e ela
 * foi fechada porque qualquer colaborador provisionava contas e nascia
 * administrador delas. Esta volta com a trava que faltava: só quem administra
 * o workspace atual (`canCreateWorkspace`), e com teto por pessoa.
 *
 * **Superadministrador.** Operando dentro de uma conta, ele também cria, sem o
 * teto. O workspace nasce para os administradores **daquela conta**, e não para
 * ele: o superadministrador não é membro de conta de cliente, e uma conta cujo
 * único administrador fosse ele ficaria inacessível para o próprio cliente.
 * Depois de criar, ele entra no workspace novo pela atuação da plataforma,
 * como entra em qualquer conta.
 *
 * **O que nasce.** O mesmo molde do console da plataforma (`provisionAccount`):
 * papéis, caixa de WhatsApp própria, funil e configurações. A conta nova não
 * herda nada da atual: contatos, conversas, caixas e credenciais do WhatsApp
 * são por conta, e é isso que mantém um workspace fora do outro.
 *
 * **O logo** é opcional e vai depois da transação: o Storage não participa dela,
 * e uma falha no upload não deve desfazer a conta. Sem logo, o seletor mostra
 * as iniciais, e a foto pode ser trocada depois em Configurações › Empresa.
 */
export async function createWorkspaceAction(formData: FormData): Promise<WorkspaceActionResult> {
  const session = await container.session.getCurrentSession();
  if (!canCreateWorkspace(session)) {
    return { ok: false, error: 'Só quem administra o workspace atual pode criar outro.' };
  }

  const nomeBruto = formData.get('name');
  const nome = typeof nomeBruto === 'string' ? nomeBruto.trim() : '';
  const problema = workspaceNameProblem(nome);
  if (problema) return { ok: false, error: problema };

  // O logo é conferido antes de criar qualquer coisa: recusar o arquivo depois
  // deixaria uma conta criada e a pessoa achando que nada aconteceu.
  const logoBruto = formData.get('logo');
  const logo = logoBruto instanceof File && logoBruto.size > 0 ? logoBruto : null;
  if (logo && logo.size > MAX_LOGO_BYTES) {
    return { ok: false, error: 'A imagem passou de 2 MB. Escolha um arquivo menor.' };
  }
  if (logo && !isAllowedLogoMimeType(logo.type)) {
    return {
      ok: false,
      error: `Envie uma imagem ${ALLOWED_LOGO_MIME_TYPES.map((t) => t.split('/')[1]).join(' ou ')}.`,
    };
  }

  const superadmin = Boolean(session.platformActor);

  /**
   * O teto da conta, definido pela plataforma na ficha dela.
   *
   * Conta a **família**: os workspaces que nasceram desta conta, ou da raiz
   * dela quando ela mesma é um filho. Sem a raiz, bastaria entrar no workspace
   * recém-criado e criar a partir dele para o teto nunca valer.
   *
   * Vale também para o superadministrador, pela mesma razão do teto de caixas:
   * um limite que a plataforma fura deixa de descrever a conta.
   */
  const contaRaiz = session.account.rootAccountId ?? session.account.id;
  const tetoDaConta = session.account.rootAccountId
    ? (
        await prisma.account.findUnique({
          where: { id: contaRaiz },
          select: { maxWorkspaces: true },
        })
      )?.maxWorkspaces
    : session.account.maxWorkspaces;

  if (typeof tetoDaConta === 'number') {
    // tenant-ok: a contagem é da família de contas de propósito — escopar por
    // `accountId` contaria sempre zero e o teto nunca valeria.
    const criados = await prisma.account.count({
      where: { rootAccountId: contaRaiz, status: { not: 'excluida' } },
    });
    if (isLimitReached(tetoDaConta, criados)) {
      return { ok: false, error: workspaceLimitMessage(tetoDaConta) };
    }
  }

  // Quem sai administrador do workspace novo: a própria pessoa, ou, quando é o
  // superadministrador quem cria, os administradores da conta em que ele está.
  let donos: string[];
  if (superadmin) {
    const admins = await prisma.membership.findMany({
      where: { accountId: session.account.id, roleSlug: 'administrador' },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    donos = admins.map((vinculo) => vinculo.userId);
    if (donos.length === 0) {
      return {
        ok: false,
        error: 'Esta conta não tem administrador para receber o workspace novo.',
      };
    }
  } else {
    // tenant-ok: a quota é da pessoa e atravessa contas de propósito. Escopar por
    // `accountId` aqui contaria sempre 1 e o teto nunca valeria para nada.
    const administrados = await prisma.membership.count({
      where: { userId: session.user.id, roleSlug: 'administrador' },
    });
    if (administrados >= MAX_WORKSPACES_POR_USUARIO) {
      return {
        ok: false,
        error: `Você já administra ${MAX_WORKSPACES_POR_USUARIO} workspaces, que é o limite por pessoa.`,
      };
    }
    donos = [session.user.id];
  }

  const [primeiroDono, ...demaisDonos] = donos;
  if (!primeiroDono) return { ok: false, error: 'Não foi possível definir o administrador.' };

  const accountId = `acc-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  try {
    await prisma.$transaction(async (tx) => {
      await provisionAccount(tx, {
        accountId,
        name: nome,
        ownerUserId: primeiroDono,
        rootAccountId: contaRaiz,
      });
      if (demaisDonos.length > 0) {
        await tx.membership.createMany({
          data: demaisDonos.map((userId) => ({
            userId,
            accountId,
            roleSlug: 'administrador',
            availability: 'disponivel',
          })),
        });
      }
    });
  } catch (error) {
    console.error('[workspace] Falha ao criar o workspace:', error);
    return { ok: false, error: 'Não foi possível criar o workspace. Tente de novo.' };
  }

  if (logo) {
    const enviado = await storage
      .upload(
        BUCKETS.AVATARS,
        `accounts/${accountId}`,
        Buffer.from(await logo.arrayBuffer()),
        logo.type,
      )
      .catch(() => false);
    if (enviado) {
      await prisma.accountSettings
        .update({
          where: { accountId },
          data: { company: asJson({ logoUrl: buildLogoUrl(accountId, logo.type) }) },
        })
        .catch((error: unknown) => console.error('[workspace] Logo não gravado:', error));
    }
  }

  await writeAuditLog({
    accountId,
    actorId: session.user.id,
    actorName: superadmin ? `${session.user.name} (plataforma)` : session.user.name,
    action: 'membro.adicionado',
    targetType: 'workspace',
    targetId: accountId,
    targetName: nome,
    metadata: {
      detalhe: superadmin
        ? 'workspace criado pela plataforma, com os administradores da conta de origem'
        : 'workspace criado pelo CRM, com quem criou como administrador',
      origemAccountId: session.account.id,
      roleSlug: 'administrador',
      administradores: donos.length,
    },
  }).catch(() => undefined);

  if (superadmin) {
    if (!(await setPlatformActuation(accountId))) {
      return { ok: false, error: 'Workspace criado, mas não foi possível entrar nele.' };
    }
  } else {
    await reissueSessionToken(session.user.id, session.tokenId, accountId);
  }
  revalidatePath('/', 'layout');
  // Cai onde precisa agir: um workspace novo não atende ninguém enquanto o
  // WhatsApp da caixa dele não estiver pareado.
  redirect('/configuracoes?secao=caixas');
}
