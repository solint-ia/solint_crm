'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_DATE_FORMAT, formatarData, type DateFormatPreference } from '@/lib/datetime';

/**
 * O formato de data da empresa, alcançável de qualquer componente de cliente.
 *
 * A preferência vive no servidor (`AccountSettings.company.dateFormat`) e quem
 * desenha data é componente de cliente. Passá-la como prop atravessaria cinco
 * níveis de componente até chegar num rótulo, e todo componente novo teria de
 * repassá-la para não quebrar. Um contexto no layout resolve num lugar só.
 *
 * Fora do provider o `useDateFormat` devolve o padrão em vez de estourar: um
 * componente renderizado num teste ou numa árvore de plataforma continua
 * desenhando data, só sem a preferência da conta.
 */
const DateFormatContext = createContext<DateFormatPreference>(DEFAULT_DATE_FORMAT);

export function DateFormatProvider({
  value,
  children,
}: {
  readonly value: DateFormatPreference;
  readonly children: ReactNode;
}) {
  return <DateFormatContext.Provider value={value}>{children}</DateFormatContext.Provider>;
}

export const useDateFormat = (): DateFormatPreference => useContext(DateFormatContext);

/**
 * Formata uma data absoluta no formato da conta.
 *
 * Aceita `Date` ou ISO porque os dois circulam pelo produto: o que vem do
 * servidor chega serializado, e o que nasce no cliente é objeto. Data inválida
 * devolve string vazia em vez de "Invalid Date" na tela.
 */
export const useFormatarData = (): ((date: Date | string) => string) => {
  const formato = useDateFormat();
  return useMemo(
    () => (date: Date | string) => {
      const valor = date instanceof Date ? date : new Date(date);
      return Number.isNaN(valor.getTime()) ? '' : formatarData(valor, formato);
    },
    [formato],
  );
};
