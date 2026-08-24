'use server';

import { z } from 'zod';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma, asJson } from '@/infrastructure/db/prisma';

export interface ActionResult<T = unknown> {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: T;
}

const assertCanWrite = async () => {
  const session = await container.session.getCurrentSession();
  if (!can(session, 'contatos:escrever')) {
    throw new Error('Seu papel não permite gerenciar contatos.');
  }
  return session;
};

const failureOf = (error: unknown, fallback: string): ActionResult => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const createContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().optional().or(z.literal('')),
  company: z.string().trim().max(100).optional().or(z.literal('')),
  channel: z.enum(['whatsapp', 'instagram', 'email', 'webchat', 'telegram'] as const).default('whatsapp'),
  notes: z.string().trim().max(2000).optional(),
});

export async function createContactAction(input: unknown): Promise<ActionResult> {
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const contact = await container.contacts.create(session.account.id, {
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email || undefined,
      company: parsed.data.company || undefined,
      channel: parsed.data.channel,
      avatarTone: 'blue',
      notes: parsed.data.notes,
      customFields: [],
      labels: [],
    });
    return { ok: true, data: contact };
  } catch (error) {
    return failureOf(error, 'Erro ao criar contato.');
  }
}

const updateContactSchema = z.object({
  contactId: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  company: z.string().trim().max(100).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
});

export async function updateContactAction(input: unknown): Promise<ActionResult> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const contact = await container.contacts.update(session.account.id, parsed.data.contactId, {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
      email: parsed.data.email || undefined,
      company: parsed.data.company || undefined,
      notes: parsed.data.notes,
    });
    return { ok: true, data: contact };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar contato.');
  }
}

const deleteContactSchema = z.object({
  contactId: z.string().min(1),
});

export async function deleteContactAction(input: unknown): Promise<ActionResult> {
  const parsed = deleteContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Contato inválido.' };

  try {
    const session = await assertCanWrite();
    await container.contacts.delete(session.account.id, parsed.data.contactId);
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir contato.');
  }
}

const mergeContactsSchema = z.object({
  primaryId: z.string().min(1),
  duplicateId: z.string().min(1),
});

export async function mergeContactsAction(input: unknown): Promise<ActionResult> {
  const parsed = mergeContactsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Identificadores inválidos.' };

  try {
    const session = await assertCanWrite();
    const contact = await container.contacts.merge(
      session.account.id,
      parsed.data.primaryId,
      parsed.data.duplicateId,
    );
    return { ok: true, data: contact };
  } catch (error) {
    return failureOf(error, 'Erro ao mesclar contatos.');
  }
}

const saveSegmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional(),
  filters: z.array(z.record(z.unknown())),
  contactCount: z.number().int().nonnegative().default(0),
});

export async function saveSegmentAction(input: unknown): Promise<ActionResult> {
  const parsed = saveSegmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados do segmento inválidos.' };

  try {
    const session = await assertCanWrite();
    const segment = await prisma.segment.create({
      data: {
        accountId: session.account.id,
        name: parsed.data.name,
        description: parsed.data.description,
        filters: asJson(parsed.data.filters),
        contactCount: parsed.data.contactCount,
      },
    });
    return { ok: true, data: segment };
  } catch (error) {
    return failureOf(error, 'Erro ao salvar segmento.');
  }
}
