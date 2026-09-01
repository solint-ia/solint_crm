import type { AuditAction, AuditTargetType } from '@/core/domain/audit';
import { prisma, asJson } from '@/infrastructure/db/prisma';

export interface WriteAuditLogInput {
  readonly accountId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId?: string;
  readonly targetName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly ip?: string;
  readonly userAgent?: string;
}

const requestMetadata = async (): Promise<{ ip?: string; userAgent?: string }> => {
  if (process.env.SOLINT_WORKER === '1') return {};
  try {
    const { headers } = await import('next/headers');
    const values = await headers();
    const ip = values.get('x-forwarded-for')?.split(',')[0]?.trim() ?? values.get('x-real-ip');
    const userAgent = values.get('user-agent');
    return {
      ...(ip ? { ip: ip.slice(0, 60) } : {}),
      ...(userAgent ? { userAgent: userAgent.slice(0, 300) } : {}),
    };
  } catch {
    return {};
  }
};

/** Auditoria nunca transforma uma ação bem-sucedida em erro. */
export const writeAuditLog = async (input: WriteAuditLogInput): Promise<void> => {
  try {
    const request = input.ip || input.userAgent ? {} : await requestMetadata();
    await prisma.auditLogEntry.create({
      data: {
        accountId: input.accountId,
        actorId: input.actorId,
        actorName: input.actorName,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? null,
        ip: input.ip ?? request.ip ?? null,
        userAgent: input.userAgent ?? request.userAgent ?? null,
        metadata: asJson(input.metadata ?? {}),
      },
    });
  } catch (error) {
    console.warn('[Auditoria] Não foi possível registrar a ação:', error);
  }
};
