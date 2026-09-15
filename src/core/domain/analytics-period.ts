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

const HOUR_MS = 60 * 60 * 1000;

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/** O relógio de parede de um instante: data, hora e dia da semana num fuso. */
interface Parede {
  readonly ano: number;
  readonly mes: number;
  readonly dia: number;
  readonly hora: number;
  readonly minuto: number;
  readonly segundo: number;
  readonly semana: number;
}

/**
 * Como o instante aparece no relógio do fuso pedido.
 *
 * Sem fuso, o do processo, que era o único comportamento antes. Com fuso, o
 * `Intl`, que já vem no runtime: nenhum pacote de datas entra no domínio.
 */
const paredeDe = (date: Date, timeZone?: string): Parede => {
  if (!timeZone) {
    return {
      ano: date.getFullYear(),
      mes: date.getMonth() + 1,
      dia: date.getDate(),
      hora: date.getHours(),
      minuto: date.getMinutes(),
      segundo: date.getSeconds(),
      semana: date.getDay(),
    };
  }

  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? '0';

  return {
    ano: Number(valor('year')),
    mes: Number(valor('month')),
    dia: Number(valor('day')),
    hora: Number(valor('hour')) % 24,
    minuto: Number(valor('minute')),
    segundo: Number(valor('second')),
    semana: Math.max(0, WEEKDAY_EN.indexOf(valor('weekday') as (typeof WEEKDAY_EN)[number])),
  };
};

/**
 * O instante da meia-noite de um dia do calendário, no fuso pedido.
 *
 * O dia pode transbordar (dia 0, dia 32): `Date.UTC` normaliza, e é isso que
 * permite somar dias sem tratar virada de mês. A diferença entre o relógio do
 * fuso e o UTC é medida no próprio instante, duas vezes, para acertar também
 * o dia em que um fuso com horário de verão muda de deslocamento.
 */
const meiaNoite = (ano: number, mes: number, dia: number, timeZone?: string): Date => {
  if (!timeZone) return new Date(ano, mes - 1, dia);

  const deslocamento = (instante: number): number => {
    const p = paredeDe(new Date(instante), timeZone);
    return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - instante;
  };
  const alvo = Date.UTC(ano, mes - 1, dia);
  const primeira = alvo - deslocamento(alvo);
  return new Date(alvo - deslocamento(primeira));
};

/**
 * Quantos dias cada período cobre.
 *
 * "Este mês" é variável por natureza — no dia 3 ele cobre três dias, não trinta.
 * Fingir trinta faria a média diária do começo do mês despencar por divisão.
 */
export const periodDayCount = (period: PeriodKey, now: Date, timeZone?: string): number => {
  switch (period) {
    case 'hoje':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case 'mes':
      return paredeDe(now, timeZone).dia;
  }
};

/**
 * A janela do período, com o dia cortado no fuso da conta.
 *
 * `timeZone` é o fuso do atendimento (Configurações › Empresa). Sem ele, o
 * corte cai no relógio do processo, e em produção o processo roda em UTC:
 * "Hoje" começava às 21h de ontem no horário de Brasília, e o gráfico por hora
 * ficava três horas adiantado.
 */
export const periodWindow = (
  period: PeriodKey,
  now: Date = new Date(),
  timeZone?: string,
): PeriodWindow => {
  const to = now;
  const hoje = paredeDe(now, timeZone);
  const inicioDoDia = (deslocamentoEmDias: number): Date =>
    meiaNoite(hoje.ano, hoje.mes, hoje.dia + deslocamentoEmDias, timeZone);

  if (period === 'hoje') {
    const from = inicioDoDia(0);
    // Só as horas que já aconteceram: um gráfico de hoje que desenha até as 23h
    // mostra doze horas de zero e faz o dia parecer um desastre.
    const buckets: PeriodBucket[] = Array.from({ length: hoje.hora + 1 }, (_, index) => {
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
      previousFrom: inicioDoDia(-1),
      previousTo: new Date(from.getTime() - 1),
      buckets,
      granularity: 'hora',
    };
  }

  const dias = periodDayCount(period, now, timeZone);
  const primeiro = period === 'mes' ? -(hoje.dia - 1) : -(dias - 1);
  const from = inicioDoDia(primeiro);

  const buckets: PeriodBucket[] = Array.from({ length: dias }, (_, index) => {
    const inicio = inicioDoDia(primeiro + index);
    const parede = paredeDe(inicio, timeZone);
    return {
      label:
        dias <= 7
          ? (WEEKDAY_SHORT[parede.semana] ?? '')
          : `${pad(parede.dia)}/${pad(parede.mes)}`,
      from: inicio,
      to: inicioDoDia(primeiro + index + 1),
    };
  });

  return {
    from,
    to,
    previousFrom: inicioDoDia(primeiro - dias),
    previousTo: new Date(from.getTime() - 1),
    buckets,
    granularity: 'dia',
  };
};

/**
 * Em qual balde do período o instante cai. `-1` quando cai fora.
 *
 * Procura pelos limites de cada balde em vez de dividir a distância por 24
 * horas: os baldes já foram cortados no fuso da conta, e a divisão voltava a
 * usar a meia-noite do processo.
 */
export const bucketIndexOf = (window: PeriodWindow, at: Date): number => {
  const alvo = at.getTime();
  if (alvo < window.from.getTime() || alvo > window.to.getTime()) return -1;
  return window.buckets.findIndex(
    (bucket) => alvo >= bucket.from.getTime() && alvo < bucket.to.getTime(),
  );
};

/** "01/09/2026 a 15/09/2026", ou uma data só quando o período cabe num dia. */
export const periodRangeLabel = (from: Date, to: Date, timeZone?: string): string => {
  const data = (date: Date): string => {
    const p = paredeDe(date, timeZone);
    return `${pad(p.dia)}/${pad(p.mes)}/${p.ano}`;
  };
  const inicio = data(from);
  const fim = data(to);
  return inicio === fim ? inicio : `${inicio} a ${fim}`;
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
