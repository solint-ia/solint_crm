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
import { algumaTravaViva, filaParada, waitForWorker, workerPresence } from './worker-presence';

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

  private async enqueue(
    inboxId: string,
    kind: string,
    payload: object,
    options: { idempotencyKey?: string; expiresAt?: Date } = {},
  ): Promise<string> {
    let command: { id: string };
    try {
      command = await prisma.whatsAppCommand.create({
        data: {
          inboxId,
          kind,
          payload: payload as never,
          status: 'pending',
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
          ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
        },
        select: { id: true },
      });
    } catch (error) {
      // A mesma mensagem pode chegar duas vezes por retry HTTP. A chave única
      // transforma a segunda requisição em confirmação da primeira intenção.
      const existing = options.idempotencyKey
        ? await prisma.whatsAppCommand.findUnique({
            where: { idempotencyKey: options.idempotencyKey },
            select: { id: true },
          })
        : null;
      if (!existing) throw error;
      command = existing;
    }
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

    /**
     * Ausência precisa ser **provada**, e antes não era.
     *
     * A conta era `presence.online || travaViva(conn) || waitForWorker(1500)`, e
     * qualquer falso nesses três virava a tela dizendo "O worker de WhatsApp não
     * está em execução". Só que a batida sai a cada 5 s: um processo Next
     * recém-acordado — instância fria, ou a primeira leitura depois de o modal
     * abrir — quase nunca ouve uma dentro de 1,5 s, e a caixa que está
     * justamente esperando o QR não tem trava para exibir. O resultado era o
     * erro aparecendo no clique e o QR chegando logo atrás, desmentindo-o.
     *
     * Agora entram dois sinais gravados, que não dependem de este processo ter
     * escutado coisa alguma: uma trava viva em qualquer caixa prova que existe
     * worker no ar, e um comando desta caixa parado na fila prova que não
     * existe. Sem prova de ausência, o status gravado responde sozinho.
     */
    const isOnline =
      presence.online ||
      travaViva(conn) ||
      (await algumaTravaViva()) ||
      (await waitForWorker(1500));

    if (!isOnline && inboxId && (await filaParada(inboxId))) {
      return {
        inboxId,
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

    const connection = await prisma.whatsAppConnection.findUnique({
      where: { inboxId },
      select: {
        status: true,
        credsCipher: true,
        lockOwner: true,
        lockExpiresAt: true,
        phoneJid: true,
        profileName: true,
      },
    });

    // Um clique em "conectar" não deve reiniciar uma sessão que já está viva.
    // Além de ser desnecessário, reconstruir o socket pode fazer o aparelho
    // interpretar a operação como um novo vínculo do WhatsApp Web.
    if (connection?.credsCipher && connection.status === 'conectado' && travaViva(connection)) {
      return {
        inboxId,
        status: 'conectado',
        phone: connection.phoneJid ?? undefined,
        name: connection.profileName ?? undefined,
        owner,
        updatedAt: new Date().toISOString(),
      };
    }

    // Reaproveita a tentativa já enfileirada em vez de criar vários comandos
    // concorrentes para a mesma credencial/sessão.
    const pendingConnect = await prisma.whatsAppCommand.findFirst({
      where: { inboxId, kind: 'connect', status: { in: ['pending', 'processing'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (pendingConnect) {
      return {
        inboxId,
        status: 'conectando',
        owner,
        updatedAt: new Date().toISOString(),
      };
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

    // Quarto sinal, gravado: a trava de outra caixa também prova que existe
    // worker. Uma conta com duas caixas, uma pareada e outra não, recusava
    // envios pela segunda enquanto a primeira estava viva no mesmo processo.
    if (await algumaTravaViva()) return true;

    if (await waitForWorker(1500)) return true;

    /**
     * Na dúvida, enfileira.
     *
     * Este método guarda o **envio**, não a conexão, e a assimetria importa:
     * recusar um `connect` deixa a pessoa olhando para uma tela que explica o
     * que fazer, enquanto recusar um `send` joga fora a mensagem. Sem prova de
     * ausência — um comando desta caixa parado na fila —, o comando entra: a
     * fila é durável, e o worker a drena quando voltar.
     */
    return !(await filaParada(inboxId));
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
      await this.enqueue(
        inboxId,
        kind,
        {
          ...body,
          accountId: context.accountId,
          conversationId: context.conversationId,
          // Exclusão e reação não carregam `messageId`: quando um comando falha, o
          // worker usa esse campo para marcar a bolha como não entregue — e uma
          // exclusão (ou uma reação) recusada carimbaria "falha" numa mensagem que
          // foi entregue com sucesso, dizendo o contrário da verdade sobre ela.
          ...(kind === 'delete' || kind === 'react' ? {} : { messageId: context.messageId }),
        },
        kind === 'send' || kind === 'send_media'
          ? { idempotencyKey: `message:${context.messageId}` }
          : {},
      );
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
    message: {
      readonly externalId: string;
      readonly fromMe: boolean;
      readonly participant?: string;
    },
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
    quote?: DispatchQuote,
  ): Promise<DispatchResult> {
    // Só o identificador do anexo viaja na fila. Os bytes ficam no depósito: um
    // vídeo em base64 dentro de uma coluna JSON incharia a fila sem necessidade.
    // A citação é leve e viaja junto — ver `DispatchQuote`.
    return this.dispatch(context, 'send_media', {
      recipient: target,
      media,
      ...(quote ? { quote } : {}),
    });
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
  ): Promise<DispatchResult> {
    if (!context.inboxId) {
      return { ok: false, error: 'Conversa sem caixa de entrada definida.' };
    }
    if (!(await this.workerOnline(context.inboxId))) {
      return { ok: false, error: 'O worker de WhatsApp não está em execução.' };
    }

    try {
      await this.enqueue(
        context.inboxId,
        'presence',
        {
          recipient: target,
          status,
          accountId: context.accountId,
          conversationId: context.conversationId,
        },
        { expiresAt: new Date(Date.now() + 10_000) },
      );
      return { ok: true, queued: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao enfileirar a presença.',
      };
    }
  }
}
