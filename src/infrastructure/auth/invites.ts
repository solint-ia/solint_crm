import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/infrastructure/db/prisma';

/**
 * Convites de colaborador.
 *
 * É por aqui que uma empresa ganha gente além de quem criou a conta. O gestor
 * escolhe o e-mail, o papel (o que a pessoa pode fazer) e as equipes (quais
 * caixas ela alcança) — os dois eixos que `can()` e `canSeeInbox()` leem depois.
 *
 * **O token é guardado como hash, nunca em claro.** Um convite dá acesso a
 * conversas de clientes; um vazamento do banco não pode entregar links de
 * convite ainda válidos. O valor cru existe uma vez só, no retorno de `create`,
 * e é o que vai para o link.
 */

/** Sete dias. Curto o bastante para um link esquecido não virar porta aberta. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 bytes de aleatoriedade real: o link é a credencial. */
const tokenOf = (): string => randomBytes(32).toString('base64url');

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface InviteDraft {
  readonly accountId: string;
  readonly email: string;
  readonly roleSlug: string;
  readonly teamIds: readonly string[];
  readonly invitedByUserId: string;
}

/** Convite pronto para virar link. O `token` só existe aqui. */
export interface CreatedInvite {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export const createInvite = async (draft: InviteDraft): Promise<CreatedInvite> => {
  const token = tokenOf();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const row = await prisma.invite.create({
    data: {
      accountId: draft.accountId,
      email: draft.email.trim().toLowerCase(),
      roleSlug: draft.roleSlug,
      teamIds: [...draft.teamIds],
      tokenHash: hashOf(token),
      invitedByUserId: draft.invitedByUserId,
      expiresAt,
    },
  });

  return { id: row.id, token, expiresAt };
};

export interface PendingInvite {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly email: string;
  readonly roleSlug: string;
  readonly teamIds: readonly string[];
  /** A pessoa já tem cadastro? Decide se o aceite pede senha nova ou a atual. */
  readonly userExists: boolean;
}

/**
 * Lê um convite pelo token cru, se ele ainda valer.
 *
 * Recusa em silêncio (devolve `null`) para token inexistente, expirado ou já
 * aceito — os três são "este link não serve", e distinguir os casos na resposta
 * diria a quem tem o link se ele existiu algum dia.
 */
export const readInvite = async (token: string): Promise<PendingInvite | null> => {
  if (!token) return null;

  // Quem aceita um convite ainda não pertence a conta nenhuma, e é o próprio
  // token que determina qual conta é. O que protege esta consulta é ele: 32
  // bytes aleatórios, guardados só como hash, de uso único e com validade.
  // tenant-ok: entre contas por necessidade — exigir `accountId` aqui seria
  // pedir a resposta antes da pergunta.
  const row = await prisma.invite.findUnique({
    where: { tokenHash: hashOf(token) },
    include: { account: { select: { name: true } } },
  });

  if (!row || row.acceptedAt || row.expiresAt.getTime() < Date.now()) return null;

  const user = await prisma.user.findUnique({
    where: { email: row.email },
    select: { id: true },
  });

  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.account.name,
    email: row.email,
    roleSlug: row.roleSlug,
    teamIds: Array.isArray(row.teamIds) ? (row.teamIds as string[]) : [],
    userExists: Boolean(user),
  };
};

/** Marca o convite como usado. Chamado dentro da transação do aceite. */
export const inviteTokenHash = (token: string): string => hashOf(token);
