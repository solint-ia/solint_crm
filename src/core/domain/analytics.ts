import type { Tone } from './label';
import type { Id } from './shared';

export type PeriodKey = 'hoje' | '7d' | '30d' | 'mes';

export const PERIOD_LABELS: Readonly<Record<PeriodKey, string>> = {
  hoje: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  mes: 'Este mês',
};

/** Como o período anterior se chama, para o rótulo da comparação. */
export const PREVIOUS_PERIOD_LABELS: Readonly<Record<PeriodKey, string>> = {
  hoje: 'Ontem',
  '7d': '7 dias anteriores',
  '30d': '30 dias anteriores',
  mes: 'Mês anterior',
};

/**
 * Uma linha da comparação entre períodos.
 *
 * Guarda os números crus, não o texto: quem calcula a variação é o domínio, e
 * uma tela que recebesse "+12%" pronto não teria como colorir, ordenar ou
 * inverter o sentido de uma métrica em que cair é bom.
 */
export interface ComparisonRow {
  readonly id: string;
  readonly label: string;
  readonly current: number;
  readonly previous: number;
  readonly unit?: string;
  /** Métrica em que diminuir é melhor (tempo de resposta, abandono). */
  readonly lowerIsBetter?: boolean;
  readonly decimals?: number;
}

export interface ComparisonVerdict {
  readonly deltaPercent: number | undefined;
  readonly direction: 'positivo' | 'negativo' | 'neutro';
  readonly label: string;
}

/**
 * Variação entre os dois períodos.
 *
 * Sem base anterior não existe percentual: devolver "+100%" para algo que saiu
 * de zero é a mentira estatística mais comum de painel — aqui vira "novo".
 */
export const compareRow = (row: ComparisonRow): ComparisonVerdict => {
  if (row.previous === 0) {
    if (row.current === 0) return { deltaPercent: 0, direction: 'neutro', label: 'sem dados' };
    return { deltaPercent: undefined, direction: 'neutro', label: 'novo no período' };
  }

  const raw = ((row.current - row.previous) / row.previous) * 100;
  const rounded = Math.round(raw * 10) / 10;
  const better = row.lowerIsBetter ? rounded < 0 : rounded > 0;

  return {
    deltaPercent: rounded,
    direction: rounded === 0 ? 'neutro' : better ? 'positivo' : 'negativo',
    label: `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('pt-BR', {
      maximumFractionDigits: 1,
    })}%`,
  };
};

export interface Kpi {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly delta: string;
  readonly deltaDirection: 'positivo' | 'negativo' | 'neutro';
  /**
   * O que o indicador mede, em uma frase.
   *
   * Não é opcional por comodidade: é o texto do balãozinho de interrogação do
   * cartão, e um indicador sem explicação obriga quem lê a adivinhar a
   * definição — que é como duas pessoas passam a discutir números diferentes
   * achando que falam do mesmo.
   */
  readonly description: string;
}

export interface TimeSeriePoint {
  readonly label: string;
  readonly value: number;
  readonly answered?: number;
  readonly resolved?: number;
  readonly abandoned?: number;
}

export interface ChannelShare {
  readonly channelLabel: string;
  readonly count?: number;
  readonly percentage: number;
  readonly colorVar: string;
}

export interface AgentPerformance {
  readonly id: Id;
  readonly name: string;
  readonly team?: string;
  readonly avatarTone: string;
  readonly handled: number;
  readonly resolved?: number;
  readonly averageResponse: string;
  readonly csat: string;
  readonly csatTone: Tone;
}

export interface FunnelStageSummary {
  readonly stage: string;
  readonly count: number;
  readonly amountInCents: number;
  readonly colorVar: string;
  readonly conversionRate?: string;
}

export interface PendingConversation {
  readonly conversationId: Id;
  readonly contactName: string;
  readonly phone?: string;
  readonly channel?: string;
  readonly assigneeName?: string;
  readonly priority?: 'baixa' | 'media' | 'alta' | 'urgente';
  readonly waitingLabel: string;
  readonly waitingMinutes?: number;
  readonly tone: Tone;
}


export interface ConversionRate {
  readonly stage: string;
  readonly rate: string;
  readonly average: string;
}

export interface LossReason {
  readonly reason: string;
  readonly percentage: number;
}

export interface CsatBucket {
  readonly stars: number;
  readonly percentage: number;
  readonly tone: Tone;
}

export interface CsatComment {
  readonly id: Id;
  readonly contactName: string;
  readonly stars: number;
  readonly comment: string;
}

export interface DashboardOverview {
  readonly kpis: readonly Kpi[];
  readonly volume: readonly TimeSeriePoint[];
  readonly agents: readonly AgentPerformance[];
  readonly funnel: readonly FunnelStageSummary[];
  readonly pendings: readonly PendingConversation[];
}

export interface AnalyticsReport {
  readonly volume: readonly TimeSeriePoint[];
  /** Mesma janela, período imediatamente anterior — a linha de referência. */
  readonly previousVolume: readonly TimeSeriePoint[];
  readonly comparison: readonly ComparisonRow[];
  readonly agents: readonly AgentPerformance[];
  readonly conversions: readonly ConversionRate[];
  readonly lossReasons: readonly LossReason[];
  readonly csatDistribution: readonly CsatBucket[];
  readonly csatComments: readonly CsatComment[];
  /**
   * Quantas notas sustentam a distribuição.
   *
   * Uma barra de "60%" construída sobre duas respostas não é a mesma coisa que
   * uma sobre duzentas, e o gráfico sozinho não sabe dizer a diferença.
   */
  readonly csatResponseCount: number;
}
