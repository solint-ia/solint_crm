'use server';

import { z } from 'zod';
import { CHANNELS } from '@/core/domain/channel';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import { whatsappService } from '@/infrastructure/whatsapp/whatsapp-service';

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

const failureOf = <T = unknown>(error: unknown, fallback: string): ActionResult<T> => ({
  ok: false,
  error: error instanceof Error ? error.message : fallback,
});

const createContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().optional().or(z.literal('')),
  company: z.string().trim().max(100).optional().or(z.literal('')),
  channel: z.enum(CHANNELS).default('whatsapp'),
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

const importContactsCsvSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Nome é obrigatório.'),
        phone: z.string().trim().min(5, 'Telefone é obrigatório.'),
        email: z.string().trim().email('E-mail inválido.').optional().or(z.literal('')),
        company: z.string().trim().max(100).optional().or(z.literal('')),
        notes: z.string().trim().max(2000).optional().or(z.literal('')),
      }),
    )
    .min(1, 'Nenhum contato enviado para importação.'),
});

export interface ImportCsvResult {
  readonly importedCount: number;
  readonly updatedCount: number;
  readonly errorCount: number;
  readonly errors: readonly { readonly line: number; readonly name: string; readonly error: string }[];
}

export async function importContactsCsvAction(input: unknown): Promise<ActionResult<ImportCsvResult>> {
  const parsed = importContactsCsvSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados de importação inválidos.' };
  }

  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    let importedCount = 0;
    let updatedCount = 0;
    const errors: { line: number; name: string; error: string }[] = [];

    for (let i = 0; i < parsed.data.contacts.length; i++) {
      const item = parsed.data.contacts[i]!;
      const lineNumber = i + 1;

      let rawDigits = item.phone.replace(/\D/g, '');
      if (!rawDigits) {
        errors.push({ line: lineNumber, name: item.name, error: 'Telefone vazio ou inválido.' });
        continue;
      }
      if (rawDigits.length === 10 || rawDigits.length === 11) {
        rawDigits = `55${rawDigits}`;
      }
      const normalizedPhone = `+${rawDigits}`;

      if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
        errors.push({ line: lineNumber, name: item.name, error: `Telefone inválido (${item.phone}).` });
        continue;
      }

      const existing = await prisma.contact.findFirst({
        where: { accountId, phone: normalizedPhone },
      });

      if (existing) {
        await prisma.contact.update({
          where: { id: existing.id, accountId },
          data: {
            name: existing.name || item.name,
            email: existing.email || (item.email ? item.email : undefined),
            company: existing.company || (item.company ? item.company : undefined),
            notes: existing.notes
              ? item.notes
                ? `${existing.notes}\n\n[Importado]: ${item.notes}`
                : existing.notes
              : item.notes || undefined,
          },
        });
        updatedCount += 1;
      } else {
        const contactId = `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        await prisma.contact.create({
          data: {
            id: contactId,
            accountId,
            name: item.name,
            phone: normalizedPhone,
            email: item.email || null,
            company: item.company || null,
            channel: 'whatsapp',
            avatarTone: 'blue',
            kind: 'pessoa',
            notes: item.notes || null,
            customFields: asJson([]),
            timeline: asJson([]),
          },
        });
        importedCount += 1;
      }
    }

    return {
      ok: true,
      data: {
        importedCount,
        updatedCount,
        errorCount: errors.length,
        errors,
      },
    };
  } catch (error) {
    return failureOf(error, 'Erro ao processar importação de contatos.');
  }
}

export async function syncWhatsAppContactsAction(): Promise<ActionResult<{ syncedCount: number; newCount: number }>> {
  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    // Busca exclusivamente conversas 1:1 privadas ativas no WhatsApp desta conta
    const conversations = await prisma.conversation.findMany({
      where: {
        accountId,
        channel: 'whatsapp',
        channelThreadId: { not: { endsWith: '@g.us' } },
      },
      include: { contact: true },
    });

    let syncedCount = 0;
    let updatedCount = 0;

    // 1. Sincroniza e normaliza contatos com conversas 1:1 diretas existentes
    for (const conv of conversations) {
      const contact = conv.contact;
      if (!contact || contact.kind === 'grupo') continue;

      syncedCount += 1;

      // Normaliza telefone se necessário
      if (contact.phone) {
        let digits = contact.phone.replace(/\D/g, '');
        if (digits.length === 10 || digits.length === 11) {
          digits = `55${digits}`;
        }
        const normalized = `+${digits}`;
        if (/^\+[1-9]\d{7,14}$/.test(normalized) && normalized !== contact.phone) {
          await prisma.contact.update({
            where: { id: contact.id, accountId },
            data: { phone: normalized },
          });
          updatedCount += 1;
        }
      }
    }

    // 2. Sincroniza todos os contatos da agenda do celular registrados na sessão do WhatsApp
    try {
      const storedResult = await whatsappService.syncAllStoredContacts(accountId);
      syncedCount += storedResult.synced;
      updatedCount += storedResult.created;
    } catch {
      // Ignora suavemente se a instância em memória não estiver ativa neste processo
    }

    return {
      ok: true,
      data: {
        syncedCount,
        newCount: updatedCount,
      },
    };
  } catch (error) {
    return failureOf(error, 'Falha ao sincronizar contatos do WhatsApp.');
  }
}
