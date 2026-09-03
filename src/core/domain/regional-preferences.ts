/**
 * As preferências regionais da conta: o que a tela oferece e o que cada uma faz.
 *
 * Um lugar só, e é o ponto: as opções estavam escritas à mão como `<option>` no
 * componente e o servidor as aceitava como `string` de até 16 caracteres. As
 * duas listas não tinham como divergir porque nunca foram comparadas — e o que
 * de fato acontecia era pior: o valor era gravado e ninguém o lia.
 *
 * Aqui cada preferência traz junto o efeito dela. `currencyOf` devolve o código
 * ISO que o `Intl.NumberFormat` entende, `localeOf` o locale de formatação. Uma
 * preferência sem consumidor é uma promessa que a tela faz e o produto não
 * cumpre; se ela vai existir na tela, o efeito mora ao lado da opção.
 */

export const LANGUAGES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type Language = (typeof LANGUAGES)[number];

export const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Noronha',
  'UTC',
] as const;
export type Timezone = (typeof TIMEZONES)[number];

export const CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const FIRST_DAYS_OF_WEEK = ['segunda', 'domingo'] as const;
export type FirstDayOfWeek = (typeof FIRST_DAYS_OF_WEEK)[number];

export const DEFAULT_LANGUAGE: Language = 'pt-BR';
export const DEFAULT_TIMEZONE: Timezone = 'America/Sao_Paulo';
export const DEFAULT_CURRENCY: Currency = 'BRL';
export const DEFAULT_FIRST_DAY_OF_WEEK: FirstDayOfWeek = 'segunda';

/**
 * O que veio do banco é `string` livre — coluna JSON gravada por versões
 * anteriores, quando o servidor aceitava qualquer coisa. Cada leitor volta ao
 * padrão em vez de propagar um valor que o `Intl` recusaria em tempo de
 * execução, no meio de uma tela.
 */
const conhecido = <T extends string>(lista: readonly T[], padrao: T) =>
  (raw: string | undefined): T =>
    (lista as readonly string[]).includes(raw ?? '') ? (raw as T) : padrao;

export const asLanguage = conhecido(LANGUAGES, DEFAULT_LANGUAGE);
export const asTimezone = conhecido(TIMEZONES, DEFAULT_TIMEZONE);
export const asCurrency = conhecido(CURRENCIES, DEFAULT_CURRENCY);
export const asFirstDayOfWeek = conhecido(FIRST_DAYS_OF_WEEK, DEFAULT_FIRST_DAY_OF_WEEK);

/**
 * O idioma escolhido também é o locale de formatação de número e moeda.
 *
 * O produto não é traduzido — a interface é escrita em português no código, e
 * fingir o contrário seria a mesma promessa vazia de antes. O que a escolha
 * muda de verdade, e passa a mudar agora, é como número e dinheiro são
 * escritos: `1.234,50` em pt-BR, `1,234.50` em en-US.
 */
export const localeOf = (language: Language): string => language;

/** O dia em que a semana começa, no índice que `Date.getDay()` usa. */
export const firstWeekdayIndex = (first: FirstDayOfWeek): 0 | 1 =>
  first === 'domingo' ? 0 : 1;

export interface RegionalPreferences {
  readonly language: Language;
  readonly timezone: Timezone;
  readonly currency: Currency;
  readonly firstDayOfWeek: FirstDayOfWeek;
}

export const DEFAULT_REGIONAL_PREFERENCES: RegionalPreferences = {
  language: DEFAULT_LANGUAGE,
  timezone: DEFAULT_TIMEZONE,
  currency: DEFAULT_CURRENCY,
  firstDayOfWeek: DEFAULT_FIRST_DAY_OF_WEEK,
};
