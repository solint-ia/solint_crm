import { randomBytes } from 'node:crypto';
import { prisma } from '@/infrastructure/db/prisma';
import { hasPairedSession } from '../auth/postgres-auth-state';
import { WhatsAppSession } from './session';

const LOCK_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Tentativas de restauração por caixa.
 *
 * Três cobrem com folga o caso real — esperar uma trava de 30 s vencer — sem
 * transformar uma disputa legítima entre dois workers vivos num laço eterno.
 */
const RESTORE_MAX_ATTEMPTS = 3;

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

  getByAccountId(accountId: string): WhatsAppSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.accountId === accountId) return session;
    }
    return undefined;
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

      // `credsCipher` preenchido nao quer dizer sessao pareada: o Baileys grava
      // credenciais durante a tentativa, antes de ela concluir. Restaurar uma
      // caixa que nunca foi pareada abria um socket para mostrar um QR que
      // ninguem esta olhando; o servidor do WhatsApp encerrava o fluxo (codigo
      // 428) e o worker reconectava, em laco, indefinidamente. Era ruido no log
      // e escrita no banco a cada ciclo, sem chance nenhuma de dar certo.
      const paired: { inboxId: string }[] = [];
      for (const conn of persisted) {
        if (await hasPairedSession(conn.inboxId)) paired.push(conn);
      }

      const skipped = persisted.length - paired.length;
      console.log(
        `[WhatsAppSessionManager] Restaurando ${paired.length} conexões salvas` +
          (skipped > 0 ? ` (${skipped} aguardando leitura do QR, ignorada(s))` : '') +
          '...',
      );

      /**
       * Em paralelo, e não uma de cada vez.
       *
       * Cada restauração busca a versão do Baileys na rede e carrega as
       * credenciais do Postgres antes de abrir o socket. Em série, a segunda
       * caixa só começava esse trabalho quando a primeira terminava o dela — e
       * com quatro ou cinco caixas o atraso da última virava dezenas de
       * segundos de silêncio, durante os quais mensagens que chegassem ficavam
       * represadas no servidor do WhatsApp.
       *
       * Nada aqui depende da ordem: são sockets independentes, e cada uma tem
       * a própria trava por caixa. `allSettled` porque uma caixa que falha não
       * pode impedir as outras de subir — foi assim que uma sessão inválida
       * derrubava a restauração inteira.
       */
      await Promise.allSettled(paired.map((conn) => this.restoreOne(conn.inboxId, 0)));
    } catch (err) {
      console.error('[WhatsAppSessionManager] Erro ao listar sessões salvas:', err);
    }
  }

  /**
   * Restaura uma caixa, insistindo enquanto a trava for de um worker morto.
   *
   * Um worker que morre sem chance de encerrar — `kill -9`, contêiner
   * reiniciado, computador desligado no botão — deixa a trava presa até
   * expirar. O worker seguinte subia dentro dessa janela, `acquireLock` recusava
   * corretamente, e a restauração **desistia na primeira tentativa**. O
   * resultado era uma sessão pareada e saudável que só voltava quando alguém
   * clicasse em "Conectar" — e nada na tela explicava por quê.
   *
   * Insistir é a resposta certa porque a condição é temporária por construção:
   * a trava tem prazo, e quem a segurava já não existe. Fora esse caso, o erro
   * é reportado e a tentativa encerra — insistir num `Caixa não encontrada` não
   * levaria a lugar nenhum.
   */
  private async restoreOne(inboxId: string, attempt: number): Promise<void> {
    try {
      await this.start(inboxId);
      if (attempt > 0) {
        console.log(`[WhatsAppSessionManager] Conexão ${inboxId} restaurada na tentativa ${attempt + 1}.`);
      }
    } catch (err) {
      const disputa = err instanceof Error && err.message.includes('já está operando');

      if (!disputa || attempt >= RESTORE_MAX_ATTEMPTS - 1) {
        console.error(`[WhatsAppSessionManager] Falha ao restaurar conexão ${inboxId}:`, err);
        return;
      }

      // Espera a trava vencer. O acréscimo cobre o desvio de relógio entre o
      // processo e o banco, que é quem carimba o prazo.
      const espera = LOCK_TTL_MS + 2_000;
      console.warn(
        `[WhatsAppSessionManager] Trava de ${inboxId} ainda presa por um worker anterior. ` +
          `Nova tentativa em ${Math.round(espera / 1000)}s (${attempt + 2}/${RESTORE_MAX_ATTEMPTS}).`,
      );

      const timer = setTimeout(() => void this.restoreOne(inboxId, attempt + 1), espera);
      timer.unref?.();
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
