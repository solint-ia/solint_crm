'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { readSuperAdmin } from '@/infrastructure/auth/session';
import { container } from '@/infrastructure/container';

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
const assertSuperAdmin = async (): Promise<void> => {
  const admin = await readSuperAdmin();
  if (!admin) throw new Error('Acesso restrito ao administrador da plataforma.');
};

const failureOf = (error: unknown, fallback: string): PlatformActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const accountId = z.string().min(1).max(64);

// ------------------------------------------------------------------ Webhooks

const createWebhookSchema = z.object({
  accountId,
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url(),
  events: z.array(z.string().min(1)).min(1),
  /** Assina cada entrega em `X-Solint-Signature`. Opcional, mas recomendado. */
  secret: z.string().trim().min(16).max(200).optional(),
});

export async function platformCreateWebhookAction(
  input: unknown,
): Promise<PlatformActionResult> {
  const parsed = createWebhookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados do webhook inválidos.' };

  try {
    await assertSuperAdmin();
    const { accountId: conta, ...draft } = parsed.data;
    await container.settings.createWebhook(conta, draft);
    revalidatePath(`/plataforma/${conta}`);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao criar webhook.');
  }
}

const toggleWebhookSchema = z.object({
  accountId,
  webhookId: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export async function platformToggleWebhookAction(
  input: unknown,
): Promise<PlatformActionResult> {
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

export async function platformDeleteWebhookAction(
  input: unknown,
): Promise<PlatformActionResult> {
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

export async function platformDeleteApiTokenAction(
  input: unknown,
): Promise<PlatformActionResult> {
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
