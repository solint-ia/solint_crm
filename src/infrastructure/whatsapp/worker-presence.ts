import { CHANNELS, postgresPubSub } from '../db/postgres-pubsub';

/**
 * Saber se existe um worker no ar.
 *
 * Sem isto, com o motor `worker` ligado e nenhum worker rodando, a tela ficava
 * em "conectando" para sempre: a aplicação enfileira o comando, ninguém o
 * consome, e nada indica o porquê. Um erro claro vale mais que uma espera muda.
 *
 * A batida vai por `NOTIFY`, não por uma tabela: é um sinal de liveness, não um
 * dado — não precisa sobreviver a nada, e assim não custa escrita no banco a
 * cada poucos segundos nem exige migração.
 */

export const WORKER_BEAT_INTERVAL_MS = 5_000;
/** Três batidas perdidas antes de declarar ausência: tolera uma pausa de GC. */
const WORKER_STALE_MS = WORKER_BEAT_INTERVAL_MS * 3;

interface WorkerBeat {
  readonly workerId: string;
  readonly at: number;
}

const state = { lastBeatAt: 0, workerId: undefined as string | undefined };

let subscribed = false;

/** Começa a observar as batidas. Idempotente. */
export const watchWorker = (): void => {
  if (subscribed) return;
  subscribed = true;
  postgresPubSub.subscribe<WorkerBeat>(CHANNELS.WORKER, (beat) => {
    state.lastBeatAt = Date.now();
    state.workerId = beat?.workerId;
  });
};

export const workerPresence = (): { online: boolean; workerId?: string } => {
  watchWorker();
  return {
    online: Date.now() - state.lastBeatAt < WORKER_STALE_MS,
    workerId: state.workerId,
  };
};

/**
 * Espera até `timeoutMs` por uma batida.
 *
 * Um processo recém-iniciado ainda não viu batida nenhuma, e responder "worker
 * offline" só porque acabamos de subir seria mentira. Só quem vai *agir* sobre
 * a ausência (a rota de conectar) paga esta espera.
 */
export const waitForWorker = async (timeoutMs = WORKER_BEAT_INTERVAL_MS + 1_500): Promise<boolean> => {
  watchWorker();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (workerPresence().online) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return workerPresence().online;
};

/** Publica a batida. Chamado só pelo worker. */
export const publishWorkerBeat = async (workerId: string): Promise<void> => {
  await postgresPubSub
    .publish<WorkerBeat>(CHANNELS.WORKER, { workerId, at: Date.now() })
    .catch(() => undefined);
};
