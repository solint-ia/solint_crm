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

/**
 * A atuação de plataforma é carimbada aqui, e não em cada chamada.
 *
 * O `actorId` já sai certo sozinho: a sessão de plataforma é montada com o
 * usuário real do superadministrador, então quem chama passa o id dele sem
 * saber disso. O que faltava era o **marcador** — sem ele, o histórico do
 * cliente mostra o nome de alguém que nunca foi membro da conta, sem dizer por
 * que ele aparece ali.
 *
 * Central de propósito: são cerca de trinta chamadas espalhadas por Server
 * Actions, e pedir que cada uma lembrasse de marcar significaria que a primeira
 * esquecida registraria a ação como se fosse de dentro da conta. `readSession`
 * é memorizada por requisição, então na prática isto não custa consulta nenhuma.
 *
 * A falha é engolida: auditoria nunca transforma uma ação bem-sucedida em erro,
 * e um carimbo perdido é menos grave que a linha inteira perdida.
 */
const carimboDePlataforma = async (): Promise<{
  actorName?: string;
  metadata?: Record<string, unknown>;
}> => {
  if (process.env.SOLINT_WORKER === '1') return {};
  try {
    const { readSession } = await import('@/infrastructure/auth/session');
    const session = await readSession();
    if (!session?.platformActor) return {};
    return {
      actorName: `${session.platformActor.name} (plataforma)`,
      metadata: { plataforma: true, atorEmail: session.platformActor.email },
    };
  } catch {
    return {};
  }
};

/** Auditoria nunca transforma uma ação bem-sucedida em erro. */
export const writeAuditLog = async (input: WriteAuditLogInput): Promise<void> => {
  try {
    const request = input.ip || input.userAgent ? {} : await requestMetadata();
    const plataforma = await carimboDePlataforma();
    await prisma.auditLogEntry.create({
      data: {
        accountId: input.accountId,
        actorId: input.actorId,
        actorName: plataforma.actorName ?? input.actorName,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? null,
        ip: input.ip ?? request.ip ?? null,
        userAgent: input.userAgent ?? request.userAgent ?? null,
        metadata: asJson({ ...(input.metadata ?? {}), ...(plataforma.metadata ?? {}) }),
      },
    });
  } catch (error) {
    console.warn('[Auditoria] Não foi possível registrar a ação:', error);
  }
};
