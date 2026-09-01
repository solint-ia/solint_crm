'use server';

import { z } from 'zod';
import { CHANNELS } from '@/core/domain/channel';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { prisma, asJson } from '@/infrastructure/db/prisma';
import { normalizeImportedPhone } from '@/core/domain/contact-import';
import { postgresPubSub, CHANNELS as DB_CHANNELS } from '@/infrastructure/db/postgres-pubsub';
import { WA_ENGINE } from '@/infrastructure/whatsapp/channel';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';

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
    await writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.excluidos',
      targetType: 'contato',
      targetId: parsed.data.contactId,
      metadata: { count: 1 },
    });
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir contato.');
  }
}

export async function deleteContactsAction(input: unknown): Promise<ActionResult<{ count: number }>> {
  const parsed = z.object({ contactIds: z.array(z.string().min(1)).min(1).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Contatos inválidos.' };
  try {
    const session = await assertCanWrite();
    const result = await prisma.contact.deleteMany({
      where: { accountId: session.account.id, id: { in: parsed.data.contactIds } },
    });
    await writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.excluidos',
      targetType: 'contato',
      metadata: { count: result.count },
    });
    return { ok: true, data: { count: result.count } };
  } catch (error) {
    return failureOf(error, 'Erro ao excluir contatos.');
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

/**
 * O schema é deliberadamente tolerante com e-mail, empresa e notas.
 *
 * Antes, `email` era `.email()` obrigatório-se-presente e `notes` tinha teto de
 * 2000 — e o Zod recusa o **payload inteiro** quando uma linha desrespeita
 * qualquer regra. Numa planilha de prospecção com milhares de linhas, um único
 * e-mail malformado (ou uma célula com dezesseis e-mails separados por ponto e
 * vírgula, que é o formato real dessas exportações) derrubava a importação toda
 * sem dizer qual linha era a culpada. Agora a tela já normaliza esses campos
 * (ver `contact-import.ts`) e o que chega aqui é cortado, não recusado: o
 * telefone é o único campo cuja invalidez descarta a linha, e ela é relatada
 * uma a uma no resultado.
 */
const importContactsCsvSchema = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Nome é obrigatório.'),
        /**
         * Todos os números da mesma pessoa. O primeiro vira o principal.
         *
         * Era um `phone` só, e a planilha traz a mesma pessoa em várias linhas
         * — uma por telefone. Cada linha virava um contato separado, três
         * "Thiago Franklin Proenca" na agenda sem nada indicando que eram a
         * mesma pessoa.
         */
        phones: z.array(z.string().trim().min(5)).min(1).max(20),
        email: z.string().trim().max(200).optional().or(z.literal('')),
        company: z.string().trim().max(200).optional().or(z.literal('')),
        notes: z.string().trim().max(5000).optional().or(z.literal('')),
      }),
    )
    .min(1, 'Nenhum contato enviado para importação.')
    .max(5000, 'Importe no máximo 5000 contatos por vez.'),
});

export interface ImportCsvResult {
  readonly importedCount: number;
  readonly updatedCount: number;
  readonly errorCount: number;
  readonly errors: readonly { readonly line: number; readonly name: string; readonly error: string }[];
}

export async function auditContactsExportAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ count: z.number().int().min(0).max(1_000_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Quantidade inválida.' };
  try {
    const session = await container.session.getCurrentSession();
    if (!can(session, 'contatos:exportar')) return { ok: false, error: 'Sem permissão.' };
    await writeAuditLog({
      accountId: session.account.id,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.exportados',
      targetType: 'contato',
      metadata: { count: parsed.data.count, format: 'csv' },
    });
    return { ok: true };
  } catch (error) {
    return failureOf(error, 'Erro ao registrar a exportação.');
  }
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

      /**
       * A normalização é a mesma da tela, e vem do domínio.
       *
       * Antes havia uma cópia aqui — `replace(/\D/g)`, `if length === 10 || 11
       * prefixa 55` — e a tela tinha outra. Duas cópias da mesma regra é uma
       * divergência esperando data: a tela dizia "3 contatos, 5 números" e o
       * banco recebia outra coisa.
       */
      const numeros = [
        ...new Set(
          item.phones
            .map((bruto) => normalizeImportedPhone(bruto))
            .filter((numero): numero is string => numero !== null),
        ),
      ];

      if (numeros.length === 0) {
        errors.push({
          line: lineNumber,
          name: item.name,
          error: `Nenhum telefone válido (${item.phones.join(', ')}).`,
        });
        continue;
      }

      const [principal, ...extras] = numeros as [string, ...string[]];

      /**
       * O contato já existente é procurado por **qualquer** um dos números.
       *
       * Só pelo principal, reimportar a mesma planilha depois de o comercial
       * ter trocado a ordem das linhas criaria um segundo contato da mesma
       * pessoa — o número que virou principal na segunda passada estava na
       * lista de extras da primeira, e ninguém encontraria o outro.
       */
      const existing = await prisma.contact.findFirst({
        where: {
          accountId,
          OR: [{ phone: { in: numeros } }, { extraPhones: { hasSome: numeros } }],
        },
      });

      if (existing) {
        // Os números se somam, não se substituem: a planilha nova pode trazer
        // um celular a mais sem que isso apague o que já se sabia da pessoa.
        const jaConhecidos = new Set([existing.phone, ...existing.extraPhones]);
        const novosExtras = [...existing.extraPhones];
        for (const numero of numeros) {
          if (!jaConhecidos.has(numero)) {
            novosExtras.push(numero);
            jaConhecidos.add(numero);
          }
        }

        await prisma.contact.update({
          where: { id: existing.id, accountId },
          data: {
            name: existing.name || item.name,
            extraPhones: novosExtras,
            email: existing.email || (item.email ? item.email : undefined),
            company: existing.company || (item.company ? item.company : undefined),
            notes: existing.notes
              ? item.notes
                ? `${existing.notes}

[Importado]: ${item.notes}`
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
            phone: principal,
            extraPhones: extras,
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

    await writeAuditLog({
      accountId,
      actorId: session.user.id,
      actorName: session.user.name,
      action: 'contatos.importados',
      targetType: 'contato',
      metadata: { importedCount, updatedCount, errorCount: errors.length },
    });

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

/**
 * Espera o worker concluir o comando, dentro de um teto.
 *
 * O teto era de 2,5 segundos, e não dava. Sincronizar contatos agora repuxa a
 * agenda inteira do WhatsApp (ver `pullAddressBook` em `worker/session.ts`) —
 * uma ida ao servidor mais a gravação de centenas de linhas. A Server Action
 * respondia antes de qualquer coisa chegar, o contador vinha igual ao anterior
 * e a tela dizia "0 novos" enquanto o worker ainda estava trabalhando.
 *
 * Vinte segundos cobrem uma agenda grande sem transformar a espera numa tela
 * travada. Estourado o teto a função devolve mesmo assim: o trabalho continua
 * no worker, e a lista mostra o resultado no próximo carregamento.
 */
const ESPERA_MAX_MS = 20_000;

const aguardarComando = async (commandId: string): Promise<'concluido' | 'em_andamento'> => {
  const inicio = Date.now();
  while (Date.now() - inicio < ESPERA_MAX_MS) {
    await new Promise((r) => setTimeout(r, 400));
    const atual = await prisma.whatsAppCommand.findUnique({
      where: { id: commandId },
      select: { status: true },
    });
    if (atual?.status === 'completed' || atual?.status === 'failed') return 'concluido';
  }
  return 'em_andamento';
};

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

    // 1. Normaliza contatos com conversas 1:1 diretas existentes se necessário
    for (const conv of conversations) {
      const contact = conv.contact;
      if (!contact || contact.kind === 'grupo' || !contact.phone) continue;

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
      }
    }

    const previousContacts = await prisma.contact.count({
      where: { accountId, kind: { not: 'grupo' } },
    });

    const inboxes = await prisma.inbox.findMany({
      where: { accountId, channel: 'whatsapp' },
      include: { waConnection: true },
      orderBy: { id: 'asc' },
    });

    const conectada = inboxes.find(
      (i) => i.waConnection?.status === 'conectado' || Boolean(i.waConnection?.lockOwner),
    );
    const pareada = inboxes.find((i) => Boolean(i.waConnection?.credsCipher));
    const targetInbox = conectada ?? pareada ?? inboxes[0];

    if (targetInbox) {
      if (WA_ENGINE === 'inprocess') {
        /**
         * Sem worker não há fila, e sem fila o comando ficaria pendente para
         * sempre.
         *
         * O caminho abaixo enfileirava um `sync_contacts` **em qualquer
         * motor** — mas quem consome essa fila é o worker. Com o motor
         * in-process (o padrão de `npm run dev`), o botão sempre terminava
         * dizendo "sincronizado" sem ter sincronizado nada: o comando ficava
         * `pending` no banco e o contador voltava igual.
         */
        const { whatsappService } = await import('@/infrastructure/whatsapp/whatsapp-service');
        await whatsappService.syncAllStoredContacts(accountId);
      } else {
        const cmd = await prisma.whatsAppCommand.create({
          data: {
            inboxId: targetInbox.id,
            kind: 'sync_contacts',
            payload: { accountId },
            status: 'pending',
          },
        });

        await postgresPubSub.publish(DB_CHANNELS.COMMANDS, {
          inboxId: targetInbox.id,
          kind: 'sync_contacts',
          id: cmd.id,
        });

        await aguardarComando(cmd.id);
      }
    }

    const currentContacts = await prisma.contact.count({
      where: { accountId, kind: { not: 'grupo' } },
    });

    return {
      ok: true,
      data: {
        syncedCount: currentContacts,
        newCount: Math.max(0, currentContacts - previousContacts),
      },
    };
  } catch (error) {
    return failureOf(error, 'Falha ao sincronizar contatos do WhatsApp.');
  }
}

const toggleGroupChatSchema = z.object({
  contactId: z.string().min(1),
  allowed: z.boolean(),
});

export async function toggleGroupChatAction(
  input: unknown,
): Promise<ActionResult<{ contactId: string; allowed: boolean }>> {
  const parsed = toggleGroupChatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Dados inválidos.' };

  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;
    const { contactId, allowed } = parsed.data;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, accountId },
    });
    if (!contact) return { ok: false, error: 'Grupo não encontrado.' };

    const currentFields = Array.isArray(contact.customFields)
      ? (contact.customFields as { label: string; value: string }[])
      : [];

    const filtered = currentFields.filter(
      (f) => f.label !== 'group_chat_enabled' && f.label !== 'Permitido no Chat',
    );
    filtered.push({ label: 'group_chat_enabled', value: allowed ? 'true' : 'false' });

    await prisma.contact.update({
      where: { id: contact.id, accountId },
      data: {
        customFields: asJson(filtered),
      },
    });

    return { ok: true, data: { contactId, allowed } };
  } catch (error) {
    return failureOf(error, 'Erro ao atualizar permissão do grupo.');
  }
}

export async function syncWhatsAppGroupsAction(): Promise<
  ActionResult<{ syncedCount: number; newCount: number }>
> {
  try {
    const session = await assertCanWrite();
    const accountId = session.account.id;

    // Busca as conexões de WhatsApp da conta
    const inboxes = await prisma.inbox.findMany({
      where: { accountId, channel: 'whatsapp' },
      include: { waConnection: true },
      orderBy: { id: 'asc' },
    });

    const conectada = inboxes.find(
      (i) => i.waConnection?.status === 'conectado' || Boolean(i.waConnection?.lockOwner),
    );
    const pareada = inboxes.find((i) => Boolean(i.waConnection?.credsCipher));
    const targetInbox = conectada ?? pareada ?? inboxes[0];

    if (!targetInbox) {
      return { ok: false, error: 'Nenhuma conexão de WhatsApp encontrada para esta conta.' };
    }

    const previousCount = await prisma.contact.count({
      where: { accountId, kind: 'grupo' },
    });

    // Mesma razão do lado dos contatos: sem worker, a fila não tem consumidor.
    if (WA_ENGINE === 'inprocess') {
      const { whatsappService } = await import('@/infrastructure/whatsapp/whatsapp-service');
      await whatsappService.syncAllGroups(accountId);

      const semWorker = await prisma.contact.count({ where: { accountId, kind: 'grupo' } });
      return {
        ok: true,
        data: {
          syncedCount: semWorker,
          newCount: Math.max(0, semWorker - previousCount),
        },
      };
    }

    /**
     * Todas as caixas pareadas, não só a primeira.
     *
     * Participar de um grupo é do número. Sincronizando de uma caixa só, os
     * grupos das outras nunca apareciam — e os que apareciam ficavam marcados
     * como pertencentes apenas àquela, que é o que fazia o envio pelas demais
     * ser recusado pelo WhatsApp com `not-authorized`.
     *
     * `groupFetchAllParticipating` devolve só os grupos do número que pergunta,
     * então cada caixa contribui com os seus e se registra neles.
     */
    const pareadas = inboxes.filter((inbox) => Boolean(inbox.waConnection?.credsCipher));
    const alvos = pareadas.length > 0 ? pareadas : [targetInbox];

    for (const inbox of alvos) {
      const command = await prisma.whatsAppCommand.create({
        data: {
          inboxId: inbox.id,
          kind: 'sync_groups',
          payload: { accountId },
          status: 'pending',
        },
      });

      await postgresPubSub.publish(DB_CHANNELS.COMMANDS, {
        inboxId: inbox.id,
        kind: 'sync_groups',
        id: command.id,
      });

      // Em série: cada caixa lê e reescreve `group_inbox_ids` do mesmo contato,
      // e duas sincronizações simultâneas perderiam uma das escritas.
      await aguardarComando(command.id);
    }

    const currentCount = await prisma.contact.count({
      where: { accountId, kind: 'grupo' },
    });

    return {
      ok: true,
      data: {
        syncedCount: currentCount,
        newCount: Math.max(0, currentCount - previousCount),
      },
    };
  } catch (error) {
    return failureOf(error, 'Falha ao sincronizar grupos do WhatsApp.');
  }
}
