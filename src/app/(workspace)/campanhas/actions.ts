'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Campaign, CampaignAudience, CampaignVariable } from '@/core/domain/campaign';
import { can } from '@/core/domain/user';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { isoDeDataHoraLocal } from '@/lib/datetime';

export interface ActionResult<T = unknown> {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: T;
}

/**
 * Defesa em profundidade: esconder a tela não desarma a action, que continua
 * exposta como endpoint POST para quem souber o id dela. Cada uma confere a
 * flag antes de tocar em sessão ou banco.
 */
const FEATURE_OFF = { ok: false, error: 'Funcionalidade em preparação.' } as const;

const assertCanDispatch = async () => {
  const session = await container.session.getCurrentSession();
  if (!can(session, 'campanhas:disparar')) {
    throw new Error('Seu papel não permite disparar ou agendar campanhas.');
  }
  return session;
};

const failureOf = (error: unknown, fallback: string): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const audienceSchema: z.ZodType<CampaignAudience> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('todos') }),
  z.object({
    kind: z.literal('lista'),
    batchId: z.string().min(1).max(64),
    name: z.string().trim().max(120).optional(),
  }),
  z.object({
    kind: z.literal('etiqueta'),
    labelId: z.string().min(1).max(64),
    name: z.string().trim().max(120).optional(),
  }),
]);

const variableSchema: z.ZodType<CampaignVariable> = z.discriminatedUnion('source', [
  z.object({ source: z.literal('texto'), value: z.string().trim().max(300) }),
  z.object({
    source: z.literal('campo'),
    field: z.enum(['nome', 'primeiro_nome', 'empresa', 'telefone']),
  }),
]);

const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  inboxId: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
  audience: audienceSchema,
  variables: z.array(variableSchema).max(10),
  /** `datetime-local` no fuso do produto; vazio = agora. */
  scheduledAt: z.string().trim().max(32).optional(),
  rateLimit: z.number().int().min(1).max(600).default(30),
});

export async function createCampaignAction(input: unknown): Promise<ActionResult<Campaign>> {
  if (!FEATURES.campanhas) return FEATURE_OFF;

  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados da campanha inválidos.' };

  const scheduledAt = parsed.data.scheduledAt ? isoDeDataHoraLocal(parsed.data.scheduledAt) : null;
  if (parsed.data.scheduledAt && !scheduledAt) {
    return { ok: false, error: 'Data de agendamento inválida.' };
  }

  try {
    const session = await assertCanDispatch();
    const campaign = await container.campaigns.createCampaign(session.account.id, {
      name: parsed.data.name,
      inboxId: parsed.data.inboxId,
      templateId: parsed.data.templateId,
      audience: parsed.data.audience,
      variables: parsed.data.variables,
      rateLimit: parsed.data.rateLimit,
      ...(scheduledAt ? { scheduledAt } : {}),
      createdById: session.user.id,
    });

    void writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'configuracao.alterada',
      targetType: 'configuracao',
      targetId: campaign.id,
      targetName: campaign.name,
      metadata: {
        detalhe: 'campanha_criada',
        template: campaign.templateName,
        publico: campaign.audienceLabel,
        destinatarios: campaign.metrics.recipients,
        caixa: campaign.inboxName,
        ...(scheduledAt ? { agendadaPara: scheduledAt } : {}),
      },
    });

    revalidatePath('/campanhas');
    return { ok: true, data: campaign };
  } catch (error) {
    return failureOf(error, 'Erro ao criar campanha.');
  }
}

const campaignIdSchema = z.object({ campaignId: z.string().min(1).max(64) });

const transicao = async (
  input: unknown,
  operacao: 'pausar' | 'retomar' | 'cancelar',
): Promise<ActionResult<Campaign>> => {
  if (!FEATURES.campanhas) return FEATURE_OFF;
  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido.' };
  try {
    const session = await assertCanDispatch();
    const repo = container.campaigns;
    const campaign =
      operacao === 'pausar'
        ? await repo.pauseCampaign(session.account.id, parsed.data.campaignId)
        : operacao === 'retomar'
          ? await repo.resumeCampaign(session.account.id, parsed.data.campaignId)
          : await repo.cancelCampaign(session.account.id, parsed.data.campaignId);
    revalidatePath('/campanhas');
    return { ok: true, data: campaign };
  } catch (error) {
    return failureOf(error, 'Erro ao alterar a campanha.');
  }
};

export async function pauseCampaignAction(input: unknown): Promise<ActionResult<Campaign>> {
  return transicao(input, 'pausar');
}

export async function resumeCampaignAction(input: unknown): Promise<ActionResult<Campaign>> {
  return transicao(input, 'retomar');
}

export async function cancelCampaignAction(input: unknown): Promise<ActionResult<Campaign>> {
  return transicao(input, 'cancelar');
}

export async function deleteCampaignAction(input: unknown): Promise<ActionResult> {
  if (!FEATURES.campanhas) return FEATURE_OFF;

  const parsed = campaignIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido.' };

  try {
    const session = await assertCanDispatch();
    await container.campaigns.deleteCampaign(session.account.id, parsed.data.campaignId);
    revalidatePath('/campanhas');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir campanha.');
  }
}
