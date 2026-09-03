'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_REGIONAL_PREFERENCES,
  type RegionalPreferences,
} from '@/core/domain/regional-preferences';
import { formatCompactNumber, formatMoneyFromCents, formatNumber } from '@/lib/format';
import {
  DEFAULT_DATE_FORMAT,
  agendamentoLabel,
  dataCurtaLabel,
  dataHoraLabel,
  formatarData,
  horaDaMensagem,
  horaLabel,
  inicioDoDia,
  type DateFormatPreference,
} from '@/lib/datetime';

/**
 * As preferências regionais da conta, alcançáveis de qualquer componente de
 * cliente.
 *
 * Substitui o `DateFormatProvider`, que carregava só o formato de data. O
 * motivo dele valia para as outras quatro preferências pelo mesmo argumento —
 * quem desenha data, hora e dinheiro é componente de cliente, e passar isso
 * como prop atravessaria cinco níveis até chegar num rótulo. O que mudou é que
 * as outras quatro deixaram de ser decorativas: fuso, moeda e idioma agora têm
 * consumidor, e uma preferência sem consumidor é uma promessa que a tela faz e
 * o produto não cumpre.
 *
 * Fora do provider os ganchos devolvem o padrão em vez de estourar: um
 * componente renderizado num teste ou na árvore de plataforma continua
 * desenhando data, só sem a preferência da conta.
 */
export interface RegionalContextValue extends RegionalPreferences {
  readonly dateFormat: DateFormatPreference;
}

const PADRAO: RegionalContextValue = {
  ...DEFAULT_REGIONAL_PREFERENCES,
  dateFormat: DEFAULT_DATE_FORMAT,
};

const RegionalContext = createContext<RegionalContextValue>(PADRAO);

export function RegionalProvider({
  value,
  children,
}: {
  readonly value: RegionalContextValue;
  readonly children: ReactNode;
}) {
  // Memorizado pelos campos, e não pelo objeto: o layout monta um literal novo
  // a cada render, e sem isto todo consumidor do contexto repintaria junto.
  const estavel = useMemo(
    () => value,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.language, value.timezone, value.currency, value.firstDayOfWeek, value.dateFormat],
  );
  return <RegionalContext.Provider value={estavel}>{children}</RegionalContext.Provider>;
}

export const useRegional = (): RegionalContextValue => useContext(RegionalContext);

export const useDateFormat = (): DateFormatPreference => useRegional().dateFormat;

/**
 * Formata uma data absoluta no formato e no fuso da conta.
 *
 * Aceita `Date` ou ISO porque os dois circulam pelo produto: o que vem do
 * servidor chega serializado, e o que nasce no cliente é objeto. Data inválida
 * devolve string vazia em vez de "Invalid Date" na tela.
 */
export const useFormatarData = (): ((date: Date | string) => string) => {
  const { dateFormat, timezone } = useRegional();
  return useMemo(
    () => (date: Date | string) => {
      const valor = date instanceof Date ? date : new Date(date);
      return Number.isNaN(valor.getTime()) ? '' : formatarData(valor, dateFormat, timezone);
    },
    [dateFormat, timezone],
  );
};

/** Os rótulos de hora e data curta, todos no fuso da conta. */
export const useDatasDaConta = () => {
  const { timezone } = useRegional();
  return useMemo(
    () => ({
      hora: (date: Date) => horaLabel(date, timezone),
      dataCurta: (date: Date) => dataCurtaLabel(date, timezone),
      dataHora: (date: Date) => dataHoraLabel(date, timezone),
      agendamento: (date: Date) => agendamentoLabel(date, timezone),
      inicioDoDia: (date: Date) => inicioDoDia(date, timezone),
      horaDaMensagem: (mensagem: { readonly createdAt?: string; readonly time: string }) =>
        horaDaMensagem(mensagem, timezone),
    }),
    [timezone],
  );
};

/** Dinheiro na moeda da conta, escrito no idioma dela. */
export const useFormatarMoeda = (): ((cents: number) => string) => {
  const { currency, language } = useRegional();
  return useMemo(
    () => (cents: number) => formatMoneyFromCents(cents, currency, language),
    [currency, language],
  );
};

/** Números avulsos e compactos ("1,2 mil") no idioma da conta. */
export const useFormatarNumero = () => {
  const { language } = useRegional();
  return useMemo(
    () => ({
      inteiro: (value: number) => formatNumber(value, language),
      compacto: (value: number) => formatCompactNumber(value, language),
    }),
    [language],
  );
};
