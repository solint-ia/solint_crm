'use server';

import { z } from 'zod';
import { container } from '@/infrastructure/container';

const moveDealSchema = z.object({
  dealId: z.string().min(1).max(64),
  targetStageId: z.string().min(1).max(64),
});

/**
 * `pipelineId` chega por bind no servidor, e não pelo payload do cliente:
 * assim o cliente não escolhe em qual funil escrever.
 */
export async function moveDealAction(
  pipelineId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = moveDealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Movimento inválido.' };

  const session = await container.session.getCurrentSession();
  const result = await container.useCases.moveDeal({ session, pipelineId, ...parsed.data });

  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}

const createDealSchema = z.object({
  stageId: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  value: z.number().int().nonnegative().default(0),
  contactName: z.string().trim().max(100).optional(),
  companyName: z.string().trim().max(100).optional(),
  ownerName: z.string().trim().max(80).optional(),
});

export async function createDealAction(
  pipelineId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = createDealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados da oportunidade inválidos.' };

  try {
    const session = await container.session.getCurrentSession();
    await container.pipelines.createDeal(session.account.id, {
      pipelineId,
      stageId: parsed.data.stageId,
      title: parsed.data.title,
      value: parsed.data.value,
      contactName: parsed.data.contactName,
      companyName: parsed.data.companyName,
      ownerName: parsed.data.ownerName,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao criar oportunidade.' };
  }
}

const deleteDealSchema = z.object({
  dealId: z.string().min(1),
});

export async function deleteDealAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = deleteDealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificador inválido.' };

  try {
    const session = await container.session.getCurrentSession();
    await container.pipelines.deleteDeal(session.account.id, parsed.data.dealId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao excluir oportunidade.' };
  }
}

