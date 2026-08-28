'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { asJson, prisma } from '@/infrastructure/db/prisma';

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
    campaigns: z.boolean(),
    dailySummary: z.boolean(),
    /**
     * Vazio é resposta válida: significa "o email do meu login".
     *
     * `z.string().email()` sozinho recusaria a string vazia e obrigaria a
     * preencher um campo que a pessoa deixou em branco de propósito.
     */
    dailySummaryEmail: z.union([z.literal(''), z.string().trim().email().max(160)]).optional(),
    sound: z.boolean(),
  }),
});

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

  const prefs = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...notifications,
    // Campo vazio some do JSON em vez de virar `''`: quem lê pergunta "existe
    // email próprio?", e uma string vazia responde "sim" para nada.
    ...(notifications.dailySummaryEmail
      ? { dailySummaryEmail: notifications.dailySummaryEmail }
      : { dailySummaryEmail: undefined }),
  };

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
