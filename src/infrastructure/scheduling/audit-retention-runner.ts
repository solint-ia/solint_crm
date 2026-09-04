import { randomUUID } from 'node:crypto';

import { AUDIT_RETENTION_DAYS } from '@/core/domain/audit';
import { prisma } from '@/infrastructure/db/prisma';
import { acquireBackgroundLease, releaseBackgroundLease } from './background-lease';

const DAY_MS = 86_400_000;

export class AuditRetentionRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly owner: string;

  constructor(owner = `audit-${randomUUID()}`) {
    this.owner = owner;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), DAY_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deadline = Date.now() + 30_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const lease = await acquireBackgroundLease('audit-retention', this.owner, 10 * 60_000).catch(
      () => null,
    );
    if (!lease) {
      this.running = false;
      return;
    }
    try {
      // tenant-ok: retenção é manutenção global de infraestrutura.
      await prisma.auditLogEntry.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - AUDIT_RETENTION_DAYS * DAY_MS) } },
      });
    } catch (error) {
      console.warn('[Auditoria] Falha ao remover registros expirados:', error);
    } finally {
      await releaseBackgroundLease(lease).catch(() => undefined);
      this.running = false;
    }
  }
}
