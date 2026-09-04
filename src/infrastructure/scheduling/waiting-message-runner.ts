import { randomUUID } from 'node:crypto';

import { prisma } from '@/infrastructure/db/prisma';
import { runWaitingAutoReply } from '@/infrastructure/whatsapp/inbox-auto-messages';
import {
  acquireBackgroundLease,
  releaseBackgroundLease,
  renewBackgroundLease,
  type BackgroundLeaseHandle,
} from './background-lease';

/**
 * O relógio da mensagem de espera.
 *
 * Das quatro mensagens automáticas da caixa, esta era a única sem nenhum código
 * por trás: o cartão existia na tela de Configurações, o texto era gravado no
 * banco, o botão de ativar funcionava — e nada no sistema jamais lia aquela
 * coluna. Ligar a opção não fazia absolutamente nada.
 *
 * Ela não podia ser disparada no caminho da mensagem recebida como a saudação e
 * a ausência, e é por isso que ela ficou de fora: a condição dela não acontece
 * *quando* a mensagem chega, acontece *pela ausência de resposta depois*. Só um
 * varredor consegue observar isso — a mesma razão de existir do varredor de
 * agendamentos, e o mesmo desenho (ver `scheduled-runner`).
 */

/** Intervalo do varredor. Abaixo da menor espera configurável, que é 1 minuto. */
const POLL_MS = 30_000;

/** Conversas examinadas por rodada. O varredor não pode virar uma varredura. */
const BATCH = 60;

/**
 * Idade máxima de uma conversa parada que ainda interessa.
 *
 * Uma conversa esquecida há três dias não vai receber "você será atendido em
 * breve" — a frase seria uma piada de mau gosto, e o varredor não tem por que
 * arrastar todo o histórico da conta a cada trinta segundos.
 */
const JANELA_MS = 12 * 60 * 60 * 1000;

const jaAtivo = globalThis as typeof globalThis & { __solintWaitingRunner?: true };

export class WaitingMessageRunner {
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  private readonly owner: string;

  constructor(owner = `waiting-${randomUUID()}`) {
    this.owner = owner;
  }

  start(): void {
    if (this.timer || jaAtivo.__solintWaitingRunner) return;
    jaAtivo.__solintWaitingRunner = true;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
    void this.tick();
    console.log('[MensagemDeEspera] Varredor de conversas na fila ativo.');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    delete jaAtivo.__solintWaitingRunner;
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
      lease = await acquireBackgroundLease('waiting-messages', this.owner, 2 * 60_000);
      if (!lease) return;
      const ownedLease = lease;
      renew = setInterval(() => void renewBackgroundLease(ownedLease), 30_000);
      renew.unref?.();
      /**
       * Só as caixas que ligaram a mensagem entram na conta.
       *
       * São poucas linhas e o filtro corta o trabalho pela raiz: numa conta que
       * não usa o recurso, a rodada termina aqui sem tocar em `Conversation`.
       */
      const caixas = await prisma.inbox.findMany({
        where: { waitingMessage: { path: ['enabled'], equals: true } },
        select: { id: true, accountId: true, waitingMessageDelayMinutes: true },
      });
      if (caixas.length === 0) return;

      const menorEspera = Math.max(
        1,
        Math.min(...caixas.map((caixa) => caixa.waitingMessageDelayMinutes || 5)),
      );
      const agora = Date.now();
      const limite = new Date(agora - menorEspera * 60_000);
      const piso = new Date(agora - JANELA_MS);

      const paradas = await prisma.conversation.findMany({
        where: {
          inboxId: { in: caixas.map((caixa) => caixa.id) },
          status: { in: ['aberta', 'espera'] },
          channel: 'whatsapp',
          // O recorte grosso é por atividade: qualquer resposta do atendente
          // renova `lastActivityAt`, então uma conversa fora desta janela ou já
          // foi atendida ou está velha demais para o aviso fazer sentido.
          lastActivityAt: { lte: limite, gte: piso },
        },
        orderBy: { lastActivityAt: 'asc' },
        take: BATCH,
        select: { id: true, accountId: true },
      });

      for (const conversa of paradas) {
        // A decisão fina (última mensagem é do contato, prazo da caixa, dentro
        // do expediente, aviso ainda não enviado) é toda de `runWaitingAutoReply`
        // — este laço só escolhe quem perguntar.
        await runWaitingAutoReply(conversa.accountId, conversa.id).catch((error) => {
          console.warn(`[MensagemDeEspera] Conversa ${conversa.id} falhou:`, error);
        });
      }
    } catch (error) {
      console.warn('[MensagemDeEspera] Falha ao varrer conversas na fila:', error);
    } finally {
      if (renew) clearInterval(renew);
      if (lease) await releaseBackgroundLease(lease).catch(() => undefined);
      this.rodando = false;
    }
  }
}
