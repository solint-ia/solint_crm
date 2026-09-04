import { randomUUID } from 'node:crypto';

import { currentProtocol, type Protocol } from '@/core/domain/conversation';
import { previewOfMessage, type Message } from '@/core/domain/message';
import { hasVariables, interpolate } from '@/core/domain/message-variables';
import { asJson, prisma, readJson } from '@/infrastructure/db/prisma';
import { horaLabel } from '@/lib/datetime';
import { waEventBus } from '@/infrastructure/whatsapp/whatsapp-events';

/**
 * O relógio das mensagens agendadas.
 *
 * **Por que um varredor e não um `setTimeout` no momento do agendamento.** Um
 * temporizador vive na memória do processo que o criou: um deploy, um reinício
 * ou um segundo processo e ele desaparece sem deixar rastro — e o agendamento
 * simplesmente nunca dispara, sem erro em lugar nenhum. O que sobrevive a tudo
 * isso é a linha no banco; o varredor só pergunta, de tempos em tempos, o que
 * já venceu.
 *
 * **Por que ele mora aqui e não numa Server Action.** Disparar exige um
 * processo vivo com relógio, e uma função serverless não é isso: ela existe
 * enquanto responde a uma requisição. Quem tem processo vivo neste sistema é
 * quem fala com o WhatsApp — o worker, ou o próprio servidor Next quando o
 * motor é o in-process. Por isso o envio entra por injeção (`entregar`): o
 * runner sabe *quando* e *o quê*, e quem o inicia sabe *por onde*.
 */

/** Intervalo do varredor. */
const POLL_MS = 20_000;

/** Quantos vencidos por rodada. Um lote grande não pode segurar a fila. */
const BATCH = 20;

/**
 * Antiguidade máxima de um agendamento vencido.
 *
 * Uma mensagem que deveria ter saído há seis horas quase nunca é a mensagem que
 * alguém ainda quer mandar — o worker esteve fora, o contexto passou, e
 * entregá-la agora surpreende o cliente mais do que ajuda. Ela é marcada como
 * falha, com o motivo, em vez de sair atrasada.
 */
const MAX_ATRASO_MS = 6 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60_000;
const LEASE_RENEW_MS = 30_000;

export interface ScheduledDelivery {
  (input: {
    readonly accountId: string;
    readonly inboxId: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly recipient: { readonly channelThreadId?: string; readonly phone?: string };
    readonly text: string;
  }): Promise<{
    readonly ok: boolean;
    readonly queued?: boolean;
    readonly externalId?: string;
    readonly error?: string;
  }>;
}

interface Vencida {
  readonly id: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly inboxId: string;
  readonly userName: string;
  readonly text: string;
  readonly isPrivate: boolean;
  readonly replyToId: string | null;
  readonly scheduledFor: Date;
}

/**
 * Um varredor por processo, mesmo com recarga a quente.
 *
 * O `next dev` reavalia os módulos a cada alteração de arquivo. Sem esta marca,
 * cada recarga deixaria mais um varredor de pé — e dois varredores disputando a
 * mesma linha é exatamente o caso que a trava otimista de `tick` existe para
 * cobrir, mas que não há motivo nenhum para provocar.
 */
const jaAtivo = globalThis as typeof globalThis & { __solintScheduledRunner?: true };

export class ScheduledMessageRunner {
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  private readonly workerId: string;
  private activeTick: Promise<void> | null = null;

  constructor(
    private readonly entregar: ScheduledDelivery,
    workerId = `scheduled-${randomUUID()}`,
  ) {
    this.workerId = workerId;
  }

  start(): void {
    if (this.timer || jaAtivo.__solintScheduledRunner) return;
    jaAtivo.__solintScheduledRunner = true;
    this.timer = setInterval(() => this.runTick(), POLL_MS);
    this.timer.unref?.();
    // A primeira rodada sai já: o que venceu enquanto o processo estava fora
    // não tem por que esperar mais vinte segundos.
    this.runTick();
    console.log('[ScheduledMessages] Varredor de mensagens agendadas ativo.');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    delete jaAtivo.__solintScheduledRunner;
    if (this.activeTick) {
      await Promise.race([
        this.activeTick,
        new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
      ]);
    }
  }

  private runTick(): void {
    if (this.activeTick) return;
    const task = this.tick().finally(() => {
      if (this.activeTick === task) this.activeTick = null;
    });
    this.activeTick = task;
  }

  /**
   * Uma rodada. Nunca duas ao mesmo tempo no mesmo processo: uma rodada lenta
   * (um WhatsApp que demora a responder) não pode ser alcançada pela seguinte.
   */
  private async tick(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await prisma.scheduledMessage.updateMany({
        where: { status: 'sending', leaseUntil: { lte: new Date() } },
        data: {
          status: 'pending',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
          error: 'Execução interrompida; agendamento retomado com idempotência.',
        },
      });

      const vencidas = (await prisma.scheduledMessage.findMany({
        where: { status: 'pending', scheduledFor: { lte: new Date() } },
        orderBy: { scheduledFor: 'asc' },
        take: BATCH,
        select: {
          id: true,
          accountId: true,
          conversationId: true,
          inboxId: true,
          userName: true,
          text: true,
          isPrivate: true,
          replyToId: true,
          scheduledFor: true,
        },
      })) as Vencida[];

      for (const linha of vencidas) {
        /**
         * A trava é o próprio `UPDATE` condicional.
         *
         * Dois workers podem ler a mesma linha na mesma rodada; só um consegue
         * mudá-la de `pending`. Quem perde a corrida encontra `count === 0` e
         * segue adiante — sem isso, a mesma mensagem sairia duas vezes para o
         * cliente, que é o único erro aqui que não tem conserto.
         */
        const { count } = await prisma.scheduledMessage.updateMany({
          where: { id: linha.id, status: 'pending' },
          data: {
            status: 'sending',
            workerId: this.workerId,
            claimedAt: new Date(),
            leaseUntil: new Date(Date.now() + LEASE_MS),
            messageId: `msg-scheduled-${linha.id}`,
            error: null,
          },
        });
        if (count === 0) continue;

        try {
          const renew = setInterval(() => {
            void prisma.scheduledMessage.updateMany({
              where: { id: linha.id, status: 'sending', workerId: this.workerId },
              data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
            });
          }, LEASE_RENEW_MS);
          renew.unref?.();
          try {
            await this.enviarUma(linha);
          } finally {
            clearInterval(renew);
          }
        } catch (error) {
          const motivo = error instanceof Error ? error.message : 'Falha ao enviar o agendamento.';
          console.error(`[ScheduledMessages] Agendamento ${linha.id} falhou:`, error);
          await prisma.scheduledMessage
            .updateMany({
              where: { id: linha.id, status: 'sending', workerId: this.workerId },
              data: {
                status: 'failed',
                error: motivo,
                workerId: null,
                claimedAt: null,
                leaseUntil: null,
              },
            })
            .catch(() => undefined);
        }
      }
    } catch (error) {
      console.warn('[ScheduledMessages] Falha ao varrer agendamentos:', error);
    } finally {
      this.rodando = false;
    }
  }

  private async enviarUma(linha: Vencida): Promise<void> {
    if (Date.now() - linha.scheduledFor.getTime() > MAX_ATRASO_MS) {
      await prisma.scheduledMessage.updateMany({
        where: { id: linha.id, status: 'sending', workerId: this.workerId },
        data: {
          status: 'failed',
          error: 'O agendamento venceu há muito tempo e não foi enviado automaticamente.',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
        },
      });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: linha.conversationId, accountId: linha.accountId },
      select: {
        id: true,
        inboxId: true,
        channel: true,
        channelThreadId: true,
        lastMessagePreview: true,
        protocols: true,
        account: { select: { name: true } },
        contact: { select: { phone: true, name: true } },
      },
    });

    if (!conversation) {
      await prisma.scheduledMessage.updateMany({
        where: { id: linha.id, status: 'sending', workerId: this.workerId },
        data: {
          status: 'failed',
          error: 'A conversa não existe mais.',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
        },
      });
      return;
    }

    /**
     * As variáveis são resolvidas **na hora do envio**, não na hora do agendamento.
     *
     * O contato pode ter sido renomeado, e o atendimento pode ter ganhado outro
     * protocolo, entre agendar e sair. Congelar o texto na criação mandaria ao
     * cliente um número de protocolo que já foi fechado.
     */
    const texto = hasVariables(linha.text)
      ? interpolate(linha.text, {
          clienteNome: conversation.contact?.name ?? '',
          agenteNome: linha.userName,
          empresa: conversation.account?.name ?? '',
          protocolo:
            currentProtocol(readJson<readonly Protocol[]>(conversation.protocols, []))?.code ?? '',
        })
      : linha.text;

    const agora = new Date();
    const message: Message = {
      id: `msg-scheduled-${linha.id}`,
      conversationId: conversation.id,
      author: 'agent',
      authorName: linha.userName,
      content: { type: 'text', text: texto },
      time: horaLabel(agora),
      createdAt: agora.toISOString(),
      isPrivate: linha.isPrivate,
      origin: 'crm',
      ...(linha.replyToId ? { replyToId: linha.replyToId } : {}),
      ...(linha.isPrivate ? {} : { deliveryStatus: 'enviando' as const }),
    };

    await prisma.$transaction(async (tx) => {
      const created = await tx.message.createMany({
        data: [
          {
            id: message.id,
            conversationId: conversation.id,
            author: message.author,
            authorName: message.authorName ?? null,
            contentType: message.content.type,
            content: asJson(message.content),
            time: message.time,
            createdAt: agora,
            deliveryStatus: message.deliveryStatus ?? null,
            isPrivate: message.isPrivate,
            replyToId: message.replyToId ?? null,
            origin: message.origin ?? null,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await tx.conversation.update({
          where: { id: conversation.id, accountId: linha.accountId },
          data: {
            lastMessagePreview: message.isPrivate
              ? conversation.lastMessagePreview
              : previewOfMessage(message),
            lastMessageAt: message.time,
            lastActivityAt: agora,
          },
        });
      }
    });

    let entregue: Message = message;
    let erro: string | undefined;
    let queued = false;

    // Nota interna nunca sai para o canal externo — a regra vale igual aqui.
    if (!linha.isPrivate && conversation.channel === 'whatsapp') {
      const resultado = await this.entregar({
        accountId: linha.accountId,
        inboxId: conversation.inboxId,
        conversationId: conversation.id,
        messageId: message.id,
        recipient: {
          ...(conversation.channelThreadId
            ? { channelThreadId: conversation.channelThreadId }
            : {}),
          ...(conversation.contact.phone ? { phone: conversation.contact.phone } : {}),
        },
        text: texto,
      });

      if (!resultado.ok) {
        erro = resultado.error ?? 'O canal recusou o envio.';
        entregue = { ...message, deliveryStatus: 'falha' };
        await prisma.message.update({
          where: { id: message.id },
          data: { deliveryStatus: 'falha', dispatchError: erro },
        });
      } else if (resultado.externalId) {
        entregue = { ...message, externalId: resultado.externalId, deliveryStatus: 'enviado' };
        await prisma.message.update({
          where: { id: message.id },
          data: {
            externalId: resultado.externalId,
            deliveryStatus: 'enviado',
            dispatchError: null,
          },
        });
      } else if (resultado.queued) {
        queued = true;
      }
    }

    await prisma.scheduledMessage.updateMany({
      where: { id: linha.id, status: 'sending', workerId: this.workerId },
      data: {
        status: erro ? 'failed' : queued ? 'queued' : 'sent',
        sentAt: erro || queued ? null : agora,
        messageId: message.id,
        workerId: null,
        claimedAt: null,
        leaseUntil: null,
        error: erro ?? null,
      },
    });

    // A mensagem existe na conversa quer a entrega tenha dado certo ou não — a
    // bolha em "falha" é informação, e escondê-la faria o agendamento sumir sem
    // explicação de quem estava com a tela aberta.
    waEventBus.emitConversation({
      type: 'new_message',
      accountId: linha.accountId,
      conversationId: conversation.id,
      inboxId: conversation.inboxId,
      messageId: entregue.id,
      message: entregue,
    });
  }
}
