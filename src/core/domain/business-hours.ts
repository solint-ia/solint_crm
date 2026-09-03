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

/**
 * Expediente padrão de uma caixa nova: segunda a sexta, 8h às 18h.
 *
 * Existe para que criar uma caixa nunca produza um expediente sem os sete dias.
 * Já produziu: o cadastro gravava `{ enabled, timezone, schedule: [] }` — outra
 * forma, de uma versão anterior —, e a tela de Configurações quebrava ao tentar
 * filtrar `days`, que não existia ali. Um único lugar que monta o padrão evita
 * que a próxima origem invente a terceira forma.
 */
export const defaultBusinessHours = (timezone = 'America/Sao_Paulo'): BusinessHours => ({
  timezone,
  days: WEEKDAYS.map((day) => ({
    day,
    enabled: day !== 'dom' && day !== 'sab',
    opensAt: '08:00',
    closesAt: '18:00',
  })),
});

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sem acento e em minúsculas — "Sábado" e "sab" precisam casar. */
const foldDay = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .slice(0, 3);

/** "8:00", "08:00:00" e "0800" viram "08:00"; o que não for hora vira o padrão. */
const normalizeTime = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (TIME_PATTERN.test(trimmed)) return trimmed;

  const match = /^(\d{1,2})\D?(\d{2})/.exec(trimmed);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback;
  if (hours > 23 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/**
 * Devolve um expediente utilizável a partir de qualquer coisa lida do banco.
 *
 * A coluna é `jsonb` e guarda o que versões antigas do código gravaram lá. O
 * `readJson` protege contra nulo e contra escalar, mas não contra um **objeto
 * com a forma errada** — que foi exatamente o caso: passava pela checagem de
 * tipo e explodia depois, longe daqui, ao usar `days`.
 */
export const normalizeBusinessHours = (value: unknown): BusinessHours => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const timezone =
    typeof raw.timezone === 'string' && raw.timezone.trim()
      ? raw.timezone.trim()
      : 'America/Sao_Paulo';

  // `schedule` é o nome que uma versão antiga do cadastro deu à mesma lista.
  const source = Array.isArray(raw.days)
    ? raw.days
    : Array.isArray(raw.schedule)
      ? raw.schedule
      : [];

  const padrao = defaultBusinessHours(timezone);
  if (source.length === 0) return padrao;

  const stored = new Map<Weekday, Record<string, unknown>>();
  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const key =
      typeof item.day === 'string'
        ? WEEKDAYS.find((day) => day === foldDay(item.day as string))
        : typeof item.day === 'number'
          ? WEEKDAYS[item.day]
          : undefined;
    if (key) stored.set(key, item);
  }

  // Sempre os sete dias, sempre na mesma ordem. A lista guardada podia trazer
  // só os dias abertos, ou os sete fora de ordem, e as duas formas passavam
  // daqui para dentro intactas -- a tela desenhava certo (ela procura por dia)
  // e o **salvamento** era recusado, porque a validação exige os sete.
  return {
    timezone,
    days: padrao.days.map((fallback) => {
      const item = stored.get(fallback.day);
      if (!item) return fallback;
      return {
        day: fallback.day,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : fallback.enabled,
        opensAt: normalizeTime(item.opensAt, fallback.opensAt),
        closesAt: normalizeTime(item.closesAt, fallback.closesAt),
      };
    }),
  };
};

export interface AutoReply {
  readonly enabled: boolean;
  readonly text: string;
}

/**
 * Devolve uma resposta automática utilizável a partir do que está gravado.
 *
 * A coluna é `jsonb` e guarda o que cada versão do código escreveu nela. O
 * cadastro gravava `{ enabled, message }` -- mesma ideia, outro nome de campo --
 * e o `readJson` devolvia esse objeto inteiro, por ser um objeto válido. O
 * `text` chegava indefinido na tela, voltava ausente para o servidor, e a
 * validação recusava o salvamento **inteiro** com "dados inválidos" -- mesmo
 * quando a pessoa tinha mexido só na mensagem de encerramento.
 */
export const normalizeAutoReply = (value: unknown, fallbackText = ''): AutoReply => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const text = [raw.text, raw.message, raw.content, raw.body].find(
    (candidate): candidate is string => typeof candidate === 'string',
  );
  return { enabled: raw.enabled === true, text: text ?? fallbackText };
};

const minutesOf = (time: string): number => {
  const [hours, minutes] = time.split(':');
  const h = Number(hours);
  const m = Number(minutes);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

export const dayOf = (hours: BusinessHours, day: Weekday): BusinessHoursDay | undefined =>
  hours.days.find((entry) => entry.day === day);

/**
 * Dia da semana e minuto do dia **no fuso do expediente**.
 *
 * `now.getDay()` e `now.getHours()` leem o relógio do processo, e o processo é
 * UTC em produção (Vercel, Render) — o mesmo defeito de origem que o topo de
 * `lib/datetime.ts` documenta, sobrevivendo aqui. Um expediente de 8h às 18h em
 * São Paulo era avaliado como 8h às 18h UTC: entre 18h e 21h de Brasília o
 * sistema ainda se achava aberto e engolia a mensagem de ausência; entre 5h e
 * 8h da manhã ele a disparava com o atendimento já começando.
 *
 * O fuso é o do próprio `BusinessHours` — que a tela sempre mostrou ao lado da
 * tabela e ninguém lia.
 */
const momentoNoFuso = (now: Date, timezone: string): { dia: number; minutos: number } => {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now);

    const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
      partes.find((parte) => parte.type === tipo)?.value ?? '';

    const SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dia = SEMANA.indexOf(valor('weekday'));
    if (dia < 0) throw new Error('dia da semana ilegível');

    return { dia, minutos: Number(valor('hour')) * 60 + Number(valor('minute')) };
  } catch {
    // Fuso inválido gravado no banco não pode derrubar o atendimento: o relógio
    // do processo volta a valer, que é exatamente o comportamento anterior.
    return { dia: now.getDay(), minutos: now.getHours() * 60 + now.getMinutes() };
  }
};

/**
 * `now` entra por parâmetro de propósito: uma função que lê o relógio sozinha
 * não é testável, e o domínio não conhece o relógio.
 */
export const isWithinBusinessHours = (hours: BusinessHours, now: Date): boolean => {
  const momento = momentoNoFuso(now, hours.timezone);
  const weekday = WEEKDAYS[momento.dia];
  if (!weekday) return false;

  const today = dayOf(hours, weekday);
  if (!today || !today.enabled) return false;

  const current = momento.minutos;
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
