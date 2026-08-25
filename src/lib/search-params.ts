import type { PeriodKey } from '@/core/domain/analytics';

/** Params de rota chegam como dados não confiaveis: sempre normalizar. */
export const parsePeriod = (value: string | string[] | undefined): PeriodKey => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'hoje' || raw === '30d' || raw === 'mes' ? raw : '7d';
};


export const parseOneOf = <T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = Array.isArray(value) ? value[0] : value;
  return allowed.includes(raw as T) ? (raw as T) : fallback;
};
