import { randomBytes } from 'node:crypto';
import { prisma } from '@/infrastructure/db/prisma';
import { WhatsAppSession } from './session';

const LOCK_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

export class WhatsAppSessionManager {
  readonly workerId: string;
  private readonly sessions = new Map<string, WhatsAppSession>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.workerId = `worker-${process.pid}-${randomBytes(4).toString('hex')}`;
  }

  async init(): Promise<void> {
    console.log(`[WhatsAppSessionManager] Inicializado com Worker ID: ${this.workerId}`);
    this.startHeartbeat();
    await this.restorePersistedSessions();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      const activeInboxIds = Array.from(this.sessions.keys());
      if (activeInboxIds.length === 0) return;

      const newExpiry = new Date(Date.now() + LOCK_TTL_MS);
      try {
        await prisma.whatsAppConnection.updateMany({
          where: {
            inboxId: { in: activeInboxIds },
            lockOwner: this.workerId,
          },
          data: {
            lockExpiresAt: newExpiry,
          },
        });
      } catch (err) {
        console.warn('[WhatsAppSessionManager] Falha ao renovar heartbeat dos locks:', err);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async acquireLock(inboxId: string): Promise<boolean> {
    const now = new Date();
    const expiry = new Date(Date.now() + LOCK_TTL_MS);

    // Tenta obter a posse da sessão: livre, expirada ou já pertencente a este worker
    const { count } = await prisma.whatsAppConnection.updateMany({
      where: {
        inboxId,
        OR: [
          { lockOwner: null },
          { lockExpiresAt: { lt: now } },
          { lockOwner: this.workerId },
        ],
      },
      data: {
        lockOwner: this.workerId,
        lockExpiresAt: expiry,
      },
    });

    return count > 0;
  }

  private async releaseLock(inboxId: string): Promise<void> {
    try {
      await prisma.whatsAppConnection.updateMany({
        where: {
          inboxId,
          lockOwner: this.workerId,
        },
        data: {
          lockOwner: null,
          lockExpiresAt: null,
        },
      });
    } catch (err) {
      console.warn(`[WhatsAppSessionManager] Erro ao liberar lock de ${inboxId}:`, err);
    }
  }

  async start(inboxId: string): Promise<WhatsAppSession> {
    const existing = this.sessions.get(inboxId);
    if (existing) {
      await existing.start();
      return existing;
    }

    // 1. Busca a caixa de entrada no banco
    const inbox = await prisma.inbox.findUnique({
      where: { id: inboxId },
      select: { id: true, accountId: true, channel: true },
    });

    if (!inbox) {
      throw new Error(`Caixa de entrada ${inboxId} não encontrada.`);
    }

    if (inbox.channel !== 'whatsapp') {
      throw new Error(`Canal da caixa ${inboxId} é ${inbox.channel}, não whatsapp.`);
    }

    // 2. Garante que a linha de WhatsAppConnection existe
    await prisma.whatsAppConnection.upsert({
      where: { inboxId },
      create: { inboxId, status: 'desconectado' },
      update: {},
    });

    // 3. Tenta adquirir a trava de posse (Mutex distribuído)
    const acquired = await this.acquireLock(inboxId);
    if (!acquired) {
      throw new Error(`Outro worker já está operando a sessão da caixa ${inboxId}.`);
    }

    // 4. Cria e inicia a sessão
    const session = new WhatsAppSession(inboxId, inbox.accountId);
    this.sessions.set(inboxId, session);

    try {
      await session.start();
      return session;
    } catch (error) {
      this.sessions.delete(inboxId);
      await this.releaseLock(inboxId);
      throw error;
    }
  }

  async stop(inboxId: string): Promise<void> {
    const session = this.sessions.get(inboxId);
    if (session) {
      await session.stop();
      this.sessions.delete(inboxId);
    }
    await this.releaseLock(inboxId);
  }

  get(inboxId: string): WhatsAppSession | undefined {
    return this.sessions.get(inboxId);
  }

  /**
   * Restaura todas as sessões salvas no Postgres na inicialização do worker.
   */
  private async restorePersistedSessions(): Promise<void> {
    try {
      const persisted = await prisma.whatsAppConnection.findMany({
        where: {
          credsCipher: { not: null },
        },
        select: { inboxId: true },
      });

      console.log(`[WhatsAppSessionManager] Restaurando ${persisted.length} conexões salvas...`);

      for (const conn of persisted) {
        try {
          await this.start(conn.inboxId);
        } catch (err) {
          console.error(`[WhatsAppSessionManager] Falha ao restaurar conexão ${conn.inboxId}:`, err);
        }
      }
    } catch (err) {
      console.error('[WhatsAppSessionManager] Erro ao listar sessões salvas:', err);
    }
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const inboxIds = Array.from(this.sessions.keys());
    for (const id of inboxIds) {
      await this.stop(id);
    }
  }
}
