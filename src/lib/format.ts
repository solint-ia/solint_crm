/** Funcoes puras de formatacao para exibicao. Nenhuma regra de negocio aqui. */

import {
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  localeOf,
  type Currency,
  type Language,
} from '@/core/domain/regional-preferences';

/**
 * Os formatadores do `Intl` sao caros de construir e imutaveis depois de
 * prontos. Eram tres constantes de modulo justamente por isso — mas constantes
 * de modulo so servem enquanto ha uma combinacao unica, e agora ha uma por
 * conta. O cache troca a constante pela memoria: a segunda chamada com o mesmo
 * par locale/moeda reaproveita o mesmo objeto.
 */
const cacheMoeda = new Map<string, Intl.NumberFormat>();
const cacheNumero = new Map<string, Intl.NumberFormat>();

const moedaFormatter = (locale: string, currency: Currency): Intl.NumberFormat => {
  const chave = `${locale}:${currency}`;
  let fmt = cacheMoeda.get(chave);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    cacheMoeda.set(chave, fmt);
  }
  return fmt;
};

const numeroFormatter = (locale: string, compacto: boolean): Intl.NumberFormat => {
  const chave = `${locale}:${compacto}`;
  let fmt = cacheNumero.get(chave);
  if (!fmt) {
    fmt = new Intl.NumberFormat(
      locale,
      compacto ? { notation: 'compact', maximumFractionDigits: 1 } : {},
    );
    cacheNumero.set(chave, fmt);
  }
  return fmt;
};

const DEFAULT_LOCALE = localeOf(DEFAULT_LANGUAGE);

/**
 * Valores monetarios trafegam em centavos (inteiros) e so viram texto na borda
 * da UI.
 *
 * A moeda vinha fixa em `BRL` com locale `pt-BR`, e a tela de Empresa oferecia
 * USD e EUR desde sempre: escolher dolar gravava `USD` no banco e continuava
 * imprimindo `R$` em todo o Kanban e no painel. Quem chama do cliente deve usar
 * `useFormatarMoeda`, que ja carrega a preferencia da conta; os padroes aqui
 * atendem quem formata fora da arvore do provider.
 */
export const formatMoneyFromCents = (
  cents: number,
  currency: Currency = DEFAULT_CURRENCY,
  language: Language = DEFAULT_LANGUAGE,
): string => moedaFormatter(localeOf(language), currency).format(cents / 100);

export const formatCompactNumber = (
  value: number,
  language: Language = DEFAULT_LANGUAGE,
): string => numeroFormatter(localeOf(language), true).format(value);

export const formatNumber = (value: number, language: Language = DEFAULT_LANGUAGE): string =>
  numeroFormatter(localeOf(language), false).format(value);

export { DEFAULT_LOCALE };

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
};

export const percent = (value: number): string => `${Math.round(value)}%`;
