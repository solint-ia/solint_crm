import fsp from 'node:fs/promises';
import { CHANNELS, postgresPubSub } from '@/infrastructure/db/postgres-pubsub';
import { prisma } from '@/infrastructure/db/prisma';
import { pruneCacheKeys } from '../auth/postgres-auth-state';
import { mediaStore } from '../wa-media-store';
import { waLog } from '../wa-log';
import { loadConversationForEvent } from '../wa-store';
import { waEventBus } from '../whatsapp-events';
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
 * Raias de execução.
 *
 * A fila era uma corrente única: um `send` travado segurava tudo atrás dele.
 * Medido no caso real — um comando de leitura enfileirado às 20:28 só terminou
 * 170 segundos depois, um segundo após o envio que estava à sua frente. Marcar
 * uma conversa como lida não tem relação nenhuma com um envio pendente, e não
 * havia motivo para esperar.
 *
 * Dentro de cada raia a ordem é preservada, porque ali ela significa alguma
 * coisa: dois envios para o mesmo contato devem sair na ordem em que foram
 * escritos, e um `disconnect` depois de um `connect` deve encontrar a sessão de
 * pé. Entre raias não há ordem a preservar.
 */
const LANES = {
  envio: new Set(['send', 'send_media']),
  sessao: new Set(['connect', 'disconnect']),
  leitura: new Set(['read']),
} as const;

type LaneName = keyof typeof LANES;

const laneOf = (kind: string): LaneName => {
  for (const [name, kinds] of Object.entries(LANES) as [LaneName, Set<string>][]) {
    if (kinds.has(kind)) return name;
  }
  // Comando desconhecido não pode entrar na raia de envio e atrasá-la; a de
  // leitura é a mais barata e a mais tolerante a uma surpresa.
  return 'leitura';
};

interface CommandRow {
  readonly id: string;
  readonly inboxId: string;
  readonly kind: string;
  readonly payload: unknown;
}

export class CommandConsumer {
  private readonly sessionManager: WhatsAppSessionManager;
  private isRunning = false;
  private sweepTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private sweepCount = 0;

  /** Uma corrente por raia. Serializa o que está dentro, libera o que está fora. */
  private readonly lanes: Record<LaneName, Promise<void>> = {
    envio: Promise.resolve(),
    sessao: Promise.resolve(),
    leitura: Promise.resolve(),
  };

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

  /**
   * Lê os pendentes e entrega cada um à sua raia.
   *
   * A leitura em si continua sendo uma consulta só. O que mudou é o destino: em
   * vez de um laço que executa tudo em sequência, cada comando entra na corrente
   * da sua raia e as três avançam em paralelo.
   */
  private async dispatchPending(): Promise<void> {
    if (!this.isRunning) return;

    let commands: CommandRow[];
    try {
      commands = await prisma.whatsAppCommand.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
    } catch (err) {
      console.warn('[CommandConsumer] Falha ao consultar comandos:', err);
      return;
    }

    for (const cmd of commands) {
      if (this.inFlight.has(cmd.id)) continue;
      this.inFlight.add(cmd.id);

      const lane = laneOf(cmd.kind);
      this.lanes[lane] = this.lanes[lane]
        .then(() => this.runCommand(cmd))
        .catch(() => undefined)
        .finally(() => {
          this.inFlight.delete(cmd.id);
        });
    }
  }

  /** Executa um comando e registra o desfecho na linha da fila. */
  private async runCommand(cmd: CommandRow): Promise<void> {
    if (!this.isRunning) return;

    // Marca como em processamento para evitar duplicidade
    const { count } = await prisma.whatsAppCommand.updateMany({
      where: { id: cmd.id, status: 'pending' },
      data: { status: 'processing' },
    });
    if (count === 0) return;

    const medir = waLog.timer(`[CommandConsumer] ${cmd.kind}`);
    try {
      await this.executeCommand(cmd);
      medir('concluído');
      await prisma.whatsAppCommand.update({
        where: { id: cmd.id },
        data: { status: 'completed' },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro ao processar comando';
      medir(`falhou: ${errorMessage}`);
      console.error(`[CommandConsumer] Erro no comando ${cmd.id} (${cmd.kind}):`, error);
      await prisma.whatsAppCommand
        .update({ where: { id: cmd.id }, data: { status: 'failed', error: errorMessage } })
        .catch(() => undefined);
      await this.markMessageFailed(cmd.payload, errorMessage);
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
        const session =
          this.sessionManager.get(inboxId) ?? (await this.sessionManager.start(inboxId));
        const externalId = await session.sendMessage(
          (payload['recipient'] ?? {}) as { phone?: string; jid?: string; channelThreadId?: string },
          (payload['content'] ?? {}) as { text?: string },
          (payload['options'] ?? {}) as { paced?: boolean },
        );
        await this.stampMessage(payload, externalId);
        break;
      }

      case 'send_media': {
        const session =
          this.sessionManager.get(inboxId) ?? (await this.sessionManager.start(inboxId));
        const media = (payload['media'] ?? {}) as {
          kind?: 'image' | 'video' | 'audio' | 'document';
          mediaId?: string;
          mimeType?: string;
          fileName?: string;
          caption?: string;
          voice?: boolean;
        };

        if (!media.mediaId || !media.kind) {
          throw new Error('Comando de anexo sem identificação da mídia.');
        }

        // O depósito é local ao host. Enquanto worker e site rodam na mesma
        // máquina isto basta; separá-los exige mover a mídia para o Storage
        // (Fase 4) — e é aqui que a falta apareceria, de forma explícita.
        const stored = await mediaStore.read(media.mediaId);
        if (!stored) {
          throw new Error(`Anexo ${media.mediaId} não encontrado no depósito do worker.`);
        }

        const externalId = await session.sendMediaMessage(
          (payload['recipient'] ?? {}) as { phone?: string; jid?: string; channelThreadId?: string },

          {
            kind: media.kind,
            data: await fsp.readFile(stored.filePath),
            mimeType: media.mimeType ?? stored.mimeType,
            ...(media.fileName ? { fileName: media.fileName } : {}),
            ...(media.caption ? { caption: media.caption } : {}),
            ...(media.voice ? { voice: true } : {}),
          },
        );
        await this.stampMessage(payload, externalId);
        break;
      }

      case 'read': {
        const session = this.sessionManager.get(inboxId);
        if (session && typeof payload['conversationId'] === 'string') {
          await session.markAsRead(payload['conversationId']);
        }
        break;
      }

      default: {
        console.warn(`[CommandConsumer] Tipo de comando desconhecido: ${kind}`);
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
      data: { externalId, deliveryStatus: 'enviado' },
    });

    await this.emitMessageUpdate(accountId, conversationId, messageId);
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
        where: { id: messageId, conversationId, conversation: { accountId } },
        data: { deliveryStatus: 'falha' },
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
    const conversation = await loadConversationForEvent(accountId, conversationId);
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

  stop(): void {
    this.isRunning = false;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
