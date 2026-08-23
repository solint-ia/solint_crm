import 'server-only';

import type { Contact } from '@/core/domain/contact';
import { PhoneNumber } from '@/core/domain/contact';
import { ConflictError, DomainError, NotFoundError, type Id } from '@/core/domain/shared';
import type { ContactFilter, ContactRepository } from '@/core/ports/contact-repository';
import { prisma, toJson } from '@/infrastructure/db/prisma';
import { contactRow } from './mappers';

const INCLUDE = { labels: true } as const;

export class PrismaContactRepository implements ContactRepository {
  async list(accountId: Id, filter?: ContactFilter): Promise<readonly Contact[]> {
    const rows = await prisma.contact.findMany({
      where: {
        accountId,
        ...(filter?.ownerName ? { ownerName: filter.ownerName } : {}),
        ...(filter?.labelId ? { labels: { some: { id: filter.labelId } } } : {}),
      },
      include: INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(contactRow);
  }

  async findById(accountId: Id, contactId: Id): Promise<Contact | null> {
    const row = await prisma.contact.findFirst({
      where: { id: contactId, accountId },
      include: INCLUDE,
    });
    return row ? contactRow(row) : null;
  }

  async create(accountId: Id, input: Omit<Contact, 'id' | 'accountId'>): Promise<Contact> {
    // A validação de telefone é do domínio e vale igual em qualquer adaptador:
    // um contato inválido não deve chegar ao banco.
    if (input.kind !== 'grupo' && !PhoneNumber.isValid(input.phone)) {
      throw new DomainError('Telefone inválido: use o formato E.164.', 'INVALID_PHONE');
    }

    const row = await prisma.contact.create({
      data: {
        id: `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        accountId,
        name: input.name,
        phone: input.phone ? PhoneNumber.normalize(input.phone) : '',
        email: input.email ?? null,
        company: input.company ?? null,
        channel: input.channel,
        avatarTone: input.avatarTone,
        location: input.location ?? null,
        timezone: input.timezone ?? null,
        ownerName: input.ownerName ?? null,
        lastContactAt: input.lastContactAt ?? null,
        lastContactLabel: input.lastContactLabel ?? null,
        customFieldsJson: toJson(input.customFields ?? []),
        notes: input.notes ?? null,
        timelineJson: input.timeline ? toJson(input.timeline) : null,
        kind: input.kind ?? 'pessoa',
        avatarUrl: input.avatarUrl ?? null,
        participantCount: input.participantCount ?? null,
        labels: { connect: input.labels.map((label) => ({ id: label.id })) },
      },
      include: INCLUDE,
    });
    return contactRow(row);
  }

  async update(accountId: Id, contactId: Id, patch: Partial<Contact>): Promise<Contact> {
    const exists = await prisma.contact.findFirst({
      where: { id: contactId, accountId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Contato', contactId);

    const row = await prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.phone === undefined ? {} : { phone: PhoneNumber.normalize(patch.phone) }),
        ...(patch.email === undefined ? {} : { email: patch.email ?? null }),
        ...(patch.company === undefined ? {} : { company: patch.company ?? null }),
        ...(patch.notes === undefined ? {} : { notes: patch.notes ?? null }),
        ...(patch.ownerName === undefined ? {} : { ownerName: patch.ownerName ?? null }),
        ...(patch.avatarUrl === undefined ? {} : { avatarUrl: patch.avatarUrl ?? null }),
        ...(patch.customFields === undefined
          ? {}
          : { customFieldsJson: toJson(patch.customFields) }),
        ...(patch.labels === undefined
          ? {}
          : { labels: { set: patch.labels.map((label) => ({ id: label.id })) } }),
      },
      include: INCLUDE,
    });
    return contactRow(row);
  }

  /**
   * Mescla dois contatos.
   *
   * As conversas do duplicado passam para o principal antes da exclusão —
   * apagar primeiro levaria o histórico junto, que é exatamente o que a mescla
   * deveria preservar.
   */
  async merge(accountId: Id, primaryId: Id, duplicateId: Id): Promise<Contact> {
    if (primaryId === duplicateId) {
      throw new ConflictError('Não é possível mesclar um contato com ele mesmo.');
    }

    const [primary, duplicate] = await Promise.all([
      prisma.contact.findFirst({ where: { id: primaryId, accountId }, include: INCLUDE }),
      prisma.contact.findFirst({ where: { id: duplicateId, accountId }, include: INCLUDE }),
    ]);
    if (!primary) throw new NotFoundError('Contato', primaryId);
    if (!duplicate) throw new NotFoundError('Contato', duplicateId);

    const mergedLabels = [
      ...new Set([...primary.labels, ...duplicate.labels].map((label) => label.id)),
    ];

    const row = await prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });
      await tx.deal.updateMany({
        where: { contactId: duplicateId },
        data: { contactId: primaryId },
      });

      const updated = await tx.contact.update({
        where: { id: primaryId },
        data: {
          email: primary.email ?? duplicate.email,
          company: primary.company ?? duplicate.company,
          notes: [primary.notes, duplicate.notes].filter(Boolean).join('\n\n') || null,
          labels: { set: mergedLabels.map((id) => ({ id })) },
        },
        include: INCLUDE,
      });

      await tx.contact.delete({ where: { id: duplicateId } });
      return updated;
    });

    return contactRow(row);
  }
}
