'use server';

import { z } from 'zod';
import { hashPassword, passwordProblem, verifyPassword } from '@/infrastructure/auth/password';
import { inviteTokenHash, readInvite } from '@/infrastructure/auth/invites';
import { createSession, touchUser } from '@/infrastructure/auth/session';
import { prisma } from '@/infrastructure/db/prisma';

export interface AcceptInviteResult {
  readonly ok: boolean;
  readonly error?: string;
}

const acceptSchema = z.object({
  token: z.string().min(1).max(200),
  /** Só usado quando a pessoa ainda não tem cadastro. */
  name: z.string().trim().max(120).optional(),
  password: z.string().min(1, 'Informe a senha.'),
});

/**
 * Aceita um convite e coloca a pessoa dentro da empresa.
 *
 * Dois caminhos, decididos pelo e-mail do convite — **nunca por um campo do
 * formulário**. O e-mail vem travado do convite porque, editável, qualquer um
 * com o link redirecionaria o acesso para si:
 *
 *  - **Sem cadastro:** cria `User` com a senha escolhida, mais o vínculo.
 *  - **Com cadastro:** confere a senha que a pessoa já usa e cria **só** o
 *    vínculo. É o caso de quem atende em outra empresa que usa o mesmo CRM: a
 *    identidade é uma só, e a empresa nova aparece no seletor de workspace.
 *
 * Tudo numa transação. Um vínculo criado sem marcar o convite como aceito
 * deixaria o link reutilizável; o convite marcado sem o vínculo deixaria a
 * pessoa de fora sem forma de voltar.
 */
export async function acceptInviteAction(input: unknown): Promise<AcceptInviteResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const invite = await readInvite(parsed.data.token);
  if (!invite) {
    return { ok: false, error: 'Este convite não é mais válido. Peça um link novo ao gestor.' };
  }

  const existing = await prisma.user.findUnique({ where: { email: invite.email } });

  // Quem já tem conta prova quem é com a senha que já usa; quem não tem escolhe
  // uma agora, e ela passa pela mesma política do cadastro comum.
  let userId: string;
  let passwordHash: string | undefined;

  if (existing) {
    const matches = await verifyPassword(parsed.data.password, existing.passwordHash);
    if (!matches) {
      return { ok: false, error: 'Senha incorreta para esta conta de e-mail.' };
    }
    userId = existing.id;

    const already = await prisma.membership.findUnique({
      where: { userId_accountId: { userId, accountId: invite.accountId } },
      select: { userId: true },
    });
    if (already) {
      return { ok: false, error: `Você já faz parte de ${invite.accountName}.` };
    }
  } else {
    const name = parsed.data.name?.trim();
    if (!name || name.length < 2) {
      return { ok: false, error: 'Informe seu nome.' };
    }
    const weak = passwordProblem(parsed.data.password);
    if (weak) return { ok: false, error: weak };

    userId = `user-${Date.now().toString(36)}`;
    passwordHash = await hashPassword(parsed.data.password);
  }

  const nome = parsed.data.name?.trim();

  try {
    await prisma.$transaction(async (tx) => {
      // O convite é consumido pelo hash **e** pela condição de ainda estar em
      // aberto. Dois aceites simultâneos do mesmo link: um atualiza a linha, o
      // outro não encontra nada para atualizar e é recusado.
      const { count } = await tx.invite.updateMany({
        where: { tokenHash: inviteTokenHash(parsed.data.token), acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (count === 0) throw new Error('CONVITE_JA_USADO');

      if (!existing && passwordHash) {
        await tx.user.create({
          data: {
            id: userId,
            name: nome ?? invite.email,
            email: invite.email,
            passwordHash,
            avatarTone: 'var(--color-brand)',
          },
        });
      }

      await tx.membership.create({
        data: {
          userId,
          accountId: invite.accountId,
          roleSlug: invite.roleSlug,
          availability: 'disponivel',
        },
      });

      // As equipes decidem quais caixas a pessoa alcança. São conferidas contra
      // a conta do convite: um id de equipe de outra empresa não entra.
      if (invite.teamIds.length > 0) {
        const validas = await tx.team.findMany({
          where: { id: { in: [...invite.teamIds] }, accountId: invite.accountId },
          select: { id: true },
        });
        if (validas.length > 0) {
          await tx.teamMember.createMany({
            data: validas.map((team) => ({ teamId: team.id, userId })),
            skipDuplicates: true,
          });
        }
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'CONVITE_JA_USADO') {
      return { ok: false, error: 'Este convite já foi usado.' };
    }
    return { ok: false, error: 'Não foi possível aceitar o convite. Tente de novo.' };
  }

  await createSession(userId, invite.accountId);
  await touchUser(userId);

  return { ok: true };
}
