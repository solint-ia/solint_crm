import { CHANNELS, postgresPubSub } from '../db/postgres-pubsub';
import { prisma } from '../db/prisma';
import type {
  DispatchContext,
  DispatchMedia,
  DispatchQuote,
  DispatchResult,
  DispatchTarget,
  WhatsAppChannel,
} from './channel';
import type { WhatsAppOwner, WhatsAppStatusPayload } from './whatsapp-events';
import { waitForWorker, workerPresence } from './worker-presence';

/**
 * Trava viva no banco: prova de que existe um worker operando aquela caixa.
 *
 * O worker a renova a cada 15s enquanto a sessão está de pé, e ela vale 30s.
 * Diferente da batida, este sinal não depende de o processo que pergunta ter
 * escutado coisa alguma — está gravado, e qualquer um consegue lê-lo.
 */
const travaViva = (
  conn: { lockOwner: string | null; lockExpiresAt: Date | null } | null,
): boolean => Boolean(conn?.lockOwner && conn.lockExpiresAt && conn.lockExpiresAt > new Date());

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
    // **Esperado**, e não disparado ao vento.
    //
    // Era `void`, com o argumento de que a varredura pegaria o comando de todo
    // jeito. Pega — 15 segundos depois. Numa função serverless a promessa solta
    // frequentemente não chega a terminar: ao responder a requisição a instância
    // congela, e um `publish` que ainda precisava abrir conexão morre com ela.
    // É por isso que a **primeira** mensagem de uma conversa demorava ~18s e as
    // seguintes ~1,5s: na primeira o lambda está frio e a conexão do publicador
    // ainda não existe; nas seguintes ela já está no pool e o aviso sai a tempo.
    //
    // Esperar custa uma ida ao banco. Não esperar custava a varredura inteira.
    await postgresPubSub.publish(CHANNELS.COMMANDS, { inboxId, kind, id: command.id });
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

    // A ordem importa, e é a mesma de `workerOnline`: a trava já está em `conn`,
    // que acabou de ser lido, então conferi-la é de graça. Esperar 1,5s por uma
    // batida antes disso era pagar essa espera em toda requisição de instância
    // fria — que numa função serverless é boa parte delas.
    const isOnline = presence.online || travaViva(conn) || (await waitForWorker(1500));

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

  /**
   * O worker está no ar?
   *
   * Três sinais, e são precisos os três porque nenhum sozinho responde em todo
   * ambiente.
   *
   * A **batida** é instantânea, mas mora na memória *deste* processo: só existe
   * se ele tiver uma inscrição `LISTEN` aberta e tiver ficado acordado para
   * receber a notificação. Numa função serverless nenhuma das duas coisas é
   * garantida — a instância pode ser nova, ou pode ter ficado congelada entre
   * duas requisições por mais que os 15s da janela de validade. Era isso que
   * fazia o envio recusar com "o worker não está em execução" enquanto o worker
   * estava no ar e conectado: `getStatus` e `startSession` já tinham reforço,
   * o envio não tinha nenhum.
   *
   * A **trava no banco** custa uma consulta por chave primária e não depende de
   * escuta nenhuma, então vem antes da espera.
   *
   * A **espera pela batida** fica por último porque é a única que custa tempo
   * de parede — e ela ainda cobre o caso de o worker estar vivo sem sessão
   * aberta para esta caixa, quando não há trava para encontrar.
   */
  private async workerOnline(inboxId: string): Promise<boolean> {
    if (workerPresence().online) return true;

    const conn = await prisma.whatsAppConnection.findUnique({
      where: { inboxId },
      select: { lockOwner: true, lockExpiresAt: true },
    });
    if (travaViva(conn)) return true;

    return waitForWorker(1500);
  }

  private async dispatch(
    context: DispatchContext,
    kind: 'send' | 'send_media' | 'delete' | 'react',
    body: object,
  ): Promise<DispatchResult> {
    // A caixa vem da conversa, não de `inboxOf`: aquele método escolhe pela
    // conta e prefere a caixa pareada, o que fazia o envio de uma conversa
    // movida para uma caixa sem sessão sair pelo número de outra.
    const inboxId = context.inboxId;
    if (!inboxId) return { ok: false, error: 'Conversa sem caixa de entrada definida.' };
    if (!(await this.workerOnline(inboxId))) {
      return { ok: false, error: 'O worker de WhatsApp não está em execução.' };
    }

    try {
      await this.enqueue(inboxId, kind, {
        ...body,
        accountId: context.accountId,
        conversationId: context.conversationId,
        // Exclusão e reação não carregam `messageId`: quando um comando falha, o
        // worker usa esse campo para marcar a bolha como não entregue — e uma
        // exclusão (ou uma reação) recusada carimbaria "falha" numa mensagem que
        // foi entregue com sucesso, dizendo o contrário da verdade sobre ela.
        ...(kind === 'delete' || kind === 'react' ? {} : { messageId: context.messageId }),
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
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    return this.dispatch(context, 'send', {
      recipient: target,
      content: { text },
      ...(quote ? { quote } : {}),
    });
  }

  async deleteMessage(
    context: DispatchContext,
    target: DispatchTarget,
    externalId: string,
  ): Promise<DispatchResult> {
    // Raia de envio de propósito: apagar é uma escrita no mesmo chat, e a ordem
    // entre "mandei" e "apaguei" é a única coisa que não pode se inverter.
    return this.dispatch(context, 'delete', { recipient: target, externalId });
  }

  async sendReaction(
    context: DispatchContext,
    target: DispatchTarget,
    message: { readonly externalId: string; readonly fromMe: boolean; readonly participant?: string },
    emoji: string,
  ): Promise<DispatchResult> {
    // Raia de envio: reagir é uma escrita no mesmo chat, e sair antes da
    // mensagem que ela comenta seria uma reação a nada.
    return this.dispatch(context, 'react', { recipient: target, message, emoji });
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
    if (!inboxId || !(await this.workerOnline(inboxId))) return;
    await this.enqueue(inboxId, 'read', { conversationId });
  }

  async sendPresence(
    context: { accountId: string; inboxId: string; conversationId: string },
    target: DispatchTarget,
    status: 'composing' | 'paused' | 'recording',
  ): Promise<void> {
    if (!context.inboxId || !(await this.workerOnline(context.inboxId))) return;
    await this.enqueue(context.inboxId, 'presence', {
      recipient: target,
      status,
      conversationId: context.conversationId,
    });
  }
}
