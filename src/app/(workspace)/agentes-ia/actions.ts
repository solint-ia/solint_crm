'use server';

import { z } from 'zod';
import { FLOW_BLOCK_TYPES } from '@/core/domain/ai-agent';
import { container } from '@/infrastructure/container';

const idSchema = z.string().min(1).max(64);

const setActiveSchema = z.object({ agentId: idSchema, active: z.boolean() });

export async function setAgentActiveAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  const session = await container.session.getCurrentSession();
  if (!session.permissions.includes('agentes-ia:escrever')) {
    return { ok: false, error: 'Seu papel não permite alterar agentes de IA.' };
  }

  await container.aiAgents.setActive(session.account.id, parsed.data.agentId, parsed.data.active);
  return { ok: true };
}

const toggleRuleSchema = z.object({ agentId: idSchema, ruleId: idSchema });

export async function toggleTransferRuleAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = toggleRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  const session = await container.session.getCurrentSession();
  if (!session.permissions.includes('agentes-ia:escrever')) {
    return { ok: false, error: 'Seu papel não permite alterar agentes de IA.' };
  }

  await container.aiAgents.toggleTransferRule(
    session.account.id,
    parsed.data.agentId,
    parsed.data.ruleId,
  );
  return { ok: true };
}

const sandboxSchema = z.object({ agentId: idSchema, prompt: z.string().trim().min(1).max(2000) });

/** Conversa de teste: roda em ambiente isolado e nunca grava em conversas reais. */
export async function sandboxReplyAction(
  input: unknown,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const parsed = sandboxSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Mensagem inválida.' };

  const reply = await container.aiSandbox.reply(parsed.data.agentId, parsed.data.prompt);
  return { ok: true, reply };
}

const flowSchema = z.object({
  agentId: idSchema,
  blocks: z
    .array(
      z.object({
        id: idSchema,
        type: z.enum(FLOW_BLOCK_TYPES),
        title: z.string().trim().min(1).max(120),
        detail: z.string().trim().max(400).optional(),
        branches: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(60),
              targetId: z.string().max(64).optional(),
            }),
          )
          .max(6),
      }),
    )
    .max(40),
});

/** Salva o desenho do fluxo. A validação estrutural vive no domínio e roda na tela. */
export async function saveAgentFlowAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = flowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Fluxo inválido.' };

  const session = await container.session.getCurrentSession();
  if (!session.permissions.includes('agentes-ia:escrever')) {
    return { ok: false, error: 'Seu papel não permite alterar agentes de IA.' };
  }

  try {
    await container.aiAgents.saveFlow(session.account.id, parsed.data.agentId, parsed.data.blocks);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao salvar o fluxo.',
    };
  }
}
