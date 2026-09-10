import { randomUUID } from 'node:crypto';

import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import {
  dispararWebhooks,
  type WebhookEvent,
  type WebhookPayloadEmMontagem,
} from './webhook-dispatch';

const SWEEP_MS = 5_000;
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 8;

interface Candidate {
  readonly id: string;
  readonly accountId: string;
}

/**
 * Transforma o evento-fonte, gravado junto da mensagem, nas entregas de cada
 * webhook. A primeira intenção pendente de uma conta bloqueia as seguintes,
 * inclusive durante backoff, preservando a ordem observada pela integração.
 */
export class WebhookEventOutboxRunner {
  private readonly workerId: string;
  private running = false;
  private dispatching = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastSweepAt: Date | null = null;

  constructor(workerId = `webhook-source-${randomUUID()}`) {
    this.workerId = workerId;
  }

  get healthy(): boolean {
    return Boolean(
      this.running && this.lastSweepAt && Date.now() - this.lastSweepAt.getTime() < 60_000,
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = postgresPubSub.subscribe(CHANNELS.WEBHOOKS, () => void this.dispatch());
    this.timer = setInterval(() => void this.dispatch(), SWEEP_MS);
    this.timer.unref?.();
    void this.dispatch();
  }

  private async dispatch(): Promise<void> {
    if (!this.running || this.dispatching) return;
    this.dispatching = true;
    try {
      await prisma.webhookEventOutbox.updateMany({
        where: { status: 'processing', leaseUntil: { lte: new Date() } },
        data: {
          status: 'pending',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
          availableAt: new Date(),
          lastError: 'Lease expirado; evento retomado por outro ciclo.',
        },
      });

      const candidates = await prisma.$queryRaw<Candidate[]>`
        WITH first_pending AS (
          SELECT DISTINCT ON ("accountId") "id", "accountId", "availableAt"
          FROM "WebhookEventOutbox"
          WHERE "status" = 'pending'
          ORDER BY "accountId", "sequence"
        )
        SELECT "id", "accountId"
        FROM first_pending
        WHERE "availableAt" <= CURRENT_TIMESTAMP
        LIMIT 25
      `;
      this.lastSweepAt = new Date();

      await Promise.all(candidates.map((candidate) => this.run(candidate)));
    } catch (error) {
      console.warn('[webhooks] Falha ao consultar eventos-fonte:', error);
    } finally {
      this.dispatching = false;
    }
  }

  private async claim(candidate: Candidate) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'webhook-source:' + candidate.accountId}))`;
      const now = new Date();
      const row = await tx.webhookEventOutbox.findFirst({
        where: { id: candidate.id, status: 'pending', availableAt: { lte: now } },
      });
      if (!row) return null;

      const [active, older] = await Promise.all([
        tx.webhookEventOutbox.findFirst({
          where: {
            accountId: row.accountId,
            status: 'processing',
            leaseUntil: { gt: now },
          },
          select: { id: true },
        }),
        tx.webhookEventOutbox.findFirst({
          where: {
            accountId: row.accountId,
            status: 'pending',
            sequence: { lt: row.sequence },
          },
          select: { id: true },
        }),
      ]);
      if (active || older) return null;

      const { count } = await tx.webhookEventOutbox.updateMany({
        where: { id: row.id, status: 'pending' },
        data: {
          status: 'processing',
          workerId: this.workerId,
          claimedAt: now,
          leaseUntil: new Date(now.getTime() + LEASE_MS),
          lastError: null,
        },
      });
      return count === 1 ? row : null;
    });
  }

  private async run(candidate: Candidate): Promise<void> {
    const row = await this.claim(candidate);
    if (!row) return;
    try {
      const payload = readJson<WebhookPayloadEmMontagem>(row.payload, null as never);
      if (!payload?.solint?.contaId) throw new Error('Evento-fonte sem referências do CRM.');
      await dispararWebhooks(row.event as WebhookEvent, payload, { throwOnError: true });
      await prisma.webhookEventOutbox.updateMany({
        where: { id: row.id, status: 'processing', workerId: this.workerId },
        data: { status: 'completed', leaseUntil: null, lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(5_000 * 2 ** row.attempts, 15 * 60_000);
      await prisma.webhookEventOutbox.updateMany({
        where: { id: row.id, status: 'processing', workerId: this.workerId },
        data: {
          status: failed ? 'failed' : 'pending',
          attempts,
          availableAt: new Date(Date.now() + backoffMs),
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
          lastError: message,
        },
      });
    } finally {
      if (this.running) void this.dispatch();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    while (this.dispatching) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
