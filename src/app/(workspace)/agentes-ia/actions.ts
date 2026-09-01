'use server';

import { z } from 'zod';
import { FLOW_BLOCK_TYPES, type AiAgent } from '@/core/domain/ai-agent';
import { FEATURES } from '@/config/features';
import { container } from '@/infrastructure/container';

/**
 * Defesa em profundidade: esconder a tela não desarma a action, que continua
 * exposta como endpoint POST para quem souber o id dela. Cada uma confere a
 * flag antes de tocar em sessão ou banco.
 */
const FEATURE_OFF = { ok: false, error: 'Funcionalidade em preparação.' } as const;

const createAgentSchema = z.object({
  name: z.string().trim().min(2, 'Nome deve ter no mínimo 2 caracteres').max(80),
  scope: z.string().trim().min(2, 'Escopo deve ter no mínimo 2 caracteres').max(120),
  persona: z.string().trim().min(2, 'Persona deve ter no mínimo 2 caracteres').max(500),
  systemPrompt: z.string().trim().max(2000).optional(),
  model: z.string().trim().max(60).optional(),
});

export async function createAiAgentAction(
  input: unknown,
): Promise<{ ok: boolean; agent?: AiAgent; error?: string }> {
  if (!FEATURES.agentesIA) return FEATURE_OFF;

  const parsed = createAgentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const session = await container.session.getCurrentSession();
  if (!session.permissions.includes('agentes-ia:escrever')) {
    return { ok: false, error: 'Seu papel não permite criar agentes de IA.' };
  }

  try {
    const agent = await container.aiAgents.create(session.account.id, parsed.data);
    return { ok: true, agent };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro ao criar o agente de IA.',
    };
  }
}

const idSchema = z.string().min(1).max(64);

const setActiveSchema = z.object({ agentId: idSchema, active: z.boolean() });

export async function setAgentActiveAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  if (!FEATURES.agentesIA) return FEATURE_OFF;

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
  if (!FEATURES.agentesIA) return FEATURE_OFF;

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
  if (!FEATURES.agentesIA) return FEATURE_OFF;

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
  if (!FEATURES.agentesIA) return FEATURE_OFF;

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
