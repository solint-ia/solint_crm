/** Funcoes puras de formatacao para exibicao. Nenhuma regra de negocio aqui. */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

/** Valores monetarios trafegam em centavos (inteiros) e so viram texto na borda da UI. */
export const formatMoneyFromCents = (cents: number): string => BRL.format(cents / 100);

export const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('pt-BR').format(value);

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
};

export const percent = (value: number): string => `${Math.round(value)}%`;
