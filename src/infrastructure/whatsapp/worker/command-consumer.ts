import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { prisma } from '@/infrastructure/db/prisma';
import { pruneCacheKeys } from '../auth/postgres-auth-state';
import { mediaStore } from '../wa-media-store';
import { providerMessageIdFor } from '../provider-message-id';
import { waLog } from '../wa-log';
import { loadConversationForEvent } from '../wa-store';
import { waEventBus } from '../whatsapp-events';
import { SessaoIndisponivelError } from './errors';
import type { WhatsAppSession } from './session';
import type { WhatsAppSessionManager } from './session-manager';

/**
 * Rede de segurança, não o mecanismo principal.
 *
 * O caminho normal é o `NOTIFY` que a aplicação dispara ao enfileirar: o comando
 * é pego em milissegundos. A varredura existe para o caso de o aviso se perder
 * (worker reiniciando, conexão de escuta caída) e por isso pode ser espaçada —
 * a cada segundo ela era só uma consulta ao banco por segundo sem nada a fazer.
 */
const SWEEP_INTERVAL_MS = 15_000;

/**
 * Retenção da fila.
 *
 * `WhatsAppCommand` nunca era limpa: cada envio, cada leitura e cada tentativa
 * de conexão deixava uma linha para sempre. Enquanto são dezenas isso é
 * invisível; num uso real são milhares por dia, todas varridas pela consulta de
 * pendentes. Seis horas é folga larga para diagnóstico e curta o bastante para
 * a tabela não virar um arquivo morto.
 */
const COMMAND_RETENTION_MS = 6 * 60 * 60 * 1000;

/** Uma limpeza a cada N varreduras: de hora em hora, na prática. */
const CLEANUP_EVERY_N_SWEEPS = 240;

/**
 * Quanto um comando de escrita espera a sessão abrir antes de desistir da vez.
 *
 * Trinta segundos porque é o que cobre uma reconexão real do Baileys — os
 * recuos são 3s, 8s, 20s e o handshake leva poucos segundos — sem prender a
 * raia de envio da caixa por tempo demais quando a sessão está mesmo caída.
 *
 * Antes não havia espera nenhuma: `start()` devolve assim que o socket é
 * construído, muito antes de `connection: 'open'`, e o envio despachado em
 * seguida batia na guarda de `sendMessage`. Toda mensagem escrita na janela de
 * reconexão — a que se abre num deploy, num 440 ou numa queda de rede — virava
 * bolha vermelha, mesmo com a sessão voltando dois segundos depois.
 */
const ESPERA_SESSAO_MS = 30_000;

/**
 * Quantas vezes um comando volta para a fila por sessão indisponível.
 *
 * Só conta a falha que comprovadamente **não** tocou o socket
 * (`SessaoIndisponivelError`) — repetir qualquer outra arriscaria entregar a
 * mesma mensagem duas vezes, que é pior que não entregar.
 *
 * Cinco tentativas somam mais de dois minutos de janela junto com o intervalo
 * da varredura. Passado isso, a sessão não está voltando por conta própria e a
 * bolha vermelha é a informação honesta.
 */
const MAX_TENTATIVAS = 5;

const COMMAND_LEASE_MS = 60_000;
const LEASE_RENEW_MS = 20_000;

interface CommandRow {
  readonly id: string;
  readonly sequence: bigint;
  readonly inboxId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly expiresAt: Date | null;
}

export class CommandConsumer {
  private readonly sessionManager: WhatsAppSessionManager;
  private isRunning = false;
  private sweepTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private sweepCount = 0;
  private readonly workerId: string;
  private lastSweepAt: Date | null = null;

  /**
   * Uma corrente por caixa. Toda ação da mesma sessão preserva a sequência
   * gravada no banco; caixas diferentes continuam avançando em paralelo.
   *
   * O mapa é podado quando a corrente termina: sem isso ele guardaria uma
   * entrada por caixa que já passou por aqui, para sempre. A comparação
   * `=== corrente` antes de apagar é o que impede remover uma corrente que
   * outro comando já emendou no intervalo.
   */
  private readonly lanes = new Map<string, Promise<void>>();

  /**
   * Comandos já entregues a uma raia.
   *
   * A varredura roda a cada 15 s e a raia pode levar mais que isso. Sem esta
   * marca, a varredura seguinte reenfileiraria o mesmo comando — a trava de
   * `status` no banco impediria a execução dobrada, mas o trabalho de descobrir
   * isso seria refeito a cada ciclo.
   */
  private readonly inFlight = new Set<string>();

  constructor(sessionManager: WhatsAppSessionManager) {
    this.sessionManager = sessionManager;
    this.workerId = sessionManager.workerId;
  }

  get healthy(): boolean {
    return Boolean(
      this.isRunning && this.lastSweepAt && Date.now() - this.lastSweepAt.getTime() < 60_000,
    );
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[CommandConsumer] Processando fila WhatsAppCommand (aviso + varredura)...');

    this.unsubscribe = postgresPubSub.subscribe(CHANNELS.COMMANDS, () => {
      void this.dispatchPending();
    });

    this.sweepTimer = setInterval(() => {
      this.sweepCount += 1;
      if (this.sweepCount % CLEANUP_EVERY_N_SWEEPS === 0) void this.cleanup();
      void this.dispatchPending();
    }, SWEEP_INTERVAL_MS);

    // Comandos que sobraram de uma execução anterior não têm quem os avise.
    void this.dispatchPending();
    void this.cleanup();
  }

  /** Lê somente o primeiro comando elegível de cada inbox. */
  private async dispatchPending(): Promise<void> {
    if (!this.isRunning) return;

    let commands: CommandRow[];
    try {
      await this.reapExpiredCommands();
      commands = await prisma.$queryRaw<CommandRow[]>`
        SELECT DISTINCT ON ("inboxId")
          "id", "sequence", "inboxId", "kind", "payload", "attempts", "expiresAt"
        FROM "WhatsAppCommand"
        WHERE "status" = 'pending'
          AND "availableAt" <= CURRENT_TIMESTAMP
          AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
        ORDER BY "inboxId", "sequence"
        LIMIT 100
      `;
      this.lastSweepAt = new Date();
    } catch (err) {
      console.warn('[CommandConsumer] Falha ao consultar comandos:', err);
      return;
    }

    for (const cmd of commands) {
      if (this.inFlight.has(cmd.id)) continue;
      this.inFlight.add(cmd.id);

      const chave = cmd.inboxId;
      const anterior = this.lanes.get(chave) ?? Promise.resolve();
      const corrente = anterior
        .then(() => this.runCommand(cmd))
        .catch(() => undefined)
        .finally(() => {
          this.inFlight.delete(cmd.id);
          if (this.lanes.get(chave) === corrente) this.lanes.delete(chave);
          if (this.isRunning) void this.dispatchPending();
        });
      this.lanes.set(chave, corrente);
    }
  }

  /**
   * Reivindica o comando sob advisory lock da inbox. A trava transacional faz
   * duas réplicas observarem/alterarem a fila daquela conexão em sequência.
   */
  private async claimCommand(cmd: CommandRow): Promise<CommandRow | null> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cmd.inboxId}))`;

      const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS "now"`;
      const now = clock[0]?.now;
      if (!now) return null;

      const fresh = await tx.whatsAppCommand.findFirst({
        where: {
          id: cmd.id,
          status: 'pending',
          availableAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (!fresh) return null;

      const [active, older, connection] = await Promise.all([
        tx.whatsAppCommand.findFirst({
          where: {
            inboxId: cmd.inboxId,
            status: 'processing',
            leaseUntil: { gt: now },
          },
          select: { id: true },
        }),
        tx.whatsAppCommand.findFirst({
          where: {
            inboxId: cmd.inboxId,
            status: 'pending',
            availableAt: { lte: now },
            sequence: { lt: fresh.sequence },
          },
          select: { id: true },
        }),
        tx.whatsAppConnection.findUnique({
          where: { inboxId: cmd.inboxId },
          select: { lockOwner: true, lockExpiresAt: true },
        }),
      ]);

      if (active || older) return null;
      if (
        connection?.lockOwner &&
        connection.lockOwner !== this.workerId &&
        connection.lockExpiresAt &&
        connection.lockExpiresAt > now
      ) {
        return null;
      }

      const leaseUntil = new Date(now.getTime() + COMMAND_LEASE_MS);
      const { count } = await tx.whatsAppCommand.updateMany({
        where: { id: fresh.id, status: 'pending' },
        data: {
          status: 'processing',
          workerId: this.workerId,
          claimedAt: now,
          leaseUntil,
          error: null,
        },
      });
      if (count === 0) return null;

      return {
        id: fresh.id,
        sequence: fresh.sequence,
        inboxId: fresh.inboxId,
        kind: fresh.kind,
        payload: fresh.payload,
        attempts: fresh.attempts,
        expiresAt: fresh.expiresAt,
      };
    });
  }

  private async renewLease(commandId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "WhatsAppCommand"
      SET "leaseUntil" = CURRENT_TIMESTAMP + INTERVAL '60 seconds'
      WHERE "id" = ${commandId}
        AND "status" = 'processing'
        AND "workerId" = ${this.workerId}
    `;
  }

  /** Recupera trabalho abandonado e descarta presença que já perdeu o sentido. */
  private async reapExpiredCommands(): Promise<void> {
    await prisma.$transaction([
      prisma.whatsAppCommand.updateMany({
        where: { status: 'pending', expiresAt: { lte: new Date() } },
        data: { status: 'failed', error: 'Comando expirado antes da execução.' },
      }),
      prisma.whatsAppCommand.updateMany({
        where: {
          status: 'processing',
          leaseUntil: { lte: new Date() },
          attempts: { lt: MAX_TENTATIVAS - 1 },
        },
        data: {
          status: 'pending',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
          availableAt: new Date(),
          attempts: { increment: 1 },
          error: 'Lease expirado; comando recuperado após interrupção do worker.',
        },
      }),
      prisma.whatsAppCommand.updateMany({
        where: {
          status: 'processing',
          leaseUntil: { lte: new Date() },
          attempts: { gte: MAX_TENTATIVAS - 1 },
        },
        data: {
          status: 'failed',
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
          error: 'Número máximo de recuperações do comando excedido.',
        },
      }),
    ]);
  }

  /** Executa um comando e registra o desfecho na linha da fila. */
  private async runCommand(cmd: CommandRow): Promise<void> {
    if (!this.isRunning) return;

    const claimed = await this.claimCommand(cmd);
    if (!claimed) return;

    const leaseTimer = setInterval(() => {
      void this.renewLease(claimed.id).catch((error: unknown) => {
        console.warn(`[CommandConsumer] Falha ao renovar lease de ${claimed.id}:`, error);
      });
    }, LEASE_RENEW_MS);
    leaseTimer.unref?.();

    const medir = waLog.timer(`[CommandConsumer] ${claimed.kind}`);
    try {
      await this.executeCommand(claimed);
      medir('concluído');
      await prisma.whatsAppCommand.updateMany({
        where: { id: claimed.id, status: 'processing', workerId: this.workerId },
        data: {
          status: 'completed',
          leaseUntil: null,
          result: { completedAt: new Date().toISOString() },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro ao processar comando';
      medir(`falhou: ${errorMessage}`);

      /**
       * Sessão fora do ar é adiamento, não fracasso.
       *
       * `SessaoIndisponivelError` só é lançado por guardas que rodam **antes**
       * de `socket.sendMessage` — nada foi entregue ao canal, então repetir é
       * seguro. Qualquer outro erro cai no caminho antigo: pode ter saído, e
       * reenviar arriscaria uma segunda cópia no aparelho do cliente.
       *
       * Devolver a linha para `pending` basta para a retentativa acontecer: a
       * varredura a encontra no ciclo seguinte, e o intervalo dela é o recuo.
       */
      const adiavel =
        error instanceof SessaoIndisponivelError && claimed.attempts + 1 < MAX_TENTATIVAS;

      if (adiavel) {
        console.warn(
          `[CommandConsumer] Comando ${claimed.id} (${claimed.kind}) adiado: ${errorMessage} ` +
            `Tentativa ${claimed.attempts + 1}/${MAX_TENTATIVAS}.`,
        );
        const { count: devolvido } = await prisma.whatsAppCommand
          .updateMany({
            where: { id: claimed.id, status: 'processing', workerId: this.workerId },
            data: {
              status: 'pending',
              workerId: null,
              claimedAt: null,
              leaseUntil: null,
              availableAt: new Date(Date.now() + 3_000 * 2 ** claimed.attempts),
              error: errorMessage,
              attempts: { increment: 1 },
            },
          })
          .catch(() => ({ count: 0 }));
        // Só sai daqui se a linha realmente voltou para a fila. Se a gravação
        // falhou, o comando ficaria preso em `processing` para sempre — e a
        // bolha, em "enviando", sem ninguém para desmenti-la.
        if (devolvido > 0) return;
      }

      console.error(`[CommandConsumer] Erro no comando ${claimed.id} (${claimed.kind}):`, error);
      await prisma.whatsAppCommand
        .updateMany({
          where: { id: claimed.id, status: 'processing', workerId: this.workerId },
          data: {
            status: 'failed',
            error: errorMessage,
            attempts: { increment: 1 },
            leaseUntil: null,
          },
        })
        .catch(() => undefined);
      await this.markMessageFailed(claimed.payload, errorMessage);
    } finally {
      clearInterval(leaseTimer);
    }
  }

  /**
   * Faxina periódica das duas tabelas que só cresciam.
   *
   * `WhatsAppCommand` guardava uma linha por envio, leitura e tentativa de
   * conexão, para sempre. `WhatsAppKey` guardava o cache de tradução
   * telefone↔LID do Baileys, que cresce com cada usuário do WhatsApp que a
   * conta cruza — 83% da tabela depois de dois dias de uso.
   *
   * Nenhuma das duas exclusões perde informação que não se recupere: o comando
   * já foi executado, e a chave de cache o Baileys refaz por USync.
   */
  private async cleanup(): Promise<void> {
    try {
      const { count } = await prisma.whatsAppCommand.deleteMany({
        where: {
          status: { in: ['completed', 'failed'] },
          createdAt: { lt: new Date(Date.now() - COMMAND_RETENTION_MS) },
        },
      });
      if (count > 0) waLog.info(`[CommandConsumer] ${count} comando(s) antigo(s) removido(s).`);
    } catch (err) {
      waLog.warn('[CommandConsumer] Falha ao limpar comandos antigos:', err);
    }

    await pruneCacheKeys();
  }

  /**
   * A sessão da caixa, **de pé**.
   *
   * Substitui o `get(inboxId) ?? start(inboxId)` que os quatro comandos de
   * escrita repetiam, e que tinha dois furos, ambos capazes de perder a
   * mensagem sozinhos:
   *
   *  - `get()` devolvia uma sessão morta sem olhar para ela. Como o `??` só
   *    cai no `start()` quando o lado esquerdo é nulo, o único caminho que
   *    reconstrói o socket **nunca era tomado** — a caixa ficava recusando
   *    envio indefinidamente com a sessão que já tinha caído.
   *  - `start()` devolve assim que `makeWASocket` volta, muito antes de
   *    `connection: 'open'`. Quem enviasse em seguida encontrava
   *    `isAuthenticated === false` e falhava por chegar cedo demais.
   *
   * A distinção entre "parada" e "subindo" é o que impede a correção de virar
   * outro defeito: reiniciar por cima de uma tentativa em curso atropelaria o
   * recuo do 440, que existe justamente para não brigar com um WhatsApp Web
   * aberto do outro lado.
   */
  private async sessaoPronta(inboxId: string): Promise<WhatsAppSession> {
    const atual = this.sessionManager.get(inboxId);
    if (atual?.isConnected) return atual;

    // Sem sessão no processo, ou parada e sem ninguém para levantá-la.
    const sessao = atual?.isReconnecting ? atual : await this.sessionManager.start(inboxId);
    if (sessao.isConnected) return sessao;

    if (await sessao.waitUntilConnected(ESPERA_SESSAO_MS)) return sessao;

    throw new SessaoIndisponivelError(
      `Sessão WhatsApp ${inboxId} não ficou pronta em ${Math.round(ESPERA_SESSAO_MS / 1000)}s.`,
    );
  }

  private async executeCommand(cmd: CommandRow): Promise<void> {
    const { inboxId, kind } = cmd;
    const payload = (cmd.payload && typeof cmd.payload === 'object' ? cmd.payload : {}) as Record<
      string,
      unknown
    >;

    switch (kind) {
      case 'connect': {
        await this.sessionManager.start(inboxId);
        break;
      }

      case 'disconnect': {
        await this.sessionManager.stop(inboxId);
        break;
      }

      case 'send': {
        const session = await this.sessaoPronta(inboxId);
        const quote = payload['quote'] as
          { externalId: string; fromMe: boolean; text: string } | undefined;
        const externalId = await session.sendMessage(
          (payload['recipient'] ?? {}) as {
            phone?: string;
            jid?: string;
            channelThreadId?: string;
          },
          (payload['content'] ?? {}) as { text?: string },
          {
            ...((payload['options'] ?? {}) as { paced?: boolean }),
            ...(quote ? { quote } : {}),
            ...(typeof payload['messageId'] === 'string'
              ? { providerMessageId: providerMessageIdFor(payload['messageId']) }
              : {}),
          },
        );
        await this.stampMessage(payload, externalId);
        break;
      }

      case 'delete': {
        const session = await this.sessaoPronta(inboxId);
        const externalId = payload['externalId'];
        if (typeof externalId !== 'string' || !externalId) {
          throw new Error('Comando de exclusão sem o id da mensagem no canal.');
        }
        await session.deleteMessage(
          (payload['recipient'] ?? {}) as {
            phone?: string;
            jid?: string;
            channelThreadId?: string;
          },
          externalId,
        );
        break;
      }

      case 'react': {
        const session = await this.sessaoPronta(inboxId);
        const alvo = (payload['message'] ?? {}) as {
          externalId?: string;
          fromMe?: boolean;
          participant?: string;
        };
        if (!alvo.externalId) {
          throw new Error('Comando de reação sem o id da mensagem no canal.');
        }
        await session.sendReaction(
          (payload['recipient'] ?? {}) as {
            phone?: string;
            jid?: string;
            channelThreadId?: string;
          },
          {
            externalId: alvo.externalId,
            fromMe: Boolean(alvo.fromMe),
            ...(alvo.participant ? { participant: alvo.participant } : {}),
          },
          typeof payload['emoji'] === 'string' ? payload['emoji'] : '',
        );
        break;
      }

      case 'send_media': {
        const session = await this.sessaoPronta(inboxId);
        const media = (payload['media'] ?? {}) as {
          kind?: 'image' | 'video' | 'audio' | 'document';
          mediaId?: string;
          mimeType?: string;
          fileName?: string;
          caption?: string;
          voice?: boolean;
        };
        const mediaQuote = payload['quote'] as
          { externalId: string; fromMe: boolean; text: string } | undefined;

        if (!media.mediaId || !media.kind) {
          throw new Error('Comando de anexo sem identificação da mídia.');
        }

        // Os bytes vêm do depósito, que já busca no Storage quando o cache
        // deste host não os tem — é o que permite ao worker enviar um anexo
        // recebido pela aplicação rodando noutra máquina.
        const accountId = payload['accountId'];
        if (typeof accountId !== 'string') {
          throw new Error('Comando de anexo sem identificação da conta.');
        }
        const stored = await mediaStore.read(media.mediaId, {
          accountId,
          inboxId,
          kind: 'mensagem',
        });
        if (!stored) {
          throw new Error(`Anexo ${media.mediaId} não encontrado no depósito do worker.`);
        }

        const externalId = await session.sendMediaMessage(
          (payload['recipient'] ?? {}) as {
            phone?: string;
            jid?: string;
            channelThreadId?: string;
          },

          {
            kind: media.kind,
            data: await stored.bytes(),
            mimeType: media.mimeType ?? stored.mimeType,
            ...(media.fileName ? { fileName: media.fileName } : {}),
            ...(media.caption ? { caption: media.caption } : {}),
            ...(media.voice ? { voice: true } : {}),
            ...(mediaQuote ? { quote: mediaQuote } : {}),
            ...(typeof payload['messageId'] === 'string'
              ? { providerMessageId: providerMessageIdFor(payload['messageId']) }
              : {}),
          },
        );
        await this.stampMessage(payload, externalId);
        break;
      }

      case 'read': {
        if (typeof payload['conversationId'] !== 'string') {
          throw new Error('Comando de leitura sem identificação da conversa.');
        }
        const session = await this.sessaoPronta(inboxId);
        await session.markAsRead(payload['conversationId']);
        break;
      }

      case 'presence': {
        const session = this.sessionManager.get(inboxId);
        if (!session?.isConnected) {
          throw new SessaoIndisponivelError(`Sessão WhatsApp ${inboxId} não está conectada.`);
        }
        const recipient = (payload['recipient'] ?? {}) as {
          phone?: string;
          jid?: string;
          channelThreadId?: string;
        };
        const status = (payload['status'] ?? 'composing') as 'composing' | 'paused' | 'recording';
        await session.sendPresence(recipient, status);
        break;
      }

      case 'sync_groups': {
        const accountId =
          typeof payload['accountId'] === 'string' ? payload['accountId'] : undefined;
        const session = await this.sessaoPronta(inboxId);
        await session.syncAllGroups(accountId ?? session.accountId);
        break;
      }

      case 'sync_contacts': {
        const session = await this.sessaoPronta(inboxId);
        await session.syncAllStoredContacts();
        break;
      }

      default: {
        throw new Error(`Tipo de comando desconhecido: ${kind}`);
      }
    }
  }

  /**
   * Fecha o ciclo do envio assíncrono.
   *
   * Quem chamou a Server Action já recebeu a resposta e viu a bolha em
   * "enviando" — foi só isso que a fila pôde prometer naquele momento. É aqui
   * que a mensagem ganha o id do canal e o evento que promove a bolha a
   * "enviado". Sem este passo o envio funcionaria e a tela nunca saberia.
   */
  private async stampMessage(payload: Record<string, unknown>, externalId: string): Promise<void> {
    const messageId = payload['messageId'];
    const conversationId = payload['conversationId'];
    const accountId = payload['accountId'];
    if (
      typeof messageId !== 'string' ||
      typeof conversationId !== 'string' ||
      typeof accountId !== 'string'
    ) {
      return;
    }

    await prisma.message.updateMany({
      where: { id: messageId, conversationId, conversation: { accountId } },
      data: { externalId, deliveryStatus: 'enviado', dispatchError: null },
    });

    await prisma.scheduledMessage.updateMany({
      where: { accountId, messageId, status: { in: ['queued', 'sending'] } },
      data: {
        status: 'sent',
        sentAt: new Date(),
        error: null,
        workerId: null,
        claimedAt: null,
        leaseUntil: null,
      },
    });

    // O aviso para a tela é cortesia, e por isso não pode derrubar o comando.
    //
    // A mensagem **já saiu** e já está marcada como enviada duas linhas acima.
    // Quando este `emit` falhava — e falhava por esgotamento do pool de conexões,
    // nada a ver com o envio — a exceção subia até o `catch` de `process`, que
    // chamava `markMessageFailed` e regravava `falha` por cima do `enviado`. A
    // tela mostrava o alerta vermelho e oferecia reenviar uma mensagem que o
    // destinatário já tinha recebido.
    //
    // Perder o aviso custa a bolha não atualizar sozinha até o próximo carregamento.
    // Perder a verdade sobre a entrega custava uma mensagem duplicada.
    try {
      await this.emitMessageUpdate(accountId, conversationId, messageId);
    } catch (error) {
      console.warn(
        `[CommandConsumer] Envio ${messageId} concluído, mas o aviso à tela falhou:`,
        error,
      );
    }
  }

  /** Marca a bolha como falha quando o comando de envio não pôde ser executado. */
  private async markMessageFailed(rawPayload: unknown, error: string): Promise<void> {
    const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<
      string,
      unknown
    >;
    const messageId = payload['messageId'];
    const conversationId = payload['conversationId'];
    const accountId = payload['accountId'];
    if (
      typeof messageId !== 'string' ||
      typeof conversationId !== 'string' ||
      typeof accountId !== 'string'
    ) {
      return;
    }

    try {
      await prisma.message.updateMany({
        where: {
          id: messageId,
          conversationId,
          conversation: { accountId },
          // Nunca rebaixar o que o canal já confirmou. Qualquer passo posterior
          // ao envio que venha a falhar — hoje o aviso à tela, amanhã outro —
          // encontra esta guarda em vez de reescrever o histórico.
          deliveryStatus: { notIn: ['enviado', 'entregue', 'lido'] },
        },
        data: { deliveryStatus: 'falha', dispatchError: error },
      });
      await prisma.scheduledMessage.updateMany({
        where: { accountId, messageId, status: { in: ['queued', 'sending'] } },
        data: {
          status: 'failed',
          error,
          workerId: null,
          claimedAt: null,
          leaseUntil: null,
        },
      });
      await this.emitMessageUpdate(accountId, conversationId, messageId);
    } catch (err) {
      console.warn('[CommandConsumer] Falha ao marcar mensagem como não entregue:', err);
    }
    console.warn(`[CommandConsumer] Envio ${messageId} marcado como falha: ${error}`);
  }

  private async emitMessageUpdate(
    accountId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    // Ver a nota em `hasConversationListeners`: no worker este `emit` local não
    // tem ouvinte, e carregar a conversa inteira só para descartá-la no
    // `NOTIFY` custava uma consulta pesada por envio concluído.
    const conversation = waEventBus.hasConversationListeners
      ? await loadConversationForEvent(accountId, conversationId)
      : null;
    const item = conversation?.timeline.find(
      (entry) => entry.kind === 'message' && entry.message.id === messageId,
    );

    waEventBus.emitConversation({
      type: 'message_updated',
      accountId,
      conversationId,
      messageId,
      ...(item?.kind === 'message' ? { message: item.message } : {}),
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    await Promise.race([
      Promise.allSettled([...this.lanes.values()]),
      new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
    ]);
  }
}
