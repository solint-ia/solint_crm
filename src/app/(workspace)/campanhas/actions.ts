'use server';

import { z } from 'zod';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';

export interface ActionResult<T = unknown> {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: T;
}

const assertCanDispatch = async () => {
  const session = await container.session.getCurrentSession();
  if (!can(session, 'campanhas:disparar')) {
    throw new Error('Seu papel não permite disparar ou agendar campanhas.');
  }
  return session;
};

const failureOf = (error: unknown, fallback: string): ActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  segmentId: z.string().optional(),
  templateId: z.string().min(1),
  scheduledAt: z.string().optional(),
  rateLimit: z.number().int().min(1).max(600).default(60),
  variables: z.array(z.string()).optional(),
});

export async function createCampaignAction(input: unknown): Promise<ActionResult> {
  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados da campanha inválidos.' };

  try {
    const session = await assertCanDispatch();
    const campaign = await container.campaigns.createCampaign(session.account.id, {
      name: parsed.data.name,
      segmentId: parsed.data.segmentId || undefined,
      templateId: parsed.data.templateId,
      scheduledAt: parsed.data.scheduledAt,
      rateLimit: parsed.data.rateLimit,
      variables: parsed.data.variables,
    });
    return { ok: true, data: campaign };
  } catch (error) {
    return failureOf(error, 'Erro ao criar campanha.');
  }
}

const toggleStatusSchema = z.object({
  campaignId: z.string().min(1),
  status: z.enum(['pausada', 'em_andamento', 'cancelada'] as const),
});

export async function toggleCampaignStatusAction(input: unknown): Promise<ActionResult> {
  const parsed = toggleStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const session = await assertCanDispatch();
    const campaign = await container.campaigns.toggleCampaignStatus(
      session.account.id,
      parsed.data.campaignId,
      parsed.data.status,
    );
    return { ok: true, data: campaign };
  } catch (error) {
    return failureOf(error, 'Erro ao alterar status da campanha.');
  }
}

const deleteCampaignSchema = z.object({
  campaignId: z.string().min(1),
});

export async function deleteCampaignAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteCampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido.' };

  try {
    const session = await assertCanDispatch();
    await container.campaigns.deleteCampaign(session.account.id, parsed.data.campaignId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir campanha.');
  }
}
