import { randomBytes } from 'node:crypto';
import { prisma } from '@/infrastructure/db/prisma';
import { hasPairedSession } from '../auth/postgres-auth-state';
import { SessaoIndisponivelError } from './errors';
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
  private readonly starting = new Map<string, Promise<WhatsAppSession>>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatRunning = false;
  private shuttingDown = false;
  private readonly restoreTimers = new Set<NodeJS.Timeout>();

  constructor() {
    this.workerId = `worker-${process.pid}-${randomBytes(4).toString('hex')}`;
  }

  /** Quantas sessões este processo mantém — memória por conexão só faz sentido dividida por isto. */
  get size(): number {
    return this.sessions.size;
  }

  async init(): Promise<void> {
    console.log(`[WhatsAppSessionManager] Inicializado com Worker ID: ${this.workerId}`);
    this.startHeartbeat();
    await this.restorePersistedSessions();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      if (this.heartbeatRunning || this.shuttingDown) return;
      this.heartbeatRunning = true;
      try {
        const active = Array.from(this.sessions.entries());
        const renewed = await Promise.all(
          active.map(async ([inboxId, session]) => {
            const count = await prisma.$executeRaw`
              UPDATE "WhatsAppConnection"
              SET "lockExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '30 seconds'
              WHERE "inboxId" = ${inboxId}
                AND "lockOwner" = ${this.workerId}
                AND "lockVersion" = ${session.lockVersion}
            `;
            return { inboxId, ok: count === 1 };
          }),
        );

        for (const { inboxId, ok } of renewed) {
          if (ok) continue;
          console.warn(
            `[WhatsAppSessionManager] Posse de ${inboxId} perdida; encerrando o socket local.`,
          );
          const session = this.sessions.get(inboxId);
          this.sessions.delete(inboxId);
          if (session) await session.stop({ persistStatus: false }).catch(() => undefined);
        }
      } catch (err) {
        console.warn('[WhatsAppSessionManager] Falha ao renovar heartbeat dos locks:', err);
      } finally {
        this.heartbeatRunning = false;
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private async acquireLock(inboxId: string): Promise<number | null> {
    const rows = await prisma.$queryRaw<Array<{ lockVersion: number }>>`
      UPDATE "WhatsAppConnection"
      SET
        "lockVersion" = CASE
          WHEN "lockOwner" = ${this.workerId} THEN "lockVersion"
          ELSE "lockVersion" + 1
        END,
        "lockOwner" = ${this.workerId},
        "lockExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '30 seconds'
      WHERE "inboxId" = ${inboxId}
        AND (
          "lockOwner" IS NULL
          OR "lockExpiresAt" < CURRENT_TIMESTAMP
          OR "lockOwner" = ${this.workerId}
        )
      RETURNING "lockVersion"
    `;
    return rows[0]?.lockVersion ?? null;
  }

  private async releaseLock(inboxId: string, lockVersion: number): Promise<void> {
    try {
      await prisma.whatsAppConnection.updateMany({
        where: {
          inboxId,
          lockOwner: this.workerId,
          lockVersion,
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
    if (this.shuttingDown) {
      throw new SessaoIndisponivelError('O worker está em processo de encerramento.');
    }
    const pending = this.starting.get(inboxId);
    if (pending) return pending;

    const task = this.startOne(inboxId).finally(() => {
      if (this.starting.get(inboxId) === task) this.starting.delete(inboxId);
    });
    this.starting.set(inboxId, task);
    return task;
  }

  private async startOne(inboxId: string): Promise<WhatsAppSession> {
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
    const lockVersion = await this.acquireLock(inboxId);
    if (lockVersion === null) {
      /**
       * `SessaoIndisponivelError`, e não um erro comum: quem manda é o outro
       * worker, e o comando precisa **voltar para a fila** para que ele o pegue.
       *
       * A fila não é particionada por trava — `dispatchPending` lê os pendentes
       * de todas as caixas —, então durante um deploy, com os dois workers no
       * ar, o que não tinha a posse podia pegar um envio, bater aqui e marcar a
       * bolha como falha. A mensagem morria por ter sido lida pelo processo
       * errado, enquanto o dono da sessão nunca chegava a vê-la.
       *
       * O texto é o mesmo de antes de propósito: `restoreOne` reconhece a
       * disputa por ele para decidir se insiste.
       */
      throw new SessaoIndisponivelError(
        `Outro worker já está operando a sessão da caixa ${inboxId}.`,
      );
    }

    // 4. Cria e inicia a sessão
    const session = new WhatsAppSession(inboxId, inbox.accountId, {
      workerId: this.workerId,
      lockVersion,
    });
    this.sessions.set(inboxId, session);

    try {
      await session.start();
      return session;
    } catch (error) {
      this.sessions.delete(inboxId);
      await this.releaseLock(inboxId, lockVersion);
      throw error;
    }
  }

  async stop(inboxId: string): Promise<void> {
    const starting = this.starting.get(inboxId);
    if (starting) await starting.catch(() => undefined);
    const session = this.sessions.get(inboxId);
    if (session) {
      await session.stop();
      this.sessions.delete(inboxId);
      await this.releaseLock(inboxId, session.lockVersion);
    }
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
        console.log(
          `[WhatsAppSessionManager] Conexão ${inboxId} restaurada na tentativa ${attempt + 1}.`,
        );
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

      if (this.shuttingDown) return;
      const timer = setTimeout(() => {
        this.restoreTimers.delete(timer);
        if (!this.shuttingDown) void this.restoreOne(inboxId, attempt + 1);
      }, espera);
      this.restoreTimers.add(timer);
      timer.unref?.();
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const timer of this.restoreTimers) clearTimeout(timer);
    this.restoreTimers.clear();

    /**
     * Em paralelo, e não uma de cada vez.
     *
     * O encerramento acontece dentro do prazo que o supervisor dá entre o
     * SIGTERM e o SIGKILL — no Render, dezenas de segundos. Em série, cada
     * caixa espera a anterior fechar o socket e gravar no banco, e as últimas
     * da fila podiam ser mortas antes de chegar a vez delas: ficavam com a
     * trava presa até vencer, e o worker novo esperava esse prazo para
     * restaurá-las. Qual caixa sobrava dependia da ordem do `Map`, o que fazia
     * o problema parecer aleatório de um deploy para o outro.
     *
     * `allSettled` porque uma caixa que falha ao encerrar não pode impedir as
     * outras de liberar a trava delas.
     */
    const inboxIds = Array.from(this.sessions.keys());
    await Promise.allSettled(inboxIds.map((id) => this.stop(id)));
  }
}
