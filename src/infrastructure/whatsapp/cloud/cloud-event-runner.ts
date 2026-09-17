import { randomUUID } from 'node:crypto';

import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { prisma } from '@/infrastructure/db/prisma';
import { CloudEventRetry, processCloudEvent } from './cloud-event-processor';

const SWEEP_MS = 3_000;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 6;
const BATCH = 20;
/** Eventos concluídos ficam 30 dias para diagnóstico e depois saem. */
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const RETENTION_EVERY_MS = 60 * 60_000;

interface Candidate {
  readonly id: string;
}

/**
 * Processa os eventos que a rota do webhook da Meta gravou.
 *
 * Mesmo desenho do entregador de webhooks: reivindica com prazo (lease),
 * devolve à fila com espera quando dá para tentar de novo e desiste com motivo
 * registrado quando não dá. Roda no worker (`WA_ENGINE=worker`) ou no processo
 * do site (`inprocess`), nunca nos dois — quem liga é quem tem relógio.
 *
 * **Ordem por contato.** Dois eventos com a mesma `orderKey` (duas mensagens do
 * mesmo cliente) não rodam juntos, e o mais novo espera o mais antigo. Sem
 * isso, uma foto que demora a baixar faria a frase seguinte aparecer antes dela.
 */
export class CloudEventRunner {
  private readonly workerId: string;
  private running = false;
  private sweeping = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastSweepAt: Date | null = null;
  private lastRetentionAt = 0;

  constructor(workerId = `cloud-events-${randomUUID()}`) {
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
    this.unsubscribe = postgresPubSub.subscribe(CHANNELS.WHATSAPP_CLOUD, () => void this.sweep());
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
    void this.sweep();
  }

  private async sweep(): Promise<void> {
    if (!this.running || this.sweeping) return;
    this.sweeping = true;
    try {
      await prisma.whatsAppCloudEvent.updateMany({
        where: { status: 'processing', leaseUntil: { lte: new Date() } },
        data: {
          status: 'pending',
          workerId: null,
          leaseUntil: null,
          error: 'Lease expirado; evento retomado.',
        },
      });

      const candidatos = await prisma.$queryRaw<Candidate[]>`
        WITH primeiros AS (
          SELECT DISTINCT ON (COALESCE("orderKey", "id")) "id", "availableAt", "receivedAt"
          FROM "WhatsAppCloudEvent"
          WHERE "status" IN ('pending', 'processing')
          ORDER BY COALESCE("orderKey", "id"), "receivedAt", "id"
        )
        SELECT p."id"
        FROM primeiros p
        JOIN "WhatsAppCloudEvent" e ON e."id" = p."id"
        WHERE e."status" = 'pending' AND e."availableAt" <= CURRENT_TIMESTAMP
        ORDER BY p."receivedAt"
        LIMIT ${BATCH}
      `;
      this.lastSweepAt = new Date();

      await Promise.all(candidatos.map((candidato) => this.run(candidato.id)));
      await this.retencao();
    } catch (error) {
      console.warn('[cloud] Falha ao varrer eventos da API oficial:', error);
    } finally {
      this.sweeping = false;
    }
  }

  private async run(id: string): Promise<void> {
    const agora = new Date();
    const { count } = await prisma.whatsAppCloudEvent.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'processing',
        workerId: this.workerId,
        leaseUntil: new Date(agora.getTime() + LEASE_MS),
      },
    });
    if (count !== 1) return;

    const row = await prisma.whatsAppCloudEvent.findUnique({
      where: { id },
      select: {
        id: true,
        accountId: true,
        inboxId: true,
        kind: true,
        payload: true,
        attempts: true,
      },
    });
    if (!row) return;

    try {
      const resultado = await processCloudEvent(row);
      await prisma.whatsAppCloudEvent.updateMany({
        where: { id, workerId: this.workerId },
        data: {
          status: resultado,
          processedAt: new Date(),
          leaseUntil: null,
          workerId: null,
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      const attempts = row.attempts + 1;
      const desiste = attempts >= MAX_ATTEMPTS;
      const espera = Math.min(5_000 * 2 ** row.attempts, 10 * 60_000);
      if (!(error instanceof CloudEventRetry)) {
        console.warn(`[cloud] Evento ${id} (${row.kind}) falhou:`, error);
      }
      await prisma.whatsAppCloudEvent.updateMany({
        where: { id, workerId: this.workerId },
        data: {
          status: desiste ? 'failed' : 'pending',
          attempts,
          availableAt: new Date(Date.now() + espera),
          leaseUntil: null,
          workerId: null,
          error: message.slice(0, 1000),
          ...(desiste ? { processedAt: new Date() } : {}),
        },
      });
    }
  }

  private async retencao(): Promise<void> {
    if (Date.now() - this.lastRetentionAt < RETENTION_EVERY_MS) return;
    this.lastRetentionAt = Date.now();
    await prisma.whatsAppCloudEvent
      .deleteMany({
        where: {
          status: { in: ['done', 'ignored', 'failed'] },
          processedAt: { lt: new Date(Date.now() - RETENTION_MS) },
        },
      })
      .catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    while (this.sweeping) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
