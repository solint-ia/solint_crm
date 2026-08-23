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
