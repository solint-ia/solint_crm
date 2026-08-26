import { CHANNELS, postgresPubSub } from '../db/postgres-pubsub';
import { prisma } from '../db/prisma';
import type {
  DispatchContext,
  DispatchMedia,
  DispatchResult,
  DispatchTarget,
  WhatsAppChannel,
} from './channel';
import type { WhatsAppOwner, WhatsAppStatusPayload } from './whatsapp-events';
import { waitForWorker, workerPresence } from './worker-presence';

/**
 * Motor worker: a aplicação enfileira intenções e um processo separado executa.
 *
 * O que muda para quem chama é uma coisa só: o envio devolve `queued` em vez do
 * id da mensagem no canal, porque no instante da resposta ela ainda não foi
 * enviada. Quem carimba o id — e emite o recibo que troca "enviando" por
 * "enviado" na tela — é o worker, ao concluir o comando.
 *
 * Cada comando enfileirado é seguido de um aviso por `NOTIFY`. Sem ele o worker
 * só descobriria o comando na próxima varredura, e uma mensagem enviada podia
 * ficar parada por um segundo inteiro sem motivo nenhum.
 */
export class QueueWhatsAppChannel implements WhatsAppChannel {
  readonly engine = 'worker' as const;

  /**
   * Caixa de WhatsApp da conta. Sem ela não há a quem endereçar o comando.
   *
   * A escolha precisa ser **determinística e informada**, não a primeira que o
   * banco devolver. Era um `findFirst` sem ordenação, e uma conta com mais de
   * uma caixa de WhatsApp — que é o caso de `acc-solint`, com três — podia
   * receber ora uma, ora outra. Quando saía a caixa não pareada, `getStatus`
   * respondia `aguardando_leitura` e a Server Action recusava um envio que a
   * caixa conectada teria feito sem problema.
   *
   * A ordem de preferência é a que corresponde à intenção: a caixa que tem
   * sessão pareada, depois a que ao menos tem linha de conexão, e o `id` como
   * desempate — arbitrário, mas estável entre chamadas.
   */
  private async inboxOf(accountId: string): Promise<string | null> {
    const inboxes = await prisma.inbox.findMany({
      where: { accountId, channel: 'whatsapp' },
      select: { id: true, waConnection: { select: { credsCipher: true, status: true } } },
      orderBy: { id: 'asc' },
    });
    if (inboxes.length === 0) return null;

    const pareada = inboxes.find((inbox) => inbox.waConnection?.credsCipher);
    const comConexao = inboxes.find((inbox) => inbox.waConnection);
    return (pareada ?? comConexao ?? inboxes[0])?.id ?? null;
  }

  private async enqueue(inboxId: string, kind: string, payload: object): Promise<string> {
    const command = await prisma.whatsAppCommand.create({
      data: { inboxId, kind, payload: payload as never, status: 'pending' },
    });
    // Fora do await de propósito: o comando já está gravado e é a fila que manda.
    // O aviso é só para o worker não esperar a varredura — se ele se perder, a
    // varredura pega o comando do mesmo jeito.
    void postgresPubSub.publish(CHANNELS.COMMANDS, { inboxId, kind, id: command.id });
    return command.id;
  }

  async getStatus(accountId: string, scopedInboxId?: string): Promise<WhatsAppStatusPayload> {
    // Caixa pedida explicitamente não passa por `inboxOf`: o ponto de perguntar
    // pela caixa da conversa é justamente não aceitar outra no lugar dela.
    const inboxId = scopedInboxId ?? (await this.inboxOf(accountId));
    const conn = inboxId
      ? await prisma.whatsAppConnection.findUnique({ where: { inboxId } })
      : null;

    const presence = workerPresence();
    const updatedAt = conn?.updatedAt.toISOString() ?? new Date().toISOString();

    let isOnline = presence.online;
    if (!isOnline) {
      // Se acabou de carregar a aplicação, dá uma janela rápida de até 1.5s pelo heartbeat
      isOnline = await waitForWorker(1500);
    }


    // Se o worker possuir trava ativa no banco, também é considerado ativo
    if (!isOnline && conn?.lockOwner && conn.lockExpiresAt && conn.lockExpiresAt > new Date()) {
      isOnline = true;
    }

    // Worker comprovadamente ausente é reportado como desconexão
    if (!isOnline) {
      return {
        ...(inboxId ? { inboxId } : {}),
        status: 'desconectado',
        error: 'O worker de WhatsApp não está em execução. Inicie com `npm run worker`.',
        updatedAt,
      };
    }


    return {
      ...(inboxId ? { inboxId } : {}),
      status: (conn?.status as WhatsAppStatusPayload['status']) ?? 'desconectado',
      qr: conn?.qrPayload ?? undefined,
      error: conn?.lastError ?? undefined,
      phone: conn?.phoneJid ?? undefined,
      name: conn?.profileName ?? undefined,
      owner: conn?.pairedByUserId
        ? { userId: conn.pairedByUserId, userName: conn.profileName ?? 'WhatsApp', accountId }
        : undefined,
      updatedAt,
    };
  }

  async startSession(owner: WhatsAppOwner): Promise<WhatsAppStatusPayload> {
    const inboxId = await this.inboxOf(owner.accountId);
    if (!inboxId) {
      throw new Error('Esta conta não tem caixa de entrada de WhatsApp configurada.');
    }

    // Recusar cedo é melhor do que enfileirar no vazio: sem worker, o comando
    // ficaria pendente e a tela esperaria por algo que nunca vem.
    if (!(await waitForWorker())) {
      throw new Error(
        'O worker de WhatsApp não está em execução. Inicie com `npm run worker` e tente de novo.',
      );
    }

    await prisma.whatsAppConnection.upsert({
      where: { inboxId },
      create: { inboxId, status: 'conectando', pairedByUserId: owner.userId },
      update: { status: 'conectando', pairedByUserId: owner.userId, lastError: null },
    });

    await this.enqueue(inboxId, 'connect', { ...owner });

    return { inboxId, status: 'conectando', owner, updatedAt: new Date().toISOString() };
  }

  async disconnect(accountId: string): Promise<void> {
    const inboxId = await this.inboxOf(accountId);
    if (!inboxId) return;
    await this.enqueue(inboxId, 'disconnect', {});
  }

  private async dispatch(
    context: DispatchContext,
    kind: 'send' | 'send_media',
    body: object,
  ): Promise<DispatchResult> {
    // A caixa vem da conversa, não de `inboxOf`: aquele método escolhe pela
    // conta e prefere a caixa pareada, o que fazia o envio de uma conversa
    // movida para uma caixa sem sessão sair pelo número de outra.
    const inboxId = context.inboxId;
    if (!inboxId) return { ok: false, error: 'Conversa sem caixa de entrada definida.' };
    if (!workerPresence().online) {
      return { ok: false, error: 'O worker de WhatsApp não está em execução.' };
    }

    try {
      await this.enqueue(inboxId, kind, {
        ...body,
        accountId: context.accountId,
        conversationId: context.conversationId,
        messageId: context.messageId,
      });
      return { ok: true, queued: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao enfileirar o envio.',
      };
    }
  }

  async sendText(
    context: DispatchContext,
    target: DispatchTarget,
    text: string,
  ): Promise<DispatchResult> {
    return this.dispatch(context, 'send', { recipient: target, content: { text } });
  }

  async sendMedia(
    context: DispatchContext,
    target: DispatchTarget,
    media: DispatchMedia,
  ): Promise<DispatchResult> {
    // Só o identificador do anexo viaja na fila. Os bytes ficam no depósito: um
    // vídeo em base64 dentro de uma coluna JSON incharia a fila sem necessidade.
    return this.dispatch(context, 'send_media', { recipient: target, media });
  }

  async markRead(accountId: string, conversationId: string, scopedInboxId?: string): Promise<void> {
    const inboxId = scopedInboxId ?? (await this.inboxOf(accountId));
    if (!inboxId || !workerPresence().online) return;
    await this.enqueue(inboxId, 'read', { conversationId });
  }
}
