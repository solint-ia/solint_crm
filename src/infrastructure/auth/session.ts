import 'server-only';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Account, Permission, Role, Session, User } from '@/core/domain/user';
import { prisma, fromJson } from '@/infrastructure/db/prisma';
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

const toDomainUser = (row: {
  id: string;
  accountId: string;
  name: string;
  email: string;
  roleSlug: string;
  avatarTone: string;
  availability: string;
  teamsJson: string;
  signature: string | null;
  twoFactorEnabled: boolean;
  lastActiveAt: string | null;
}): User => ({
  id: row.id,
  accountId: row.accountId,
  name: row.name,
  email: row.email,
  roleSlug: row.roleSlug,
  avatarTone: row.avatarTone,
  availability: row.availability as User['availability'],
  teams: fromJson<readonly string[]>(row.teamsJson, []),
  twoFactorEnabled: row.twoFactorEnabled,
  ...(row.signature ? { signature: row.signature } : {}),
  ...(row.lastActiveAt ? { lastActiveAt: row.lastActiveAt } : {}),
});

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

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    include: { account: true },
  });
  if (!user || user.accountId !== claims.act) return null;

  const role: Role | null = await prisma.role.findUnique({
    where: { accountId_slug: { accountId: user.accountId, slug: user.roleSlug } },
  }).then((row) =>
    row
      ? {
          id: row.id,
          accountId: row.accountId,
          slug: row.slug,
          name: row.name,
          description: row.description,
          permissions: fromJson<readonly Permission[]>(row.permissionsJson, []),
          isSystem: row.isSystem,
        }
      : null,
  );

  const account = toDomainAccount(user.account);

  return {
    user: toDomainUser(user),
    account,
    // Sem papel cadastrado o usuário fica sem permissão nenhuma. É o padrão
    // seguro: um papel apagado não deve virar acesso irrestrito.
    permissions: role?.permissions ?? [],
    /**
     * Uma conta por usuário neste modelo — o e-mail é único globalmente.
     * Multi-workspace de verdade exige uma tabela de vínculo (Membership);
     * fingir mais de uma conta aqui só encheria o seletor de opções falsas.
     */
    availableAccounts: [account],
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
