import { isWithinBusinessHours, type BusinessHours } from './business-hours';

/**
 * Prazo de resposta: quanto tempo a conversa pode ficar esperando.
 *
 * As três colunas (`slaDeadlineAt`, `slaLabel`, `slaBreached`) existiam desde
 * sempre e eram consumidas pela lista, pelo filtro "SLA estourado" e pelo painel
 * de atenção — mas **nada as escrevia** fora do `seed`. O filtro funcionava e
 * devolvia zero resultados em qualquer conta real.
 *
 * A política é global e fixa nesta primeira versão, sem tela de configuração.
 * Um SLA por caixa é a evolução natural, e é o motivo de os minutos morarem em
 * constantes nomeadas em vez de espalhados pelo cálculo.
 */

/** Primeira resposta de um atendimento novo. É a espera que mais custa. */
export const SLA_PRIMEIRA_RESPOSTA_MIN = 15;

/** Demais respostas dentro de um atendimento já em curso. */
export const SLA_RESPOSTA_SEGUINTE_MIN = 60;

/**
 * A que altura do prazo o aviso sai.
 *
 * A preferência se chama "quando o prazo **estiver acabando**", então avisar no
 * vencimento seria avisar tarde: o aviso existe para dar tempo de agir.
 */
export const SLA_AVISO_EM = 0.8;

const MINUTO_MS = 60_000;

/**
 * Soma minutos úteis a partir de um instante.
 *
 * O relógio só corre dentro do expediente. Sem isto, uma mensagem recebida às
 * 18h05 nasceria com prazo às 18h20 e estaria estourada às 9h do dia seguinte —
 * cobrando da equipe um tempo em que ela não estava trabalhando, e enchendo a
 * caixa de vermelho toda manhã.
 *
 * Avança em passos de um minuto: é grosseiro e é suficiente, porque o prazo é
 * medido em dezenas de minutos e a varredura roda a cada dois. Uma conta sem
 * expediente configurado (todos os dias desligados) faria o laço andar para
 * sempre, então há um teto de catorze dias.
 */
const TETO_DE_BUSCA_MIN = 14 * 24 * 60;

export const somarMinutosUteis = (inicio: Date, minutos: number, hours: BusinessHours): Date => {
  let restantes = minutos;
  let cursor = new Date(inicio.getTime());
  let passos = 0;

  while (restantes > 0 && passos < TETO_DE_BUSCA_MIN) {
    cursor = new Date(cursor.getTime() + MINUTO_MS);
    passos += 1;
    if (isWithinBusinessHours(hours, cursor)) restantes -= 1;
  }

  return cursor;
};

export interface SlaState {
  readonly slaDeadlineAt: string;
  readonly slaLabel: string;
  readonly slaBreached: boolean;
}

/** "SLA em 12 min", "SLA em 2 h" ou "SLA estourado". */
export const slaLabelDe = (prazo: Date, agora: Date = new Date()): string => {
  const restanteMin = Math.round((prazo.getTime() - agora.getTime()) / MINUTO_MS);
  if (restanteMin <= 0) return 'SLA estourado';
  if (restanteMin < 60) return `SLA em ${restanteMin} min`;
  return `SLA em ${Math.round(restanteMin / 60)} h`;
};

/**
 * O estado de SLA de uma conversa que acabou de receber mensagem do contato.
 *
 * `primeiraResposta` decide qual dos dois prazos vale: a conversa que ninguém
 * respondeu ainda é mais urgente que a que está em curso.
 */
export const calcularSla = (
  recebidaEm: Date,
  primeiraResposta: boolean,
  hours: BusinessHours,
  agora: Date = new Date(),
): SlaState => {
  const minutos = primeiraResposta ? SLA_PRIMEIRA_RESPOSTA_MIN : SLA_RESPOSTA_SEGUINTE_MIN;
  const prazo = somarMinutosUteis(recebidaEm, minutos, hours);
  return {
    slaDeadlineAt: prazo.toISOString(),
    slaLabel: slaLabelDe(prazo, agora),
    slaBreached: prazo.getTime() <= agora.getTime(),
  };
};

/** O prazo já entrou na faixa de aviso, sem ter estourado? */
export const estaAcabando = (
  prazo: Date,
  minutosDoPrazo: number,
  agora: Date = new Date(),
): boolean => {
  const restanteMs = prazo.getTime() - agora.getTime();
  if (restanteMs <= 0) return false;
  return restanteMs <= minutosDoPrazo * MINUTO_MS * (1 - SLA_AVISO_EM);
};
