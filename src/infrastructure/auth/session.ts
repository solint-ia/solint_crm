import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Account, Permission, Role, Session } from '@/core/domain/user';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { userRow } from '@/infrastructure/repositories/prisma/mappers';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
} from './tokens';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  // Em HTTP local o cookie `secure` simplesmente não é enviado, e o login
  // pareceria funcionar sem nunca autenticar.
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_TTL_SECONDS,
};

/**
 * Abre uma sessão: grava a linha de revogação, assina o token e põe o cookie.
 *
 * A linha em `AuthSession` é o que torna "sair de todas as sessões" possível.
 * Um JWT sozinho é irrevogável até expirar — quem quiser derrubar um acesso
 * roubado precisa de um registro para invalidar.
 */
export const createSession = async (
  userId: string,
  accountId: string,
  meta?: { readonly userAgent?: string; readonly ip?: string },
): Promise<void> => {
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenId,
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 300) ?? null,
      ip: meta?.ip?.slice(0, 60) ?? null,
    },
  });

  const token = await signSessionToken({ sub: userId, act: accountId, jti: tokenId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions);
};

/** Encerra a sessão atual: revoga no banco e apaga o cookie. */
export const destroyCurrentSession = async (): Promise<void> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    const claims = await verifySessionToken(token);
    if (claims) {
      await prisma.authSession.updateMany({
        where: { tokenId: claims.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  jar.delete(SESSION_COOKIE);
};

/** Derruba todos os acessos do usuário, inclusive o atual. */
export const revokeAllSessions = async (userId: string): Promise<number> => {
  const { count } = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
};

const toDomainAccount = (row: {
  id: string;
  name: string;
  plan: string;
  document: string | null;
}): Account => ({
  id: row.id,
  name: row.name,
  plan: row.plan as Account['plan'],
  ...(row.document ? { document: row.document } : {}),
});

/**
 * Resolve a sessão a partir do cookie.
 *
 * Três checagens, nesta ordem: assinatura válida, registro não revogado nem
 * expirado, usuário ainda existente. A segunda é a que o middleware não
 * consegue fazer — ele roda no Edge, sem banco.
 *
 * Devolve `null` em vez de lançar: quem chama decide se redireciona (páginas)
 * ou responde 401 (rotas de API).
 */
export const readSession = async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const authSession = await prisma.authSession.findUnique({ where: { tokenId: claims.jti } });
  if (!authSession || authSession.revokedAt || authSession.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // O `act` do token diz em que conta a sessão foi aberta; o vínculo é o que
  // autoriza. Sem ele a pessoa não atende mais naquele workspace, e o token
  // deixa de valer ali — mesmo com assinatura boa e sessão não revogada.
  const membership = await prisma.membership.findUnique({
    where: { userId_accountId: { userId: claims.sub, accountId: claims.act } },
    include: { user: true, account: true },
  });
  if (!membership) return null;

  const role: Role | null = await prisma.role
    .findUnique({
      where: { accountId_slug: { accountId: membership.accountId, slug: membership.roleSlug } },
    })
    .then((row) =>
      row
        ? {
            id: row.id,
            accountId: row.accountId,
            slug: row.slug,
            name: row.name,
            description: row.description,
            permissions: readJson<readonly Permission[]>(row.permissions, []),
            isSystem: row.isSystem,
          }
        : null,
    );

  // Todas as contas em que esta pessoa atende. É o que alimenta o seletor de
  // workspace — que até aqui devolvia `[account]` porque não havia como saber.
  // tenant-ok: deliberadamente entre contas — e a lista de workspaces da pessoa
  // que alimenta o seletor. Escopar por conta aqui devolveria sempre uma opcao.
  const all = await prisma.membership.findMany({
    where: { userId: membership.userId },
    include: { account: true },
    orderBy: { createdAt: 'asc' },
  });

  return {
    user: userRow(membership.user, membership),
    account: toDomainAccount(membership.account),
    // Sem papel cadastrado o usuário fica sem permissão nenhuma. É o padrão
    // seguro: um papel apagado não deve virar acesso irrestrito.
    permissions: role?.permissions ?? [],
    availableAccounts: all.map((row) => toDomainAccount(row.account)),
  };
};

/** Marca a atividade do usuário. Falha em silêncio: é dado auxiliar. */
export const touchUser = async (userId: string): Promise<void> => {
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: 'agora' } });
  } catch {
    // Não vale derrubar um login porque o carimbo de atividade não gravou.
  }
};
