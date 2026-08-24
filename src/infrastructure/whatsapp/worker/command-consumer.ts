import { prisma } from '@/infrastructure/db/prisma';
import type { WhatsAppSessionManager } from './session-manager';

const POLL_INTERVAL_MS = 1_000;

export class CommandConsumer {
  private readonly sessionManager: WhatsAppSessionManager;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(sessionManager: WhatsAppSessionManager) {
    this.sessionManager = sessionManager;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[CommandConsumer] Iniciando processamento da fila WhatsAppCommand...');
    this.scheduleNextPoll();
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(async () => {
      await this.processNextCommands();
      this.scheduleNextPoll();
    }, POLL_INTERVAL_MS);
  }

  private async processNextCommands(): Promise<void> {
    try {
      // Busca comandos pendentes ordenados por criação
      const commands = await prisma.whatsAppCommand.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 5,
      });

      for (const cmd of commands) {
        // Marca como em processamento para evitar duplicidade
        const { count } = await prisma.whatsAppCommand.updateMany({
          where: { id: cmd.id, status: 'pending' },
          data: { status: 'processing' },
        });
        if (count === 0) continue;

        try {
          await this.executeCommand(cmd);
          await prisma.whatsAppCommand.update({
            where: { id: cmd.id },
            data: { status: 'completed' },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erro ao processar comando';
          console.error(`[CommandConsumer] Erro no comando ${cmd.id} (${cmd.kind}):`, error);
          await prisma.whatsAppCommand.update({
            where: { id: cmd.id },
            data: { status: 'failed', error: errorMessage },
          });
        }
      }
    } catch (err) {
      console.warn('[CommandConsumer] Falha ao consultar comandos:', err);
    }
  }

  private async executeCommand(cmd: {
    id: string;
    inboxId: string;
    kind: string;
    payload: unknown;
  }): Promise<void> {
    const { inboxId, kind } = cmd;
    const payload = (cmd.payload && typeof cmd.payload === 'object' ? cmd.payload : {}) as Record<string, unknown>;

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
        const session = this.sessionManager.get(inboxId) ?? (await this.sessionManager.start(inboxId));
        await session.sendMessage(
          (payload['recipient'] ?? {}) as { phone?: string; jid?: string },
          (payload['content'] ?? {}) as { text?: string },
          (payload['options'] ?? {}) as { paced?: boolean },
        );
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

  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
