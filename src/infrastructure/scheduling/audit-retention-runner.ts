import { AUDIT_RETENTION_DAYS } from '@/core/domain/audit';
import { prisma } from '@/infrastructure/db/prisma';

const DAY_MS = 86_400_000;

export class AuditRetentionRunner {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), DAY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      // tenant-ok: retenção é manutenção global de infraestrutura.
      await prisma.auditLogEntry.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - AUDIT_RETENTION_DAYS * DAY_MS) } },
      });
    } catch (error) {
      console.warn('[Auditoria] Falha ao remover registros expirados:', error);
    }
  }
}
