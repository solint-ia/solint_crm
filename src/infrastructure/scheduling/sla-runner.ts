import {
  SLA_PRIMEIRA_RESPOSTA_MIN,
  SLA_RESPOSTA_SEGUINTE_MIN,
  estaAcabando,
  slaLabelDe,
} from '@/core/domain/sla';
import { prisma } from '@/infrastructure/db/prisma';
import { createNotification } from '@/infrastructure/notifications/create-notification';
import {
  acquireBackgroundLease,
  releaseBackgroundLease,
  renewBackgroundLease,
  type BackgroundLeaseHandle,
} from './background-lease';

/**
 * O relógio do prazo de resposta.
 *
 * Duas coisas acontecem *pela passagem do tempo*, e nenhuma delas cabe no
 * caminho da mensagem recebida: o aviso de que o prazo está acabando e a marca
 * de que ele estourou. É a mesma razão de existir do varredor da mensagem de
 * espera, e o mesmo desenho.
 *
 * Sem ele, as colunas `slaDeadlineAt`/`slaBreached` seriam escritas na entrada
 * e nunca reavaliadas: o selo vermelho da lista só apareceria se a conversa
 * nascesse estourada, e o filtro "SLA estourado" continuaria devolvendo nada.
 */

/** O prazo é medido em dezenas de minutos; dois de resolução bastam. */
const POLL_MS = 2 * 60_000;

/** Conversas examinadas por rodada. O varredor não pode virar uma varredura. */
const BATCH = 80;

/**
 * Idade máxima de um prazo que ainda interessa.
 *
 * Uma conversa estourada há uma semana já está estourada: reavaliá-la a cada
 * dois minutos não muda nada e arrastaria o histórico da conta inteira.
 */
const JANELA_MS = 48 * 60 * 60 * 1000;

const jaAtivo = globalThis as typeof globalThis & { __solintSlaRunner?: true };

export class SlaRunner {
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  private readonly owner: string;

  constructor(owner = `sla-${randomUUID()}`) {
    this.owner = owner;
  }

  start(): void {
    if (this.timer || jaAtivo.__solintSlaRunner) return;
    jaAtivo.__solintSlaRunner = true;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
    void this.tick();
    console.log('[SLA] Varredor de prazos de resposta ativo.');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    delete jaAtivo.__solintSlaRunner;
    const deadline = Date.now() + 30_000;
    while (this.rodando && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async tick(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    let lease: BackgroundLeaseHandle | null = null;
    let renew: NodeJS.Timeout | null = null;
    try {
      lease = await acquireBackgroundLease('sla', this.owner, 5 * 60_000);
      if (!lease) return;
      const ownedLease = lease;
      renew = setInterval(() => void renewBackgroundLease(ownedLease), 60_000);
      renew.unref?.();
      const agora = new Date();
      const desde = new Date(agora.getTime() - JANELA_MS);

      // tenant-ok: o varredor é do processo, não de uma conta. Ele atravessa
      // todas de propósito e reescopa por `accountId` em cada escrita abaixo —
      // é o mesmo desenho do varredor da mensagem de espera.
      const conversas = await prisma.conversation.findMany({
        where: {
          // Conversa resolvida não tem prazo a cobrar: o atendimento acabou.
          status: { in: ['aberta', 'pendente', 'espera'] },
          slaDeadlineAt: { not: null, gte: desde.toISOString() },
        },
        orderBy: { slaDeadlineAt: 'asc' },
        take: BATCH,
        select: {
          id: true,
          accountId: true,
          inboxId: true,
          assigneeId: true,
          slaDeadlineAt: true,
          slaBreached: true,
          firstResponseAt: true,
          contact: { select: { name: true } },
        },
      });

      for (const conversa of conversas) {
        if (!conversa.slaDeadlineAt) continue;
        const prazo = new Date(conversa.slaDeadlineAt);
        if (Number.isNaN(prazo.getTime())) continue;

        const estourou = prazo.getTime() <= agora.getTime();

        if (estourou) {
          // Já marcada: nada a fazer. É o que impede o varredor de reemitir o
          // mesmo estouro a cada dois minutos pelo resto do dia.
          if (conversa.slaBreached) continue;

          await prisma.conversation.updateMany({
            where: { id: conversa.id, accountId: conversa.accountId, slaBreached: { not: true } },
            data: { slaBreached: true, slaLabel: 'SLA estourado' },
          });

          // O selo vermelho da lista acende sozinho na tela de quem está com
          // ela aberta, sem esperar o próximo carregamento.
          try {
            const { waEventBus } = await import('@/infrastructure/whatsapp/whatsapp-events');
            waEventBus.emitConversation({
              type: 'conversation_updated',
              accountId: conversa.accountId,
              conversationId: conversa.id,
              inboxId: conversa.inboxId,
            });
          } catch (error) {
            console.warn('[SLA] Falha ao anunciar o estouro:', error);
          }
          continue;
        }

        const minutosDoPrazo = conversa.firstResponseAt
          ? SLA_RESPOSTA_SEGUINTE_MIN
          : SLA_PRIMEIRA_RESPOSTA_MIN;
        if (!estaAcabando(prazo, minutosDoPrazo, agora)) continue;

        /**
         * Um aviso por ciclo de prazo, e a trava é a própria tabela de avisos.
         *
         * Não há coluna para "já avisei", e criar uma significaria mais um
         * estado a manter em sincronia. A existência de um aviso de SLA desta
         * conversa criado depois do prazo atual ter sido armado responde a
         * mesma pergunta — é a técnica que `ultimoDisparo` usa para as
         * mensagens automáticas, e sobrevive ao reinício do worker, coisa que
         * uma trava em memória não faz.
         */
        const armadoEm = new Date(prazo.getTime() - minutosDoPrazo * 60_000);
        const jaAvisado = await prisma.notification.findFirst({
          where: {
            accountId: conversa.accountId,
            kind: 'sla',
            href: `/conversas/${conversa.id}`,
            createdAt: { gte: armadoEm },
          },
          select: { id: true },
        });
        if (jaAvisado) continue;

        const restanteMin = Math.max(1, Math.round((prazo.getTime() - agora.getTime()) / 60_000));

        await createNotification({
          accountId: conversa.accountId,
          // Sem responsável o aviso vale para a conta inteira: uma conversa na
          // fila geral é justamente a que mais precisa que alguém seja avisado.
          userId: conversa.assigneeId,
          kind: 'sla',
          text: `O prazo de resposta da conversa com ${conversa.contact?.name ?? 'um contato'} vence em ${restanteMin} min`,
          href: `/conversas/${conversa.id}`,
          conversationId: conversa.id,
          inboxId: conversa.inboxId,
        });

        await prisma.conversation.updateMany({
          where: { id: conversa.id, accountId: conversa.accountId },
          data: { slaLabel: slaLabelDe(prazo, agora) },
        });
      }
    } catch (error) {
      console.error('[SLA] Falha na varredura de prazos:', error);
    } finally {
      if (renew) clearInterval(renew);
      if (lease) await releaseBackgroundLease(lease).catch(() => undefined);
      this.rodando = false;
    }
  }
}
import { randomUUID } from 'node:crypto';
