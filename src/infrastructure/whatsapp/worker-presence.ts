import { prisma } from '../db/prisma';
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

let cancelar: (() => void) | null = null;
let ociosidade: NodeJS.Timeout | null = null;

/**
 * Quanto tempo a escuta sobrevive sem ninguém perguntar pela presença.
 *
 * Bem acima do intervalo do SSE de status (15s), que é o consumidor de longa
 * duração: enquanto uma tela de conexão estiver aberta, a escuta nunca expira.
 * Uma requisição avulsa, ao contrário, devolve o slot em um minuto.
 */
const OCIOSIDADE_MS = 60_000;

/**
 * A escuta da batida custa um slot de **modo sessão**, e eles são quinze no
 * projeto inteiro.
 *
 * Por isso ela não é mais permanente. Antes `subscribed` virava `true` e nunca
 * mais voltava: numa função serverless a instância segurava a conexão até ser
 * reciclada, e como `getWhatsAppChannel()` chamava `watchWorker()`, **toda
 * mensagem enviada pelo site** abria uma. Era a mesma falha que derrubou o
 * pooler pelo lado do `waEventBus`.
 *
 * No worker não expira: lá o processo é longo e a escuta é o trabalho dele.
 */
const renovarOciosidade = (): void => {
  if (process.env.SOLINT_WORKER === '1') return;
  if (ociosidade) clearTimeout(ociosidade);
  ociosidade = setTimeout(() => {
    ociosidade = null;
    cancelar?.();
    cancelar = null;
    // Devolve a conexão de escuta se nenhum outro canal tiver assinante.
    postgresPubSub.stopListeningIfIdle();
  }, OCIOSIDADE_MS);
  ociosidade.unref?.();
};

/** Começa a observar as batidas. Idempotente. */
export const watchWorker = (): void => {
  renovarOciosidade();
  if (cancelar) return;
  cancelar = postgresPubSub.subscribe<WorkerBeat>(CHANNELS.WORKER, (beat) => {
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

/* ==========================================================================
   Corroboração no banco — porque a batida sozinha erra para o lado errado.
   ========================================================================== */

/**
 * Existe worker operando **alguma** caixa desta instalação?
 *
 * A trava de posse é renovada a cada 15 s e vale 30 s. Diferente da batida, ela
 * não exige que *este* processo tenha uma escuta aberta nem que ele estivesse
 * acordado no instante do `NOTIFY` — está gravada, e uma consulta a lê.
 *
 * É global de propósito. `travaViva` responde "esta caixa tem sessão"; esta
 * responde "existe worker no ar", que é outra pergunta e a única que interessa
 * quando a caixa em questão está justamente desconectada, esperando um QR.
 */
export const algumaTravaViva = async (): Promise<boolean> => {
  const vivas = await prisma.whatsAppConnection.count({
    where: { lockOwner: { not: null }, lockExpiresAt: { gt: new Date() } },
  });
  return vivas > 0;
};

/**
 * Quanto um comando pode ficar `pending` antes de a fila contar como parada.
 *
 * Mais que a varredura do worker (`SWEEP_INTERVAL_MS`, 15 s), que é a rede de
 * segurança para quando o `NOTIFY` se perde. Um comando mais velho que isso não
 * foi pego nem pelo aviso nem pela varredura: não há quem o pegue.
 */
const FILA_PARADA_MS = 20_000;

/**
 * A fila desta caixa está parada — prova de ausência, não suspeita.
 *
 * Esta é a diferença que faltava. Não ter ouvido batida em 1,5 s **não** é
 * prova de nada: a batida sai a cada 5 s (`WORKER_BEAT_INTERVAL_MS`), então um
 * processo recém-acordado quase sempre chega antes da primeira. Era isso que
 * fazia a tela de conexão abrir com "O worker de WhatsApp não está em execução"
 * e, segundos depois, exibir o QR que o worker — que sempre esteve no ar —
 * acabara de gerar.
 */
export const filaParada = async (inboxId: string): Promise<boolean> => {
  const parado = await prisma.whatsAppCommand.findFirst({
    where: {
      inboxId,
      status: 'pending',
      createdAt: { lt: new Date(Date.now() - FILA_PARADA_MS) },
    },
    select: { id: true },
  });
  return Boolean(parado);
};

/**
 * O worker está ausente, e dá para afirmar isso?
 *
 * Só devolve `true` com prova positiva: nenhuma batida, nenhuma trava viva em
 * caixa nenhuma, e um comando desta caixa apodrecendo na fila. Na dúvida
 * devolve `false` — "não sei" é mais honesto que um erro que se desmente
 * sozinho três segundos depois.
 */
export const workerComprovadamenteAusente = async (inboxId?: string): Promise<boolean> => {
  if (workerPresence().online) return false;
  if (await algumaTravaViva()) return false;
  if (await waitForWorker(1_500)) return false;
  return inboxId ? filaParada(inboxId) : false;
};
