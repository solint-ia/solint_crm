/**
 * Horário comercial de uma caixa de entrada.
 *
 * O produto precisa responder duas perguntas com este dado: "estamos abertos
 * agora?" (decide se a mensagem de ausência dispara) e "qual é o resumo legível
 * disso?" (o que a tela mostra). As duas são puras e moram aqui — nenhuma tela
 * recalcula expediente por conta própria.
 */

export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  dom: 'Domingo',
  seg: 'Segunda',
  ter: 'Terça',
  qua: 'Quarta',
  qui: 'Quinta',
  sex: 'Sexta',
  sab: 'Sábado',
};

export const WEEKDAY_SHORT: Readonly<Record<Weekday, string>> = {
  dom: 'Dom',
  seg: 'Seg',
  ter: 'Ter',
  qua: 'Qua',
  qui: 'Qui',
  sex: 'Sex',
  sab: 'Sáb',
};

export interface BusinessHoursDay {
  readonly day: Weekday;
  readonly enabled: boolean;
  /** "HH:MM", 24h. */
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface BusinessHours {
  readonly timezone: string;
  readonly days: readonly BusinessHoursDay[];
}

export interface AutoReply {
  readonly enabled: boolean;
  readonly text: string;
}

const minutesOf = (time: string): number => {
  const [hours, minutes] = time.split(':');
  const h = Number(hours);
  const m = Number(minutes);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

export const dayOf = (hours: BusinessHours, day: Weekday): BusinessHoursDay | undefined =>
  hours.days.find((entry) => entry.day === day);

/**
 * `now` entra por parâmetro de propósito: uma função que lê o relógio sozinha
 * não é testável, e o domínio não conhece o relógio.
 */
export const isWithinBusinessHours = (hours: BusinessHours, now: Date): boolean => {
  const weekday = WEEKDAYS[now.getDay()];
  if (!weekday) return false;

  const today = dayOf(hours, weekday);
  if (!today || !today.enabled) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  const opens = minutesOf(today.opensAt);
  const closes = minutesOf(today.closesAt);

  // Expediente que atravessa a meia-noite (22h às 02h) é um intervalo invertido.
  return closes > opens
    ? current >= opens && current < closes
    : current >= opens || current < closes;
};

/** "Seg a Sex, 08:00–18:00" quando os dias ativos compartilham o mesmo horário. */
export const summarizeBusinessHours = (hours: BusinessHours): string => {
  const open = hours.days.filter((day) => day.enabled);
  if (open.length === 0) return 'Sempre fechado';
  if (
    open.length === 7 &&
    open.every((day) => day.opensAt === '00:00' && day.closesAt === '23:59')
  ) {
    return 'Sempre aberto (24/7)';
  }

  const first = open[0];
  if (!first) return 'Sempre fechado';

  const uniform = open.every(
    (day) => day.opensAt === first.opensAt && day.closesAt === first.closesAt,
  );
  const range = `${first.opensAt}–${first.closesAt}`;

  if (!uniform) {
    return `${open.map((day) => WEEKDAY_SHORT[day.day]).join(', ')} · horários variados`;
  }

  // Sequência contígua de dias vira "Seg a Sex"; qualquer outra coisa é listada.
  const indices = open.map((day) => WEEKDAYS.indexOf(day.day)).sort((a, b) => a - b);
  const contiguous = indices.every(
    (value, index) => index === 0 || value === (indices[index - 1] ?? -9) + 1,
  );
  const start = indices[0];
  const end = indices[indices.length - 1];

  if (contiguous && open.length > 2 && start !== undefined && end !== undefined) {
    const from = WEEKDAYS[start];
    const to = WEEKDAYS[end];
    if (from && to) return `${WEEKDAY_SHORT[from]} a ${WEEKDAY_SHORT[to]}, ${range}`;
  }

  return `${open.map((day) => WEEKDAY_SHORT[day.day]).join(', ')}, ${range}`;
};

/** Quantas horas de atendimento a semana oferece — usado no resumo da caixa. */
export const weeklyOpenHours = (hours: BusinessHours): number =>
  hours.days.reduce((total, day) => {
    if (!day.enabled) return total;
    const opens = minutesOf(day.opensAt);
    const closes = minutesOf(day.closesAt);
    const span = closes > opens ? closes - opens : 24 * 60 - opens + closes;
    return total + span / 60;
  }, 0);
