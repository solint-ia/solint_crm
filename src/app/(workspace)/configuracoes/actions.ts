'use server';

import { z } from 'zod';
import { ARTICLE_STATUSES } from '@/core/domain/knowledge';
import type { AssignmentMethod } from '@/core/domain/settings';
import { can } from '@/core/domain/user';
import { WEEKDAYS } from '@/core/domain/business-hours';
import { container } from '@/infrastructure/container';

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Escrever em configurações é privilégio de papel, não de tela.
 * Esconder o botão no cliente não protege nada: a checagem mora aqui.
 */
const assertCanWrite = async () => {
  const session = await container.session.getCurrentSession();
  if (!can(session, 'configuracoes:escrever')) {
    throw new Error('Seu papel não permite alterar configurações.');
  }
  return session;
};

const failureOf = (error: unknown, fallback: string): ActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const toggleAutomationSchema = z.object({
  automationId: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export async function toggleAutomationAction(input: unknown): Promise<ActionResult> {
  const parsed = toggleAutomationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Dados inválidos para automação.' };
  }

  try {
    const session = await assertCanWrite();
    await container.settings.setAutomationEnabled(
      session.account.id,
      parsed.data.automationId,
      parsed.data.enabled,
    );
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar automação.');
  }
}

const setAssignmentMethodSchema = z.object({
  method: z.enum(['round_robin', 'balanceada', 'manual'] as const),
});

export async function setAssignmentMethodAction(input: unknown): Promise<ActionResult> {
  const parsed = setAssignmentMethodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Método de atribuição inválido.' };
  }

  try {
    const session = await assertCanWrite();
    await container.settings.setAssignmentMethod(
      session.account.id,
      parsed.data.method as AssignmentMethod,
    );
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar método de atribuição.');
  }
}

const conditionSchema = z.object({
  field: z.enum(['canal', 'etiqueta', 'fila', 'prioridade', 'horario', 'palavra_chave'] as const),
  operator: z.enum(['igual', 'diferente', 'contem'] as const),
  value: z.string().trim().min(1).max(120),
});

const actionSchema = z.object({
  type: z.enum([
    'atribuir_equipe',
    'atribuir_agente',
    'definir_prioridade',
    'aplicar_etiqueta',
    'enviar_mensagem',
    'notificar',
    'resolver',
  ] as const),
  value: z.string().trim().max(160),
});

const saveAutomationSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(3).max(80),
  trigger: z.enum([
    'conversa_criada',
    'mensagem_recebida',
    'conversa_pendente',
    'conversa_resolvida',
  ] as const),
  conditions: z.array(conditionSchema).max(8),
  // Uma automação sem ação não faz nada: recusar é mais honesto que salvar vazio.
  actions: z.array(actionSchema).min(1).max(8),
  enabled: z.boolean(),
});

export async function saveAutomationAction(input: unknown): Promise<ActionResult> {
  const parsed = saveAutomationSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error:
        first?.path[0] === 'actions'
          ? 'Adicione ao menos uma ação para a automação fazer alguma coisa.'
          : 'Dados inválidos para automação.',
    };
  }

  try {
    const session = await assertCanWrite();
    await container.settings.saveAutomation(session.account.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar automação.');
  }
}

const automationIdSchema = z.object({ automationId: z.string().min(1).max(64) });

export async function deleteAutomationAction(input: unknown): Promise<ActionResult> {
  const parsed = automationIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Automação inválida.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteAutomation(session.account.id, parsed.data.automationId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir automação.');
  }
}

const moveAutomationSchema = automationIdSchema.extend({
  direction: z.enum(['cima', 'baixo'] as const),
});

export async function moveAutomationAction(input: unknown): Promise<ActionResult> {
  const parsed = moveAutomationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Movimento inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.moveAutomation(
      session.account.id,
      parsed.data.automationId,
      parsed.data.direction,
    );
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao reordenar automações.');
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const autoReplySchema = z.object({
  enabled: z.boolean(),
  text: z.string().trim().max(1000),
});

const updateInboxSchema = z.object({
  connectionId: z.string().min(1).max(64),
  businessHours: z
    .object({
      timezone: z.string().trim().min(1).max(64),
      days: z
        .array(
          z.object({
            day: z.enum(WEEKDAYS),
            enabled: z.boolean(),
            opensAt: z.string().regex(TIME, 'Horário inválido'),
            closesAt: z.string().regex(TIME, 'Horário inválido'),
          }),
        )
        .length(7),
    })
    .optional(),
  awayMessage: autoReplySchema.optional(),
  greeting: autoReplySchema.optional(),
  // String vazia é intencional: significa "remover o webhook".
  webhookUrl: z.union([z.literal(''), z.string().url().max(300)]).optional(),
});

export async function updateInboxAction(input: unknown): Promise<ActionResult> {
  const parsed = updateInboxSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error:
        first?.path.includes('webhookUrl')
          ? 'A URL do webhook precisa começar com http:// ou https://.'
          : 'Dados inválidos para a caixa de entrada.',
    };
  }

  const { connectionId, ...patch } = parsed.data;

  try {
    const session = await assertCanWrite();
    await container.settings.updateInbox(session.account.id, connectionId, patch);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar a caixa de entrada.');
  }
}

const saveArticleSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  categoryId: z.string().min(1).max(64),
  title: z.string().trim().min(3).max(140),
  excerpt: z.string().trim().max(240),
  content: z.string().trim().min(10).max(20000),
  status: z.enum(ARTICLE_STATUSES),
  tags: z.array(z.string().trim().min(1).max(32)).max(10),
});

export async function saveArticleAction(input: unknown): Promise<ActionResult> {
  const parsed = saveArticleSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error:
        first?.path[0] === 'content'
          ? 'O artigo precisa de pelo menos 10 caracteres de conteúdo.'
          : 'Preencha título, categoria e conteúdo do artigo.',
    };
  }

  try {
    const session = await assertCanWrite();
    await container.settings.saveArticle(session.account.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar o artigo.');
  }
}

const articleIdSchema = z.object({ articleId: z.string().min(1).max(64) });

export async function deleteArticleAction(input: unknown): Promise<ActionResult> {
  const parsed = articleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Artigo inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteArticle(session.account.id, parsed.data.articleId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir o artigo.');
  }
}

const saveCategorySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(160),
});

export async function saveCategoryAction(input: unknown): Promise<ActionResult> {
  const parsed = saveCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nome de categoria inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.saveCategory(
      session.account.id,
      parsed.data.name,
      parsed.data.description,
      parsed.data.id,
    );
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar a categoria.');
  }
}

const categoryIdSchema = z.object({ categoryId: z.string().min(1).max(64) });

export async function deleteCategoryAction(input: unknown): Promise<ActionResult> {
  const parsed = categoryIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Categoria inválida.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteCategory(session.account.id, parsed.data.categoryId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir a categoria.');
  }
}
