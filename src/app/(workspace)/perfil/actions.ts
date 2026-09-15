'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  canChangeOwnPassword,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_SOUNDS,
  type NotificationPreferences,
} from '@/core/domain/user';
import {
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  buildAvatarUrl,
  isAllowedAvatarMimeType,
} from '@/core/domain/image-upload';
import { BUCKETS, storage } from '@/infrastructure/storage/supabase-storage';
import { container } from '@/infrastructure/container';
import { asJson, prisma, readJson } from '@/infrastructure/db/prisma';
import { hashPassword, passwordProblem, verifyPassword } from '@/infrastructure/auth/password';
import {
  destroyCurrentSession,
  revokeAllSessions,
  revokeOtherSessions,
} from '@/infrastructure/auth/session';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';

export interface ProfileActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Teto da assinatura.
 *
 * Ela vai em toda mensagem enviada, então o custo de uma assinatura longa não é
 * o armazenamento: é o cliente lendo três linhas de rodapé antes de chegar ao
 * que interessa. Cento e vinte caracteres cabem nome, cargo e empresa.
 */
const MAX_SIGNATURE = 120;

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  availability: z.enum(['disponivel', 'ocupado', 'ausente']),
  signature: z.string().trim().max(MAX_SIGNATURE),
  signatureEnabled: z.boolean(),
  notifications: z.object({
    assigned: z.boolean(),
    mentions: z.boolean(),
    sla: z.boolean(),
    sound: z.boolean(),
    soundTone: z.enum(NOTIFICATION_SOUNDS),
  }),
});

const notificationSoundSchema = z.object({
  soundTone: z.enum(NOTIFICATION_SOUNDS),
});

/** Salva imediatamente o timbre escolhido no controle da caixa de entrada. */
export async function updateNotificationSoundAction(input: unknown): Promise<ProfileActionResult> {
  const parsed = notificationSoundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Som de notificação inválido.' };

  const session = await container.session.getCurrentSession();

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { notificationPrefs: true },
    });
    if (!user) return { ok: false, error: 'Usuário não encontrado.' };

    const prefs: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...readJson<Partial<NotificationPreferences>>(user.notificationPrefs, {}),
      soundTone: parsed.data.soundTone,
    };

    await prisma.user.update({
      where: { id: session.user.id },
      data: { notificationPrefs: asJson(prefs) },
    });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    console.error('[perfil] Falha ao salvar som de notificação:', error);
    return { ok: false, error: 'Não foi possível salvar o som escolhido.' };
  }
}

/**
 * Grava o perfil da pessoa.
 *
 * O email de login fica de fora de propósito: ele é a identidade de acesso, é
 * único no sistema inteiro, e trocá-lo é um fluxo com confirmação de senha —
 * não um campo que se salva junto com a preferência de som.
 *
 * A disponibilidade vai para `Membership` e não para `User` porque é dela: dá
 * para estar em atendimento num workspace e ausente noutro.
 */
export async function updateProfileAction(input: unknown): Promise<ProfileActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Confira os campos: algum valor não foi aceito.' };
  }

  const session = await container.session.getCurrentSession();
  const { name, availability, signature, signatureEnabled, notifications } = parsed.data;

  // Ligar a assinatura sem ter escrito uma deixaria toda mensagem saindo com um
  // `**` vazio na frente. Recusar aqui é mais honesto que salvar e não aplicar.
  if (signatureEnabled && !signature) {
    return { ok: false, error: 'Escreva a assinatura antes de ativá-la.' };
  }

  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...notifications };

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: session.user.id },
        data: {
          name,
          signature: signature || null,
          signatureEnabled,
          notificationPrefs: asJson(prefs),
        },
      }),
      prisma.membership.updateMany({
        where: { userId: session.user.id, accountId: session.account.id },
        data: { availability },
      }),
    ]);
  } catch (error) {
    console.error('[perfil] Falha ao salvar o perfil:', error);
    return { ok: false, error: 'Não foi possível salvar. Tente de novo.' };
  }

  // O nome e a disponibilidade aparecem na rail de navegação, que é do layout:
  // revalidar só `/perfil` deixaria o avatar do canto com o nome antigo.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Revoga todos os logins desta pessoa, inclusive o navegador atual. */
export async function logoutAllSessionsAction(): Promise<never> {
  const session = await container.session.getCurrentSession();
  const count = await revokeAllSessions(session.user.id);
  await writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'sessao.encerrada',
    targetType: 'sessao',
    metadata: { detalhe: 'todas as sessões', count },
  });
  await destroyCurrentSession();
  redirect('/login');
}

/**
 * Grava a foto de perfil.
 *
 * `FormData` e não JSON: é o único jeito de uma Server Action receber um
 * `File` do navegador sem passar a base64 por cima, que infla o payload em
 * ~33% para nada.
 */
export async function uploadProfilePhotoAction(formData: FormData): Promise<ProfileActionResult> {
  const session = await container.session.getCurrentSession();

  const file = formData.get('photo');
  if (!(file instanceof File)) {
    return { ok: false, error: 'Nenhuma imagem recebida.' };
  }
  if (file.size === 0) {
    return { ok: false, error: 'O arquivo está vazio.' };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: 'A imagem passou de 5 MB. Escolha um arquivo menor.' };
  }
  if (!isAllowedAvatarMimeType(file.type)) {
    return {
      ok: false,
      error: `Envie uma imagem ${ALLOWED_AVATAR_MIME_TYPES.map((t) => t.split('/')[1]).join(', ')}.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // O caminho é fixo por pessoa — sem extensão no nome do objeto, porque o
  // tipo já vai na URL (ver `buildAvatarUrl`) e não em lugar nenhum do Storage.
  // Reenviar uma foto nova substitui a anterior (`x-upsert`, dentro de
  // `storage.upload`), nunca acumula.
  const uploaded = await storage.upload(
    BUCKETS.AVATARS,
    `users/${session.user.id}`,
    buffer,
    file.type,
  );
  if (!uploaded) {
    return {
      ok: false,
      error: 'Não foi possível enviar a imagem agora. Tente novamente em instantes.',
    };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarUrl: buildAvatarUrl(session.user.id, file.type) },
  });

  // Mesmo alcance de `updateProfileAction`: o avatar aparece na rail de
  // navegação e no seletor de workspace, que são do layout.
  revalidatePath('/', 'layout');
  return { ok: true };
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
  confirmPassword: z.string().min(1).max(200),
});

/**
 * Troca a senha de quem está logado.
 *
 * Tudo que a tela confere é conferido de novo aqui, porque a tela não é a
 * autorização: a senha atual, a confirmação dupla e a regra mínima.
 *
 * As **outras** sessões caem junto. Trocar a senha costuma ser a resposta a
 * "alguém pode ter acesso à minha conta", e manter logado o navegador desse
 * alguém tornaria a troca inútil. A sessão atual continua: quem acabou de
 * provar a senha não precisa entrar de novo.
 */
export async function changePasswordAction(input: unknown): Promise<ProfileActionResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: 'Preencha a senha atual, a nova e a confirmação.' };

  const session = await container.session.getCurrentSession();
  if (!canChangeOwnPassword(session)) {
    return {
      ok: false,
      error: 'Seu papel não permite trocar a senha por aqui. Fale com quem administra a conta.',
    };
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;
  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'A confirmação não confere com a nova senha.' };
  }
  const problema = passwordProblem(newPassword);
  if (problema) return { ok: false, error: problema };
  if (newPassword === currentPassword) {
    return { ok: false, error: 'A nova senha precisa ser diferente da atual.' };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return { ok: false, error: 'A senha atual está incorreta.' };
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    const encerradas = await revokeOtherSessions(session.user.id, session.tokenId);

    await writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'senha.alterada',
      targetType: 'membro',
      targetId: session.user.id,
      targetName: session.user.name,
      metadata: { sessoesEncerradas: encerradas },
    }).catch(() => undefined);

    return { ok: true };
  } catch (error) {
    console.error('[perfil] Falha ao trocar a senha:', error);
    return { ok: false, error: 'Não foi possível trocar a senha. Tente de novo.' };
  }
}
