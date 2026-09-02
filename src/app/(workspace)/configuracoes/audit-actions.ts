'use server';

import { z } from 'zod';
import type { AuditAction } from '@/core/domain/audit';
import { can } from '@/core/domain/user';
import { container } from '@/infrastructure/container';
import { writeAuditLog } from '@/infrastructure/audit/write-audit-log';
import { PrismaAuditRepository } from '@/infrastructure/repositories/prisma/audit-repository';

const repository = new PrismaAuditRepository();
const filtersSchema = z.object({
  actorId: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  conversationId: z.string().max(128).optional(),
  query: z.string().max(120).optional(),
  cursor: z.string().max(64).optional(),
});

export async function listAuditLogAction(input: unknown) {
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Filtros inválidos.' };
  const session = await container.session.getCurrentSession();
  if (!can(session, 'config.seguranca:ler')) return { ok: false as const, error: 'Sem permissão.' };
  const records = await repository.list(session.account.id, {
    ...parsed.data,
    action: parsed.data.action as AuditAction | undefined,
  });
  return { ok: true as const, records };
}

export async function auditLogExportAction(input: unknown) {
  const parsed = z.object({ count: z.number().int().min(0).max(100_000) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'Exportação inválida.' };
  const session = await container.session.getCurrentSession();
  if (!can(session, 'config.seguranca:ler')) return { ok: false as const, error: 'Sem permissão.' };
  await writeAuditLog({
    accountId: session.account.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: 'dados.exportados',
    targetType: 'relatorio',
    targetName: 'Auditoria',
    metadata: { count: parsed.data.count, format: 'csv' },
  });
  return { ok: true as const };
}
