import type { ComparisonRow, PeriodKey, TimeSeriePoint } from '@/core/domain/analytics';

/**
 * Séries por período para a demonstração.
 *
 * O seletor de período existia desde o começo e não mudava nada: trocava a URL
 * e devolvia exatamente os mesmos sete pontos. Um controle que não altera o que
 * mostra é pior que ausente, porque ensina o operador a confiar num número que
 * não corresponde ao recorte pedido.
 *
 * Enquanto não há banco, os números vêm de um gerador determinístico: a mesma
 * chave devolve sempre a mesma série, então o painel não "pisca" entre renders
 * nem inventa história nova a cada F5.
 */

const hashOf = (seed: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const randomFrom = (seed: string): (() => number) => {
  let state = hashOf(seed);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const WEEKDAY_SHAPE = [0.32, 1, 1.08, 1.02, 0.98, 1.06, 0.46]; // dom … sáb
const HOUR_SHAPE = [0.5, 0.8, 1, 1.05, 0.9, 0.55, 0.6, 0.95, 1.1, 1.02, 0.75, 0.4];

const pad = (value: number): string => String(value).padStart(2, '0');

interface PeriodShape {
  readonly points: number;
  readonly base: number;
  readonly labelAt: (index: number, offset: number) => string;
}

/** Cada período tem granularidade própria: hora, dia ou dia do mês. */
const SHAPES: Readonly<Record<PeriodKey, PeriodShape>> = {
  hoje: {
    points: 12,
    base: 17,
    labelAt: (index) => `${pad(8 + index)}h`,
  },
  '7d': {
    points: 7,
    base: 150,
    labelAt: (index, offset) => {
      const day = new Date(2026, 7, 21);
      day.setDate(day.getDate() - (offset + 6 - index));
      return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][day.getDay()] ?? '';
    },
  },
  '30d': {
    points: 30,
    base: 148,
    labelAt: (index, offset) => {
      const day = new Date(2026, 7, 21);
      day.setDate(day.getDate() - (offset + 29 - index));
      return `${pad(day.getDate())}/${pad(day.getMonth() + 1)}`;
    },
  },
};

const seriesFor = (period: PeriodKey, offset: number): readonly TimeSeriePoint[] => {
  const shape = SHAPES[period];
  const next = randomFrom(`${period}:${offset}`);
  // Uma janela anterior levemente mais fraca dá à comparação algo a dizer.
  const drift = offset === 0 ? 1 : 0.93;

  return Array.from({ length: shape.points }, (_, index) => {
    const day = new Date(2026, 7, 21);
    day.setDate(day.getDate() - (offset + shape.points - 1 - index));

    const seasonal =
      period === 'hoje'
        ? (HOUR_SHAPE[index] ?? 1)
        : (WEEKDAY_SHAPE[day.getDay()] ?? 1);

    const noise = 0.88 + next() * 0.24;
    return {
      label: shape.labelAt(index, offset),
      value: Math.max(1, Math.round(shape.base * seasonal * noise * drift)),
    };
  });
};

const sum = (points: readonly TimeSeriePoint[]): number =>
  points.reduce((total, point) => total + point.value, 0);

export interface PeriodSeries {
  readonly volume: readonly TimeSeriePoint[];
  readonly previousVolume: readonly TimeSeriePoint[];
  readonly comparison: readonly ComparisonRow[];
}

export const buildPeriodSeries = (period: PeriodKey): PeriodSeries => {
  const points = SHAPES[period].points;
  const volume = seriesFor(period, 0);
  const previousVolume = seriesFor(period, points);

  const current = sum(volume);
  const previous = sum(previousVolume);
  const next = randomFrom(`kpi:${period}`);
  const jitter = (spread: number) => 1 + (next() - 0.5) * spread;

  return {
    volume,
    previousVolume,
    comparison: [
      {
        id: 'conversas',
        label: 'Conversas recebidas',
        current,
        previous,
      },
      {
        id: 'resolvidas',
        label: 'Conversas resolvidas',
        current: Math.round(current * 0.84 * jitter(0.06)),
        previous: Math.round(previous * 0.81 * jitter(0.06)),
      },
      {
        id: 'primeira_resposta',
        label: 'Tempo de 1ª resposta',
        current: Math.round(161 * jitter(0.18)),
        previous: Math.round(186 * jitter(0.18)),
        unit: 's',
        lowerIsBetter: true,
      },
      {
        id: 'resolucao',
        label: 'Tempo de resolução',
        current: Math.round(38 * jitter(0.2)),
        previous: Math.round(35 * jitter(0.2)),
        unit: 'min',
        lowerIsBetter: true,
      },
      {
        id: 'csat',
        label: 'CSAT médio',
        current: Math.round(46 * jitter(0.05)) / 10,
        previous: Math.round(44 * jitter(0.05)) / 10,
        decimals: 1,
      },
      {
        id: 'sem_resposta',
        label: 'Conversas sem resposta',
        current: Math.round(current * 0.04 * jitter(0.3)),
        previous: Math.round(previous * 0.06 * jitter(0.3)),
        lowerIsBetter: true,
      },
    ],
  };
};
