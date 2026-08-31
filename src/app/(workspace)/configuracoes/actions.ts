'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_CONDITION_LOGICS,
  AUTOMATION_TRIGGERS,
} from '@/core/domain/automation';
import { CHANNELS } from '@/core/domain/channel';
import { ARTICLE_STATUSES } from '@/core/domain/knowledge';
import { TONES } from '@/core/domain/label';
import type { AssignmentMethod, ChannelConnection } from '@/core/domain/settings';
import { can } from '@/core/domain/user';
import { WEEKDAYS } from '@/core/domain/business-hours';
import { randomUUID } from 'node:crypto';
import { hashPassword, passwordProblem } from '@/infrastructure/auth/password';
import { prisma } from '@/infrastructure/db/prisma';
import { container } from '@/infrastructure/container';
import type { InboxDeletionImpact } from '@/core/ports/settings-repository';
import { PrismaSettingsRepository } from '@/infrastructure/repositories/prisma/settings-repository';

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

// Derivado do domínio, não recopiado: quando `mover_etapa_kanban` foi
// acrescentada, a lista fixa daqui teria recusado a regra nova sem dizer por quê.
const actionSchema = z.object({
  type: z.enum(AUTOMATION_ACTION_TYPES),
  value: z.string().trim().max(160),
});

const saveAutomationSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(3).max(80),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: z.array(conditionSchema).max(8),
  // Regra gravada antes do campo chega sem ele; `e` é o que ela sempre valeu.
  conditionLogic: z.enum(AUTOMATION_CONDITION_LOGICS).default('e'),
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

const createInboxSchema = z.object({
  name: z.string().trim().min(2, 'O nome da caixa deve ter pelo menos 2 caracteres.').max(100),
  channel: z.enum(CHANNELS).default('whatsapp'),
});

export async function createInboxAction(
  input: unknown,
): Promise<ActionResult & { readonly connection?: ChannelConnection }> {
  const parsed = createInboxSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Dados inválidos para a nova caixa de entrada.',
    };
  }

  try {
    const session = await assertCanWrite();
    const settingsRepo =
      typeof container.settings.createInbox === 'function'
        ? container.settings
        : new PrismaSettingsRepository();
    const connection = await settingsRepo.createInbox(session.account.id, parsed.data);
    revalidatePath('/configuracoes');
    return { ok: true, connection };
  } catch (error) {
    return failureOf(error, 'Erro ao criar a nova caixa de entrada.');
  }
}

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
  closingMessage: autoReplySchema.optional(),
  waitingMessage: autoReplySchema.optional(),
  // String vazia é intencional: significa "remover o webhook".
  webhookUrl: z.union([z.literal(''), z.string().url().max(300)]).optional(),
});

export async function updateInboxAction(input: unknown): Promise<ActionResult> {
  const parsed = updateInboxSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.path.includes('webhookUrl')
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

const inboxImpactSchema = z.object({ connectionId: z.string().min(1).max(64) });

/**
 * Quanto histórico a exclusão levaria junto — lido quando o modal abre.
 *
 * Fica fora do payload de `WorkspaceSettings` de propósito: contar mensagem de
 * todas as caixas a cada carregamento da tela de configurações custaria caro
 * para um número que só interessa a quem está prestes a apagar uma delas.
 */
export async function inboxDeletionImpactAction(
  input: unknown,
): Promise<ActionResult & { readonly impact?: InboxDeletionImpact }> {
  const parsed = inboxImpactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Caixa de entrada inválida.' };
  }

  try {
    const session = await assertCanWrite();
    const settingsRepo =
      typeof container.settings.inboxDeletionImpact === 'function'
        ? container.settings
        : new PrismaSettingsRepository();
    const impact = await settingsRepo.inboxDeletionImpact(
      session.account.id,
      parsed.data.connectionId,
    );
    return { ok: true, impact };
  } catch (error) {
    return failureOf(error, 'Erro ao consultar o conteúdo da caixa de entrada.');
  }
}

const deleteInboxSchema = z.object({
  connectionId: z.string().min(1).max(64),
  /** Nome exato da caixa, digitado por quem pediu a exclusão. */
  confirmName: z.string().trim().min(1).max(100),
});

/**
 * Exclui a caixa de entrada com as conversas e mensagens dentro.
 *
 * A operação é irreversível e não tem lixeira, então ela não se contenta com o
 * id: quem chama precisa repetir o nome da caixa, e é o repositório que
 * confere contra o nome que está no banco.
 */
export async function deleteInboxAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteInboxSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Dados inválidos para excluir a caixa de entrada.' };
  }

  try {
    const session = await assertCanWrite();
    const settingsRepo =
      typeof container.settings.deleteInbox === 'function'
        ? container.settings
        : new PrismaSettingsRepository();
    await settingsRepo.deleteInbox(
      session.account.id,
      parsed.data.connectionId,
      parsed.data.confirmName,
    );
    revalidatePath('/configuracoes');
    revalidatePath('/conversas');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir a caixa de entrada.');
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

// ---------------------------------------------------------------- Onda 3: Webhooks

const createWebhookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url(),
  events: z.array(z.string().min(1)).min(1),
  /** Assina cada entrega em `X-Solint-Signature`. Opcional, mas recomendado. */
  secret: z.string().trim().min(16).max(200).optional(),
});

export async function createWebhookAction(input: unknown): Promise<ActionResult> {
  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados do webhook inválidos.' };

  try {
    const session = await assertCanWrite();
    await container.settings.createWebhook(session.account.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar webhook.');
  }
}

const toggleWebhookSchema = z.object({
  webhookId: z.string().min(1),
  enabled: z.boolean(),
});

export async function toggleWebhookAction(input: unknown): Promise<ActionResult> {
  const parsed = toggleWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    await container.settings.toggleWebhook(
      session.account.id,
      parsed.data.webhookId,
      parsed.data.enabled,
    );
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao alterar status do webhook.');
  }
}

const deleteWebhookSchema = z.object({ webhookId: z.string().min(1) });

export async function deleteWebhookAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Webhook inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteWebhook(session.account.id, parsed.data.webhookId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir webhook.');
  }
}

// ---------------------------------------------------------------- Onda 3: Tokens de API

const createApiTokenSchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(z.string()).optional(),
});

export async function createApiTokenAction(
  input: unknown,
): Promise<ActionResult & { rawSecret?: string }> {
  const parsed = createApiTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nome do token inválido.' };

  try {
    const session = await assertCanWrite();
    const { rawSecret } = await container.settings.createApiToken(session.account.id, parsed.data);
    return { ok: true, rawSecret };
  } catch (error) {
    return failureOf(error, 'Erro ao gerar token de API.');
  }
}

const deleteApiTokenSchema = z.object({ tokenId: z.string().min(1) });

export async function deleteApiTokenAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteApiTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Token inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteApiToken(session.account.id, parsed.data.tokenId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao revogar token de API.');
  }
}

// ---------------------------------------------------------------- Onda 3: Respostas Rápidas

const createCannedResponseSchema = z.object({
  shortcut: z.string().trim().min(1).max(30),
  content: z.string().trim().min(1).max(2000),
});

export async function createCannedResponseAction(input: unknown): Promise<ActionResult> {
  const parsed = createCannedResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Atalho ou conteúdo inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.createCannedResponse(session.account.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar resposta rápida.');
  }
}

const updateCannedResponseSchema = createCannedResponseSchema.extend({
  responseId: z.string().min(1).max(64),
});

export async function updateCannedResponseAction(input: unknown): Promise<ActionResult> {
  const parsed = updateCannedResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Atalho ou conteúdo inválido.' };

  const { responseId, ...draft } = parsed.data;
  try {
    const session = await assertCanWrite();
    await container.settings.updateCannedResponse(session.account.id, responseId, draft);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar resposta rápida.');
  }
}

const deleteCannedResponseSchema = z.object({ responseId: z.string().min(1) });

export async function deleteCannedResponseAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteCannedResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Resposta rápida inválida.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteCannedResponse(session.account.id, parsed.data.responseId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir resposta rápida.');
  }
}

// ---------------------------------------------------------------- Onda 3: Atributos Customizados

const createCustomAttributeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'A chave deve conter apenas letras minúsculas, números e sublinhados.'),
  type: z.enum(['texto', 'numero', 'data', 'lista', 'booleano'] as const),
  appliesTo: z.enum(['contato', 'conversa'] as const),
  options: z.array(z.string().trim()).optional(),
});

export async function createCustomAttributeAction(input: unknown): Promise<ActionResult> {
  const parsed = createCustomAttributeSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    await container.settings.createCustomAttribute(session.account.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar atributo customizado.');
  }
}

const deleteCustomAttributeSchema = z.object({ attributeId: z.string().min(1) });

export async function deleteCustomAttributeAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteCustomAttributeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Atributo inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteCustomAttribute(session.account.id, parsed.data.attributeId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir atributo.');
  }
}

// ---------------------------------------------------------------- Onda 3: Equipes

const teamSchema = z.object({
  name: z.string().trim().min(2).max(60),
  color: z.string().trim().optional(),
  memberIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  inboxIds: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export async function createTeamAction(input: unknown): Promise<ActionResult> {
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nome da equipe inválido.' };

  try {
    const session = await assertCanWrite();
    await container.settings.createTeam(session.account.id, parsed.data);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar equipe.');
  }
}

const updateTeamSchema = teamSchema.extend({ teamId: z.string().min(1).max(64) });

export async function updateTeamAction(input: unknown): Promise<ActionResult> {
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos para a equipe.' };

  const { teamId, ...draft } = parsed.data;

  try {
    const session = await assertCanWrite();
    await container.settings.updateTeam(session.account.id, teamId, draft);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar equipe.');
  }
}

const deleteTeamSchema = z.object({ teamId: z.string().min(1) });

export async function deleteTeamAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Equipe inválida.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteTeam(session.account.id, parsed.data.teamId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir equipe.');
  }
}

/* ==========================================================================
   Colaboradores — como uma empresa ganha gente além de quem criou a conta.

   Era por convite: o gestor gerava um link, mandava por fora e esperava a
   pessoa aceitar, escolher a própria senha e aparecer na lista. Três passos
   fora do controle de quem contratou, e nenhum jeito de recuperar o acesso
   depois — se o colaborador esquecesse a senha, o gestor não podia fazer nada.

   Agora o gestor cria a conta: nome, e-mail, senha e papel. Entrega as
   credenciais como entrega um crachá, e troca as duas quando precisar. É o
   modelo de qualquer sistema interno de empresa, e é o que se espera de quem
   responde pelo acesso da própria equipe.
   ========================================================================== */

const collaboratorBaseSchema = {
  name: z.string().trim().min(2, 'O nome precisa de pelo menos 2 caracteres.').max(100),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  roleSlug: z.string().min(1).max(64),
  teamIds: z.array(z.string().min(1).max(64)).max(50).optional(),
};

const createCollaboratorSchema = z.object({
  ...collaboratorBaseSchema,
  password: z.string().min(1, 'Defina uma senha para o colaborador.').max(200),
});

/**
 * Confere papel e equipes contra a conta de quem está pedindo.
 *
 * Os dois vêm do formulário, e um `<select>` é uma sugestão do servidor que o
 * cliente pode ignorar. Sem esta conferência, um id de papel de outra empresa
 * entraria no vínculo — e as permissões de lá passariam a valer aqui.
 */
const validarPapelEEquipes = async (
  accountId: string,
  roleSlug: string,
  teamIds: readonly string[] | undefined,
): Promise<{ readonly erro?: string; readonly teamIds: readonly string[] }> => {
  const settings = await container.settings.get(accountId);
  if (!settings.roles.some((role) => role.slug === roleSlug)) {
    return { erro: 'Papel não encontrado nesta conta.', teamIds: [] };
  }
  return {
    teamIds: (teamIds ?? []).filter((id) => settings.teams.some((team) => team.id === id)),
  };
};

/**
 * Cria a conta de acesso de um colaborador.
 *
 * Exige `equipe:gerenciar`, e não `configuracoes:escrever`: abrir a porta da
 * empresa é poder de RH, e há quem edite horário de atendimento sem poder
 * conceder acesso a conversas de clientes.
 */
export async function createCollaboratorAction(input: unknown): Promise<ActionResult> {
  const parsed = createCollaboratorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const fraca = passwordProblem(parsed.data.password);
  if (fraca) return { ok: false, error: fraca };

  try {
    const session = await container.session.getCurrentSession();
    if (!can(session, 'equipe:gerenciar')) {
      return { ok: false, error: 'Seu papel não permite criar acessos.' };
    }

    const { erro, teamIds } = await validarPapelEEquipes(
      session.account.id,
      parsed.data.roleSlug,
      parsed.data.teamIds,
    );
    if (erro) return { ok: false, error: erro };

    // O e-mail é a identidade global de login. Se já existe, esta pessoa já tem
    // senha — e definir outra por aqui seria tomar a conta de alguém que pode
    // pertencer a outra empresa.
    const existente = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, memberships: { where: { accountId: session.account.id } } },
    });
    if (existente) {
      return {
        ok: false,
        error:
          existente.memberships.length > 0
            ? 'Esta pessoa já faz parte da conta.'
            : 'Já existe um acesso com este e-mail. Use outro endereço.',
      };
    }

    const userId = `user-${randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPassword(parsed.data.password);

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          avatarTone: 'var(--color-brand)',
        },
      });
      await tx.membership.create({
        data: {
          userId,
          accountId: session.account.id,
          roleSlug: parsed.data.roleSlug,
          availability: 'disponivel',
        },
      });
      if (teamIds.length > 0) {
        await tx.teamMember.createMany({
          data: teamIds.map((teamId) => ({ teamId, userId })),
          skipDuplicates: true,
        });
      }
    });

    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar o acesso do colaborador.');
  }
}

const updateCollaboratorSchema = z.object({
  ...collaboratorBaseSchema,
  userId: z.string().min(1).max(64),
  /** Vazio = manter a senha atual. Só troca quem digitou uma nova. */
  password: z.string().max(200).optional(),
});

/**
 * Altera nome, e-mail, senha, papel e equipes de um colaborador.
 *
 * Duas travas que não são detalhe:
 *
 *  - **A pessoa precisa ser desta conta.** Sem isso, um `userId` qualquer no
 *    payload trocaria a senha de alguém de outra empresa.
 *  - **A conta não pode ficar sem administrador.** Rebaixar o último é o
 *    caminho mais curto para uma empresa trancada do lado de fora, sem ninguém
 *    que possa desfazer — inclusive quando quem rebaixa é ele mesmo, por
 *    engano.
 */
export async function updateCollaboratorAction(input: unknown): Promise<ActionResult> {
  const parsed = updateCollaboratorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const novaSenha = parsed.data.password?.trim();
  if (novaSenha) {
    const fraca = passwordProblem(novaSenha);
    if (fraca) return { ok: false, error: fraca };
  }

  try {
    const session = await container.session.getCurrentSession();
    if (!can(session, 'equipe:gerenciar')) {
      return { ok: false, error: 'Seu papel não permite editar acessos.' };
    }

    const vinculo = await prisma.membership.findFirst({
      where: { accountId: session.account.id, userId: parsed.data.userId },
      select: { id: true, roleSlug: true },
    });
    if (!vinculo) return { ok: false, error: 'Colaborador não encontrado nesta conta.' };

    const { erro, teamIds } = await validarPapelEEquipes(
      session.account.id,
      parsed.data.roleSlug,
      parsed.data.teamIds,
    );
    if (erro) return { ok: false, error: erro };

    if (vinculo.roleSlug === 'administrador' && parsed.data.roleSlug !== 'administrador') {
      const admins = await prisma.membership.count({
        where: { accountId: session.account.id, roleSlug: 'administrador' },
      });
      if (admins <= 1) {
        return {
          ok: false,
          error: 'Esta é a única pessoa com acesso de administrador. Promova outra antes.',
        };
      }
    }

    const emailEmUso = await prisma.user.findFirst({
      where: { email: parsed.data.email, id: { not: parsed.data.userId } },
      select: { id: true },
    });
    if (emailEmUso) return { ok: false, error: 'Já existe um acesso com este e-mail.' };

    const passwordHash = novaSenha ? await hashPassword(novaSenha) : undefined;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: parsed.data.userId },
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      await tx.membership.update({
        where: { id: vinculo.id },
        data: { roleSlug: parsed.data.roleSlug },
      });
      // As equipes são substituídas, não somadas: a tela mostra o conjunto
      // final, e tratar a lista como acréscimo faria "desmarcar" não desmarcar.
      await tx.teamMember.deleteMany({
        where: { userId: parsed.data.userId, team: { accountId: session.account.id } },
      });
      if (teamIds.length > 0) {
        await tx.teamMember.createMany({
          data: teamIds.map((teamId) => ({ teamId, userId: parsed.data.userId })),
          skipDuplicates: true,
        });
      }
    });

    // A troca de senha derruba as sessões abertas daquela pessoa. É o que se
    // espera de "troquei a senha dele": se o acesso está sendo revogado ou
    // recuperado, deixar a sessão antiga viva anularia o motivo da troca.
    if (passwordHash) {
      await prisma.authSession.deleteMany({ where: { userId: parsed.data.userId } });
    }

    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar o colaborador.');
  }
}

const removeCollaboratorSchema = z.object({ userId: z.string().min(1).max(64) });

/**
 * Tira o colaborador desta conta.
 *
 * Remove o **vínculo**, não a pessoa: o mesmo e-mail pode atender noutra
 * empresa, e apagar o usuário levaria junto o acesso de lá.
 */
export async function removeCollaboratorAction(input: unknown): Promise<ActionResult> {
  const parsed = removeCollaboratorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Colaborador inválido.' };

  try {
    const session = await container.session.getCurrentSession();
    if (!can(session, 'equipe:gerenciar')) {
      return { ok: false, error: 'Seu papel não permite remover acessos.' };
    }
    if (parsed.data.userId === session.user.id) {
      return { ok: false, error: 'Você não pode remover o próprio acesso.' };
    }

    const vinculo = await prisma.membership.findFirst({
      where: { accountId: session.account.id, userId: parsed.data.userId },
      select: { id: true, roleSlug: true },
    });
    if (!vinculo) return { ok: false, error: 'Colaborador não encontrado nesta conta.' };

    if (vinculo.roleSlug === 'administrador') {
      const admins = await prisma.membership.count({
        where: { accountId: session.account.id, roleSlug: 'administrador' },
      });
      if (admins <= 1) {
        return { ok: false, error: 'A conta ficaria sem administrador.' };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({
        where: { userId: parsed.data.userId, team: { accountId: session.account.id } },
      });
      await tx.membership.delete({ where: { id: vinculo.id } });
      await tx.authSession.deleteMany({ where: { userId: parsed.data.userId } });
    });

    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao remover o colaborador.');
  }
}

// ---------------------------------------------------------------- Etiquetas

const labelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tone: z.enum(TONES),
  description: z.string().trim().max(200).optional(),
});

export async function createLabelAction(input: unknown): Promise<ActionResult> {
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  try {
    const session = await assertCanWrite();
    await container.settings.createLabel(session.account.id, parsed.data);
    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar etiqueta.');
  }
}

const updateLabelSchema = labelSchema.extend({
  labelId: z.string().min(1).max(64),
});

export async function updateLabelAction(input: unknown): Promise<ActionResult> {
  const parsed = updateLabelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const { labelId, ...draft } = parsed.data;
  try {
    const session = await assertCanWrite();
    await container.settings.updateLabel(session.account.id, labelId, draft);
    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar etiqueta.');
  }
}

const deleteLabelSchema = z.object({ labelId: z.string().min(1).max(64) });

export async function deleteLabelAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteLabelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Etiqueta inválida.' };

  try {
    const session = await assertCanWrite();
    await container.settings.deleteLabel(session.account.id, parsed.data.labelId);
    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir etiqueta.');
  }
}

// ---------------------------------------------------------------- Sessões ativas

const terminateSessionSchema = z.object({ sessionId: z.string().min(1).max(64) });

export async function terminateSessionAction(input: unknown): Promise<ActionResult> {
  const parsed = terminateSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Sessão inválida.' };

  try {
    const session = await assertCanWrite();
    await container.settings.terminateSession(session.account.id, parsed.data.sessionId);
    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao encerrar a sessão.');
  }
}

export async function terminateOtherSessionsAction(): Promise<ActionResult> {
  try {
    const session = await assertCanWrite();
    await container.settings.terminateOtherSessions(session.account.id);
    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao encerrar as sessões.');
  }
}

// ---------------------------------------------------------------- Dados da empresa

/** Campo de texto opcional: string vazia significa "apagar", não "manter". */
const opcional = (max: number) => z.string().trim().max(max).optional();

const companySchema = z.object({
  tradeName: z.string().trim().min(2, 'O nome fantasia precisa de ao menos 2 caracteres.').max(120),
  legalName: opcional(160),
  document: opcional(24),
  website: z.union([z.literal(''), z.string().trim().url('Informe uma URL válida.').max(200)]).optional(),
  address: opcional(240),
  phone: opcional(32),
  email: z.union([z.literal(''), z.string().trim().email('Informe um e-mail válido.').max(160)]).optional(),
  language: opcional(16),
  timezone: opcional(64),
  currency: opcional(8),
  dateFormat: opcional(16),
  firstDayOfWeek: opcional(16),
  brandColor: opcional(16),
});

export async function saveCompanyProfileAction(input: unknown): Promise<ActionResult> {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados da empresa inválidos.' };
  }

  try {
    const session = await assertCanWrite();
    await container.settings.saveCompanyProfile(session.account.id, parsed.data);
    revalidatePath('/configuracoes');
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar os dados da empresa.');
  }
}
