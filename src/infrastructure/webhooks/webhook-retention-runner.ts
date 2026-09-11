import { randomUUID } from 'node:crypto';

import { prisma } from '@/infrastructure/db/prisma';
import {
  acquireBackgroundLease,
  releaseBackgroundLease,
} from '@/infrastructure/scheduling/background-lease';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Quanto cada linha encerrada fica guardada.
 *
 * O evento-fonte já cumpriu o papel quando virou entregas; sobra um dia para
 * diagnóstico. A entrega concluída interessa por pouco tempo, e a que desistiu
 * um pouco mais, porque é ela que alguém vai procurar ao investigar uma falha.
 * Nenhuma tela lê linhas encerradas: a de integrações só conta as pendentes.
 */
const OUTBOX_CONCLUIDO_DIAS = 1;
const OUTBOX_FALHO_DIAS = 7;
const ENTREGA_ENCERRADA_DIAS = 3;
const ENTREGA_FALHA_DIAS = 14;

/**
 * Apaga em lotes, e não num `DELETE` só.
 *
 * Na primeira execução as tabelas podem ter meses acumulados, com a mídia em
 * base64 dentro de cada linha. Um comando único seguraria as linhas e o WAL de
 * uma vez; lotes pequenos deixam a entrada de mensagens seguir enquanto isso.
 * O teto por rodada devolve o processo ao resto do worker; o que sobrar sai na
 * rodada seguinte.
 */
const LOTE = 500;
const LOTES_POR_RODADA = 200;

const apagarEmLotes = async (apagarLote: () => Promise<number>): Promise<number> => {
  let total = 0;
  for (let i = 0; i < LOTES_POR_RODADA; i += 1) {
    const apagadas = await apagarLote();
    total += apagadas;
    if (apagadas < LOTE) break;
  }
  return total;
};

const antes = (dias: number): Date => new Date(Date.now() - dias * DAY_MS);

/**
 * Retenção das duas filas de webhook.
 *
 * Elas só cresciam: cada mensagem com assinante deixava um evento-fonte e uma
 * entrega por destino, as duas com o corpo inteiro — base64 da mídia incluso —,
 * marcadas como concluídas e nunca apagadas. Num servidor com disco próprio isso
 * termina com o Postgres sem espaço para gravar, e aí para tudo, não só o
 * webhook.
 */
export class WebhookRetentionRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly owner: string;

  constructor(owner = `webhook-retention-${randomUUID()}`) {
    this.owner = owner;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), HOUR_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deadline = Date.now() + 10_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const lease = await acquireBackgroundLease('webhook-retention', this.owner, 30 * 60_000).catch(
      () => null,
    );
    if (!lease) {
      this.running = false;
      return;
    }
    try {
      // tenant-ok: retenção é manutenção global de infraestrutura.
      const fontes = await apagarEmLotes(
        () => prisma.$executeRaw`
          DELETE FROM "WebhookEventOutbox" WHERE "id" IN (
            SELECT "id" FROM "WebhookEventOutbox"
            WHERE ("status" = 'completed' AND "createdAt" < ${antes(OUTBOX_CONCLUIDO_DIAS)})
               OR ("status" = 'failed' AND "createdAt" < ${antes(OUTBOX_FALHO_DIAS)})
            LIMIT ${LOTE}
          )
        `,
      );
      // tenant-ok: retenção é manutenção global de infraestrutura.
      const entregas = await apagarEmLotes(
        () => prisma.$executeRaw`
          DELETE FROM "WebhookDelivery" WHERE "id" IN (
            SELECT "id" FROM "WebhookDelivery"
            WHERE ("status" IN ('delivered', 'canceled') AND "createdAt" < ${antes(ENTREGA_ENCERRADA_DIAS)})
               OR ("status" = 'failed' AND "createdAt" < ${antes(ENTREGA_FALHA_DIAS)})
            LIMIT ${LOTE}
          )
        `,
      );
      if (fontes + entregas > 0) {
        console.log(
          `[webhooks] Retenção: ${fontes} evento(s)-fonte e ${entregas} entrega(s) antigos removidos.`,
        );
      }
    } catch (error) {
      console.warn('[webhooks] Falha ao remover linhas antigas das filas:', error);
    } finally {
      await releaseBackgroundLease(lease).catch(() => undefined);
      this.running = false;
    }
  }
}
