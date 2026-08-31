import type { PeriodKey } from './analytics';

/**
 * O recorte de tempo que o seletor de período pede — de verdade.
 *
 * O seletor existia e não recortava nada: a consulta do painel pegava **todas**
 * as conversas da conta, sempre, e a série temporal vinha de um gerador
 * determinístico de demonstração. Trocar de "hoje" para "30 dias" mudava a URL
 * e o formato do gráfico, nunca o número.
 *
 * Estas funções são puras e recebem `now` por parâmetro: o domínio não lê o
 * relógio, e um recorte que depende do relógio interno é intestável.
 */

export interface PeriodBucket {
  /** Rótulo do eixo ("Seg", "14h", "21/08"). */
  readonly label: string;
  readonly from: Date;
  readonly to: Date;
}

export interface PeriodWindow {
  readonly from: Date;
  readonly to: Date;
  /** A janela imediatamente anterior, do mesmo tamanho — a linha de referência. */
  readonly previousFrom: Date;
  readonly previousTo: Date;
  readonly buckets: readonly PeriodBucket[];
  /** Como agrupar: por hora (hoje) ou por dia (o resto). */
  readonly granularity: 'hora' | 'dia';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Meia-noite local do dia de `date`, sem tocar no fuso do processo. */
const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

/**
 * Quantos dias cada período cobre.
 *
 * "Este mês" é variável por natureza — no dia 3 ele cobre três dias, não trinta.
 * Fingir trinta faria a média diária do começo do mês despencar por divisão.
 */
export const periodDayCount = (period: PeriodKey, now: Date): number => {
  switch (period) {
    case 'hoje':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case 'mes':
      return now.getDate();
  }
};

export const periodWindow = (period: PeriodKey, now: Date = new Date()): PeriodWindow => {
  const to = now;

  if (period === 'hoje') {
    const from = startOfDay(now);
    // Só as horas que já aconteceram: um gráfico de hoje que desenha até as 23h
    // mostra doze horas de zero e faz o dia parecer um desastre.
    const horas = now.getHours() + 1;
    const buckets: PeriodBucket[] = Array.from({ length: horas }, (_, index) => {
      const inicio = new Date(from.getTime() + index * HOUR_MS);
      return {
        label: `${pad(index)}h`,
        from: inicio,
        to: new Date(inicio.getTime() + HOUR_MS),
      };
    });

    return {
      from,
      to,
      previousFrom: addDays(from, -1),
      previousTo: new Date(from.getTime() - 1),
      buckets,
      granularity: 'hora',
    };
  }

  const dias = periodDayCount(period, now);
  const from = period === 'mes' ? startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)) : startOfDay(addDays(now, -(dias - 1)));

  const buckets: PeriodBucket[] = Array.from({ length: dias }, (_, index) => {
    const inicio = addDays(from, index);
    const fim = addDays(inicio, 1);
    return {
      label:
        dias <= 7
          ? (WEEKDAY_SHORT[inicio.getDay()] ?? '')
          : `${pad(inicio.getDate())}/${pad(inicio.getMonth() + 1)}`,
      from: inicio,
      to: fim,
    };
  });

  return {
    from,
    to,
    previousFrom: addDays(from, -dias),
    previousTo: new Date(from.getTime() - 1),
    buckets,
    granularity: 'dia',
  };
};

/** Em qual balde do período o instante cai. `-1` quando cai fora. */
export const bucketIndexOf = (window: PeriodWindow, at: Date): number => {
  const alvo = at.getTime();
  if (alvo < window.from.getTime() || alvo > window.to.getTime()) return -1;

  if (window.granularity === 'hora') {
    const index = Math.floor((alvo - window.from.getTime()) / HOUR_MS);
    return index >= 0 && index < window.buckets.length ? index : -1;
  }

  const index = Math.floor((startOfDay(at).getTime() - window.from.getTime()) / DAY_MS);
  return index >= 0 && index < window.buckets.length ? index : -1;
};

/* ==========================================================================
   Formatação de duração — usada por tempo de resposta e de resolução.
   ========================================================================== */

/**
 * Segundos viram o rótulo mais curto que ainda diz a verdade.
 *
 * `undefined` vira travessão, e isso é a metade importante desta função: um
 * painel que imprime "0s" quando não houve nenhuma conversa respondida está
 * afirmando um desempenho perfeito onde não há dado nenhum.
 */
export const durationLabel = (seconds: number | undefined): string => {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutos = Math.floor(seconds / 60);
  if (minutos < 60) {
    const resto = Math.round(seconds % 60);
    return resto > 0 ? `${minutos}m ${pad(resto)}s` : `${minutos}m`;
  }

  const horas = Math.floor(minutos / 60);
  const restoMin = minutos % 60;
  if (horas < 24) return restoMin > 0 ? `${horas}h ${pad(restoMin)}m` : `${horas}h`;

  const dias = Math.floor(horas / 24);
  const restoH = horas % 24;
  return restoH > 0 ? `${dias}d ${restoH}h` : `${dias}d`;
};

/** Média de uma lista, ou `undefined` quando ela está vazia. */
export const averageOf = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0) / values.length;
