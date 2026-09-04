'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { readSuperAdmin } from '@/infrastructure/auth/session';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { container } from '@/infrastructure/container';
import { prisma } from '@/infrastructure/db/prisma';

export interface PlatformActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Toda action daqui recebe `accountId` no payload.
 *
 * É a diferença essencial em relação às actions do workspace, que agiam sempre
 * na conta da sessão: aqui a conta é um argumento, então ela **precisa** ser
 * validada como argumento — e a única credencial que autoriza escolher qualquer
 * conta é a flag de superadministrador.
 */
const assertSuperAdmin = async (): Promise<{ id: string; name: string }> => {
  const admin = await readSuperAdmin();
  if (!admin) throw new Error('Acesso restrito ao administrador da plataforma.');
  return { id: admin.id, name: admin.name };
};

const failureOf = (error: unknown, fallback: string): PlatformActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const accountId = z.string().min(1).max(64);
const webhookEvents = z.enum([
  'mensagem.recebida',
  'mensagem.enviada',
  'conversa.criada',
  'conversa.resolvida',
  'contato.criado',
]);

const webhookInboxScope = z
  .object({
    allInboxes: z.boolean(),
    inboxIds: z.array(z.string().min(1).max(64)).max(200).default([]),
  })
  .superRefine((scope, context) => {
    if (!scope.allInboxes && scope.inboxIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['inboxIds'],
        message: 'Selecione pelo menos uma caixa de entrada.',
      });
    }
  });

// ------------------------------------------------------------------ Webhooks

const createWebhookSchema = z
  .object({
    accountId,
    name: z.string().trim().min(2).max(80),
    url: z.string().trim().url().max(500),
    events: z.array(webhookEvents).min(1),
    /** Assina cada entrega em `X-Solint-Signature`. Opcional, mas recomendado. */
    secret: z.string().trim().min(16).max(200).optional(),
  })
  .and(webhookInboxScope);

/**
 * Nome das caixas, para o registro de auditoria dizer o que aconteceu.
 *
 * Guardar só os ids tornaria a linha ilegível justamente quando ela é
 * consultada: depois que a caixa foi renomeada ou excluída. O id vai junto
 * porque é ele que permite reconstruir o vínculo.
 */
const nomearCaixas = async (
  conta: string,
  ids: readonly string[],
): Promise<readonly { id: string; nome: string }[]> => {
  if (ids.length === 0) return [];
  const rows = await prisma.inbox.findMany({
    where: { accountId: conta, id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  const porId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => ({ id, nome: porId.get(id) ?? '(caixa removida)' }));
};

export async function platformCreateWebhookAction(input: unknown): Promise<PlatformActionResult> {
  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados do webhook inválidos.' };

  try {
    const ator = await assertSuperAdmin();
    const { accountId: conta, ...draft } = parsed.data;
    const webhook = await container.settings.createWebhook(conta, draft);
    await writeAuditLog({
      accountId: conta,
      actorId: ator.id,
      actorName: ator.name,
      action: 'configuracao.alterada',
      targetType: 'configuracao',
      targetId: webhook.id,
      targetName: draft.name,
      metadata: {
        detalhe: 'webhook criado',
        url: draft.url,
        eventos: draft.events,
        escopo: draft.allInboxes ? 'todas as caixas' : 'caixas selecionadas',
        caixas: await nomearCaixas(conta, webhook.inboxIds),
      },
    });
    revalidatePath(`/plataforma/${conta}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar webhook.');
  }
}

const updateWebhookInboxesSchema = z
  .object({
    accountId,
    webhookId: z.string().min(1).max(64),
  })
  .and(webhookInboxScope);

export interface PlatformWebhookScopeResult extends PlatformActionResult {
  /**
   * Entregas que estavam na fila e deixaram de ser permitidas.
   *
   * Volta para a tela porque o número muda o que o operador entende do que
   * acabou de fazer: restringir um webhook não é só uma regra para o futuro,
   * é o descarte do que ainda não saiu.
   */
  readonly canceledDeliveries?: number;
}

export async function platformUpdateWebhookInboxesAction(
  input: unknown,
): Promise<PlatformWebhookScopeResult> {
  const parsed = updateWebhookInboxesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Selecione pelo menos uma caixa de entrada válida.' };
  }

  try {
    const ator = await assertSuperAdmin();
    const mudanca = await container.settings.updateWebhookInboxes(
      parsed.data.accountId,
      parsed.data.webhookId,
      { allInboxes: parsed.data.allInboxes, inboxIds: parsed.data.inboxIds },
    );

    const [adicionadas, removidas] = await Promise.all([
      nomearCaixas(parsed.data.accountId, mudanca.added),
      nomearCaixas(parsed.data.accountId, mudanca.removed),
    ]);
    await writeAuditLog({
      accountId: parsed.data.accountId,
      actorId: ator.id,
      actorName: ator.name,
      action: 'configuracao.alterada',
      targetType: 'configuracao',
      targetId: mudanca.webhook.id,
      targetName: mudanca.webhook.url,
      metadata: {
        detalhe: 'escopo de caixas do webhook alterado',
        escopo: mudanca.webhook.allInboxes ? 'todas as caixas' : 'caixas selecionadas',
        caixasAdicionadas: adicionadas,
        caixasRemovidas: removidas,
        entregasCanceladas: mudanca.canceledDeliveries,
      },
    });

    revalidatePath(`/plataforma/${parsed.data.accountId}`);
    return { ok: true, canceledDeliveries: mudanca.canceledDeliveries };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar as caixas do webhook.');
  }
}

const toggleWebhookSchema = z.object({
  accountId,
  webhookId: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export async function platformToggleWebhookAction(input: unknown): Promise<PlatformActionResult> {
  const parsed = toggleWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    await assertSuperAdmin();
    await container.settings.toggleWebhook(
      parsed.data.accountId,
      parsed.data.webhookId,
      parsed.data.enabled,
    );
    revalidatePath(`/plataforma/${parsed.data.accountId}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao alterar status do webhook.');
  }
}

const deleteWebhookSchema = z.object({ accountId, webhookId: z.string().min(1).max(64) });

export async function platformDeleteWebhookAction(input: unknown): Promise<PlatformActionResult> {
  const parsed = deleteWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Webhook inválido.' };

  try {
    await assertSuperAdmin();
    await container.settings.deleteWebhook(parsed.data.accountId, parsed.data.webhookId);
    revalidatePath(`/plataforma/${parsed.data.accountId}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir webhook.');
  }
}

// ----------------------------------------------------- Webhook por caixa

const inboxWebhookSchema = z.object({
  accountId,
  connectionId: z.string().min(1).max(64),
  // String vazia é intencional: significa "remover o webhook desta caixa".
  webhookUrl: z.union([z.literal(''), z.string().trim().url().max(300)]),
});

export async function platformUpdateInboxWebhookAction(
  input: unknown,
): Promise<PlatformActionResult> {
  const parsed = inboxWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'A URL precisa começar com http:// ou https://.' };
  }

  try {
    await assertSuperAdmin();
    await container.settings.updateInbox(parsed.data.accountId, parsed.data.connectionId, {
      webhookUrl: parsed.data.webhookUrl,
    });
    revalidatePath(`/plataforma/${parsed.data.accountId}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar o webhook da caixa.');
  }
}

// ------------------------------------------------------------ Tokens de API

const createApiTokenSchema = z.object({
  accountId,
  name: z.string().trim().min(2).max(80),
  permissions: z.array(z.string()).optional(),
});

export async function platformCreateApiTokenAction(
  input: unknown,
): Promise<PlatformActionResult & { readonly rawSecret?: string }> {
  const parsed = createApiTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Nome do token inválido.' };

  try {
    await assertSuperAdmin();
    const { accountId: conta, ...draft } = parsed.data;
    const { rawSecret } = await container.settings.createApiToken(conta, draft);
    revalidatePath(`/plataforma/${conta}`);
    // O segredo volta uma única vez: o banco guarda só o SHA-256 dele.
    return { ok: true, rawSecret };
  } catch (error) {
    return failureOf(error, 'Erro ao gerar token de API.');
  }
}

const deleteApiTokenSchema = z.object({ accountId, tokenId: z.string().min(1).max(64) });

export async function platformDeleteApiTokenAction(input: unknown): Promise<PlatformActionResult> {
  const parsed = deleteApiTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Token inválido.' };

  try {
    await assertSuperAdmin();
    await container.settings.deleteApiToken(parsed.data.accountId, parsed.data.tokenId);
    revalidatePath(`/plataforma/${parsed.data.accountId}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao revogar token de API.');
  }
}
