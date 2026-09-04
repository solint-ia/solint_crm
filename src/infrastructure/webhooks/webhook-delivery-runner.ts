import { randomUUID } from 'node:crypto';

import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { prisma, readJson } from '@/infrastructure/db/prisma';
import { entregarWebhook, type WebhookEvent, type WebhookPayload } from './webhook-dispatch';

const SWEEP_MS = 5_000;
const LEASE_MS = 30_000;
const RENEW_MS = 10_000;
const MAX_ATTEMPTS = 8;

interface Candidate {
  readonly id: string;
  readonly webhookId: string;
}

interface ClaimedDelivery {
  readonly id: string;
  readonly webhookId: string;
  readonly accountId: string;
  readonly inboxId: string | null;
  readonly event: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly webhook: {
    readonly id: string;
    readonly url: string;
    readonly secret: string | null;
    readonly isActive: boolean;
    readonly allInboxes: boolean;
    readonly inboxes: readonly { readonly inboxId: string }[];
  };
}

/** Entrega o outbox de webhooks sem bloquear a entrada do WhatsApp. */
export class WebhookDeliveryRunner {
  private readonly workerId: string;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly lanes = new Map<string, Promise<void>>();
  private dispatching = false;
  private lastSweepAt: Date | null = null;

  constructor(workerId = `webhook-${randomUUID()}`) {
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
      await prisma.webhookDelivery.updateMany({
        where: { status: 'processing', leaseUntil: { lte: new Date() } },
        data: {
          status: 'pending',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
          availableAt: new Date(),
          lastError: 'Lease expirado; entrega retomada por outro ciclo.',
        },
      });

      const candidates = await prisma.$queryRaw<Candidate[]>`
        SELECT DISTINCT ON ("webhookId") "id", "webhookId"
        FROM "WebhookDelivery"
        WHERE "status" = 'pending' AND "availableAt" <= CURRENT_TIMESTAMP
        ORDER BY "webhookId", "sequence"
        LIMIT 25
      `;
      this.lastSweepAt = new Date();

      for (const candidate of candidates) {
        if (this.lanes.has(candidate.webhookId)) continue;
        const task = this.run(candidate)
          .catch((error: unknown) => {
            console.warn('[webhooks] Falha inesperada no entregador:', error);
          })
          .finally(() => {
            if (this.lanes.get(candidate.webhookId) === task) {
              this.lanes.delete(candidate.webhookId);
            }
            if (this.running) void this.dispatch();
          });
        this.lanes.set(candidate.webhookId, task);
      }
    } catch (error) {
      console.warn('[webhooks] Falha ao consultar o outbox:', error);
    } finally {
      this.dispatching = false;
    }
  }

  private async claim(candidate: Candidate): Promise<ClaimedDelivery | null> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'webhook:' + candidate.webhookId}))`;
      const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS "now"`;
      const now = clock[0]?.now;
      if (!now) return null;

      const row = await tx.webhookDelivery.findFirst({
        where: { id: candidate.id, status: 'pending', availableAt: { lte: now } },
        include: {
          webhook: {
            select: {
              id: true,
              url: true,
              secret: true,
              isActive: true,
              allInboxes: true,
              inboxes: { select: { inboxId: true } },
            },
          },
        },
      });
      if (!row) return null;

      const scopeAllows =
        row.webhook.isActive &&
        (row.webhook.allInboxes ||
          (row.inboxId !== null &&
            row.webhook.inboxes.some((link) => link.inboxId === row.inboxId)));
      if (!scopeAllows) {
        await tx.webhookDelivery.updateMany({
          where: { id: row.id, status: 'pending' },
          data: {
            status: 'canceled',
            lastError: 'Entrega cancelada porque a caixa não está autorizada pelo webhook.',
          },
        });
        return null;
      }

      const [active, older] = await Promise.all([
        tx.webhookDelivery.findFirst({
          where: {
            webhookId: row.webhookId,
            status: 'processing',
            leaseUntil: { gt: now },
          },
          select: { id: true },
        }),
        tx.webhookDelivery.findFirst({
          where: {
            webhookId: row.webhookId,
            status: 'pending',
            availableAt: { lte: now },
            sequence: { lt: row.sequence },
          },
          select: { id: true },
        }),
      ]);
      if (active || older) return null;

      const { count } = await tx.webhookDelivery.updateMany({
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

    const renew = setInterval(() => {
      void prisma.$executeRaw`
        UPDATE "WebhookDelivery"
        SET "leaseUntil" = CURRENT_TIMESTAMP + INTERVAL '30 seconds'
        WHERE "id" = ${row.id} AND "status" = 'processing' AND "workerId" = ${this.workerId}
      `.catch((error: unknown) => console.warn('[webhooks] Falha ao renovar lease:', error));
    }, RENEW_MS);
    renew.unref?.();

    try {
      const payload = readJson<WebhookPayload | null>(row.payload as never, null);
      if (!payload) throw new Error('Payload persistido inválido.');

      // A configuração pode mudar depois do claim. Esta segunda leitura reduz a
      // janela em que uma entrega já reclamada escaparia após o administrador
      // remover a caixa ou desativar o webhook.
      const stillAllowed = await prisma.webhook.findFirst({
        where: {
          id: row.webhookId,
          accountId: row.accountId,
          isActive: true,
          OR: [
            { allInboxes: true },
            ...(row.inboxId
              ? [
                  {
                    allInboxes: false,
                    inboxes: {
                      some: { inboxId: row.inboxId, inbox: { accountId: row.accountId } },
                    },
                  },
                ]
              : []),
          ],
        },
        select: { id: true },
      });
      if (!stillAllowed) {
        await prisma.webhookDelivery.updateMany({
          where: { id: row.id, status: 'processing', workerId: this.workerId },
          data: {
            status: 'canceled',
            workerId: null,
            claimedAt: null,
            leaseUntil: null,
            lastError: 'Entrega cancelada porque o escopo do webhook foi alterado.',
          },
        });
        return;
      }
      await entregarWebhook(row.webhook, JSON.stringify(payload), row.event as WebhookEvent);

      await prisma.$transaction([
        prisma.webhookDelivery.updateMany({
          where: { id: row.id, status: 'processing', workerId: this.workerId },
          data: {
            status: 'delivered',
            deliveredAt: new Date(),
            leaseUntil: null,
            lastError: null,
          },
        }),
        prisma.webhook.update({
          where: { id: row.webhookId },
          data: { lastTriggeredAt: new Date(), failureCount: 0 },
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(5_000 * 2 ** row.attempts, 15 * 60_000);
      console.warn(
        `[webhooks] ${row.webhook.url} não recebeu ${row.event}; ` +
          `${failed ? 'entrega encerrada' : `nova tentativa em ${Math.round(backoffMs / 1000)}s`}: ${message}`,
      );
      await prisma
        .$transaction([
          prisma.webhookDelivery.updateMany({
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
          }),
          prisma.webhook.update({
            where: { id: row.webhookId },
            data: { failureCount: { increment: 1 } },
          }),
        ])
        .catch((persistError: unknown) => {
          console.warn('[webhooks] Falha ao persistir erro da entrega:', persistError);
        });
    } finally {
      clearInterval(renew);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.race([
      Promise.allSettled([...this.lanes.values()]),
      new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
    ]);
  }
}
