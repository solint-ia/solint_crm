'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { Deal } from '@/core/domain/pipeline';
import { container } from '@/infrastructure/container';

/** Resultado que devolve o card atualizado, para a tela não recarregar o quadro. */
interface DealActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly deal?: Deal;
}

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

  if (result.ok) {
    revalidatePath('/kanban');
  }

  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}

const createDealSchema = z.object({
  stageId: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  value: z.number().int().nonnegative().default(0),
  contactName: z.string().trim().max(100).optional(),
  companyName: z.string().trim().max(100).optional(),
  ownerName: z.string().trim().max(80).optional(),
  priority: z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
  probability: z.number().min(0).max(100).optional(),
  source: z.string().optional(),
  nextAction: z.string().trim().max(200).optional(),
});

export async function createDealAction(

  pipelineId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string; deal?: Deal }> {
  const parsed = createDealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados da oportunidade inválidos.' };

  try {
    const session = await container.session.getCurrentSession();
    const deal = await container.pipelines.createDeal(session.account.id, {
      pipelineId,
      stageId: parsed.data.stageId,
      title: parsed.data.title,
      value: parsed.data.value,
      contactName: parsed.data.contactName,
      companyName: parsed.data.companyName,
      ownerName: parsed.data.ownerName,
      priority: parsed.data.priority,
      probability: parsed.data.probability,
      source: parsed.data.source,
      nextAction: parsed.data.nextAction,
    });
    revalidatePath('/kanban');
    return { ok: true, deal };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao criar oportunidade.' };
  }
}

const updateDealSchema = z.object({
  dealId: z.string().min(1),
  title: z.string().trim().min(2).max(120).optional(),
  value: z.number().int().nonnegative().optional(),
  stageId: z.string().optional(),
  contactName: z.string().trim().max(100).optional(),
  companyName: z.string().trim().max(100).optional(),
  ownerName: z.string().trim().max(80).optional(),
  priority: z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
  probability: z.number().min(0).max(100).optional(),
  source: z.string().optional(),
  nextAction: z.string().trim().max(200).optional(),
});

export async function updateDealAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string; deal?: Deal }> {
  const parsed = updateDealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const session = await container.session.getCurrentSession();
    const deal = await container.pipelines.updateDeal(session.account.id, parsed.data.dealId, parsed.data);
    revalidatePath('/kanban');
    return { ok: true, deal };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao atualizar oportunidade.' };
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
    revalidatePath('/kanban');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao excluir oportunidade.' };
  }
}

const updateStagesSchema = z.object({
  stages: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(60),
      order: z.number().int(),
      color: z.string(),
      isWon: z.boolean().default(false),
      isLost: z.boolean().default(false),
      defaultProbability: z.number().min(0).max(100).optional(),
    }),
  ),
});

export async function updateStagesAction(
  pipelineId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = updateStagesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Configuração de etapas inválida.' };

  try {
    const session = await container.session.getCurrentSession();
    await container.pipelines.updateStages(session.account.id, pipelineId, parsed.data.stages);
    revalidatePath('/kanban');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao atualizar etapas.' };
  }
}



/* ==========================================================================
   Checklist do card.

   As tarefas já tinham tabela (`Task`) e relação com `Deal`, mas nenhum
   caminho de escrita: o painel de detalhe montava a lista em estado do React e
   a perdia ao fechar.
   ========================================================================== */

const addTaskSchema = z.object({
  dealId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
});

export async function addDealTaskAction(input: unknown): Promise<DealActionResult> {
  const parsed = addTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Descreva a tarefa antes de adicionar.' };

  try {
    const session = await container.session.getCurrentSession();
    const deal = await container.pipelines.addDealTask(
      session.account.id,
      parsed.data.dealId,
      parsed.data.title,
    );
    revalidatePath('/kanban');
    return { ok: true, deal };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao criar tarefa.' };
  }
}

const taskSchema = z.object({
  dealId: z.string().min(1).max(64),
  taskId: z.string().min(1).max(64),
});

export async function toggleDealTaskAction(input: unknown): Promise<DealActionResult> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Tarefa inválida.' };

  try {
    const session = await container.session.getCurrentSession();
    const deal = await container.pipelines.toggleDealTask(
      session.account.id,
      parsed.data.dealId,
      parsed.data.taskId,
    );
    revalidatePath('/kanban');
    return { ok: true, deal };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao atualizar tarefa.' };
  }
}

export async function deleteDealTaskAction(input: unknown): Promise<DealActionResult> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Tarefa inválida.' };

  try {
    const session = await container.session.getCurrentSession();
    const deal = await container.pipelines.deleteDealTask(
      session.account.id,
      parsed.data.dealId,
      parsed.data.taskId,
    );
    revalidatePath('/kanban');
    return { ok: true, deal };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao excluir tarefa.' };
  }
}
