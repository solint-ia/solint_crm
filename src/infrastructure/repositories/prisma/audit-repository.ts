import {
  AUDIT_RETENTION_DAYS,
  type AuditAction,
  type AuditRecord,
} from '@/core/domain/audit';
import { prisma, readJson } from '@/infrastructure/db/prisma';

export interface AuditFilters {
  readonly actorId?: string;
  readonly action?: AuditAction;
  readonly conversationId?: string;
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

const cutoff = () => new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);

export class PrismaAuditRepository {
  async list(accountId: string, filters: AuditFilters = {}): Promise<readonly AuditRecord[]> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const rows = await prisma.auditLogEntry.findMany({
      where: {
        accountId,
        createdAt: { gte: cutoff() },
        ...(filters.actorId ? { actorId: filters.actorId } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.conversationId
          ? {
              OR: [
                { targetId: filters.conversationId },
                { metadata: { path: ['conversationId'], equals: filters.conversationId } },
              ],
            }
          : {}),
        ...(filters.query
          ? {
              OR: [
                { actorName: { contains: filters.query, mode: 'insensitive' as const } },
                { targetName: { contains: filters.query, mode: 'insensitive' as const } },
                { action: { contains: filters.query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });

    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorName: row.actorName,
      action: row.action as AuditAction,
      targetType: row.targetType as AuditRecord['targetType'],
      ...(row.targetId ? { targetId: row.targetId } : {}),
      ...(row.targetName ? { targetName: row.targetName } : {}),
      ...(row.ip ? { ip: row.ip } : {}),
      ...(row.userAgent ? { userAgent: row.userAgent } : {}),
      metadata: readJson<Readonly<Record<string, unknown>>>(row.metadata, {}),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async actorsDoPeriodo(accountId: string): Promise<readonly { id: string; name: string }[]> {
    const rows = await prisma.auditLogEntry.findMany({
      where: { accountId, createdAt: { gte: cutoff() } },
      distinct: ['actorId'],
      select: { actorId: true, actorName: true },
      orderBy: { actorName: 'asc' },
    });
    return rows.map((row) => ({ id: row.actorId, name: row.actorName }));
  }
}
