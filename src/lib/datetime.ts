/**
 * Fuso horário de exibição — o único lugar que decide em que hora um instante
 * vira texto na tela.
 *
 * **O problema que isto resolve.** `toLocaleTimeString` sem `timeZone` usa o
 * fuso de quem está rodando o código. Em desenvolvimento isso é a máquina do
 * time, em produção é o servidor: Vercel e Render rodam em UTC. O resultado era
 * uma mensagem recebida às 10:55 em Aracaju ser gravada e exibida como "13:55"
 * — exatamente as 3 horas de diferença entre UTC e o horário de Brasília.
 *
 * **Por que um fuso fixo, e não o do navegador.** As horas de uma conversa são
 * do atendimento, não de quem está olhando: dois agentes discutindo "a mensagem
 * das 14:30" precisam ver o mesmo número, e o mesmo número que aparece no
 * relatório e no expediente configurado da caixa. Usar o fuso do navegador
 * ainda quebraria a renderização no servidor, que não tem navegador nenhum e
 * cairia de volta em UTC — o bug de origem, agora intermitente.
 *
 * `NEXT_PUBLIC_` é obrigatório no nome: a variável precisa existir tanto no
 * servidor quanto no bundle do cliente, senão os dois formatam diferente e o
 * React acusa divergência de hidratação.
 */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() || 'America/Sao_Paulo';

/**
 * O fuso deixou de ser só a constante — passou a ser um parâmetro com ela como
 * padrão.
 *
 * A tela de Empresa sempre ofereceu "Fuso horário oficial" com quatro opções, e
 * a escolha era gravada e nunca lida: uma clínica em Manaus configurava
 * `America/Manaus` e seguia vendo todas as horas do atendimento em Brasília,
 * uma hora adiantadas. O raciocínio do bloco acima continua valendo inteiro — o
 * fuso é **do atendimento**, não de quem olha; o que muda é de onde ele vem: da
 * conta, e não de uma variável de ambiente igual para todos os inquilinos.
 *
 * A variável segue como padrão para quem formata fora da árvore do provider —
 * gravações no servidor, worker e repositórios, onde o rótulo é reserva do
 * `createdAt` e não o que a tela mostra.
 */
export type TimeZone = string;

/** Rótulo de hora ("14:32") no fuso de exibição. */
export const horaLabel = (date: Date, timeZone: TimeZone = APP_TIMEZONE): string =>
  date.toLocaleTimeString('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });

/** Rótulo curto de data ("27 de ago." → "27 ago.") no fuso de exibição. */
export const dataCurtaLabel = (date: Date, timeZone: TimeZone = APP_TIMEZONE): string =>
  date.toLocaleDateString('pt-BR', {
    timeZone,
    day: '2-digit',
    month: 'short',
  });

/** Data e hora juntas — usado onde a tela mostra "27/08/2026 14:32". */
export const dataHoraLabel = (date: Date, timeZone: TimeZone = APP_TIMEZONE): string =>
  date.toLocaleString('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  });

/**
 * Um `Intl.DateTimeFormat` por fuso, construído uma vez.
 *
 * Era uma constante de módulo, e o motivo era bom: construir o formatador é a
 * parte cara. Com o fuso vindo da conta a constante não serve mais, mas o
 * motivo continua — daí o cache em vez de um `new` por chamada, que rodaria a
 * cada divisor de dia de uma timeline inteira.
 */
const diaCivilCache = new Map<string, Intl.DateTimeFormat>();
const diaCivilDe = (timeZone: TimeZone): Intl.DateTimeFormat => {
  let fmt = diaCivilCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    diaCivilCache.set(timeZone, fmt);
  }
  return fmt;
};

/**
 * Início do dia civil **no fuso de exibição**, como epoch comparável.
 *
 * Não dá para usar `new Date(y, m, d)`: esse construtor monta a meia-noite do
 * fuso do processo, que em produção é UTC. Uma mensagem das 22h em Brasília já
 * é o dia seguinte em UTC, e o divisor da timeline dizia "Hoje" numa conversa
 * de ontem. Aqui o dia é extraído pelo `Intl` no fuso certo e só então virá
 * número.
 */
export const inicioDoDia = (date: Date, timeZone: TimeZone = APP_TIMEZONE): number => {
  const partes = diaCivilDe(timeZone).formatToParts(date);
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return Date.parse(`${parte('year')}-${parte('month')}-${parte('day')}T00:00:00Z`);
};

/**
 * Hora de uma mensagem, preferindo sempre o instante real ao rótulo gravado.
 *
 * O campo `time` é texto gravado no momento da escrita — e todo rótulo escrito
 * antes desta correção está em UTC. `createdAt` é o instante verdadeiro, então
 * derivar dele conserta o histórico inteiro sem precisar reescrever linha
 * nenhuma no banco. O `time` fica como reserva para mensagens otimistas, que
 * existem na tela antes de o servidor responder.
 */
export const horaDaMensagem = (
  mensagem: {
    readonly createdAt?: string;
    readonly time: string;
  },
  timeZone: TimeZone = APP_TIMEZONE,
): string =>
  mensagem.createdAt ? horaLabel(new Date(mensagem.createdAt), timeZone) : mensagem.time;

/**
 * Partes de um instante no fuso de exibição, para converter nos dois sentidos.
 *
 * `hourCycle: 'h23'` é obrigatório: sem ele o `Intl` devolve `24` para a
 * meia-noite em algumas engines, e `Date.UTC(..., 24, ...)` cai no dia
 * seguinte — um erro de um dia que só aparece à meia-noite.
 */
const PARTES_NO_FUSO = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const partesDe = (date: Date): Readonly<Record<string, number>> => {
  const saida: Record<string, number> = {};
  for (const parte of PARTES_NO_FUSO.formatToParts(date)) {
    if (parte.type !== 'literal') saida[parte.type] = Number(parte.value);
  }
  return saida;
};

/** Deslocamento do fuso de exibição, em ms, naquele instante. */
const deslocamentoDoFuso = (date: Date): number => {
  const p = partesDe(date);
  const comoUtc = Date.UTC(
    p['year'] ?? 1970,
    (p['month'] ?? 1) - 1,
    p['day'] ?? 1,
    p['hour'] ?? 0,
    p['minute'] ?? 0,
    p['second'] ?? 0,
  );
  return comoUtc - date.getTime();
};

/**
 * Converte o valor de um `<input type="datetime-local">` para ISO, lendo-o no
 * **fuso de exibição do produto** — não no do navegador.
 *
 * A distinção não é teórica: o CRM mostra todas as horas em `APP_TIMEZONE`
 * (ver o topo deste arquivo), então quem digita "14:00" para agendar quer as
 * 14:00 que ele vê na timeline. Deixar o navegador interpretar faria uma
 * pessoa em Portugal agendar para as 10:00 de Brasília sem nada na tela
 * explicar o desencontro.
 *
 * O deslocamento é calculado duas vezes de propósito: a primeira usa uma
 * estimativa do instante, e nas viradas de horário de verão a estimativa pode
 * cair do lado errado da mudança. A segunda rodada corrige.
 */
export const isoDeDataHoraLocal = (valor: string): string | null => {
  const casou = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor);
  if (!casou) return null;

  const [, ano, mes, dia, hora, minuto] = casou;
  const comoUtc = Date.UTC(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(minuto));

  let instante = comoUtc - deslocamentoDoFuso(new Date(comoUtc));
  instante = comoUtc - deslocamentoDoFuso(new Date(instante));

  const data = new Date(instante);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
};

/** O caminho inverso: preenche um `<input type="datetime-local">` no fuso do produto. */
export const dataHoraLocalDe = (date: Date): string => {
  const p = partesDe(date);
  const doisDigitos = (valor: number): string => String(valor).padStart(2, '0');
  return (
    `${p['year']}-${doisDigitos(p['month'] ?? 1)}-${doisDigitos(p['day'] ?? 1)}` +
    `T${doisDigitos(p['hour'] ?? 0)}:${doisDigitos(p['minute'] ?? 0)}`
  );
};

/**
 * Rótulo de um agendamento: "hoje às 14:30", "amanhã às 09:00", "12 set. às 08:15".
 *
 * O dia relativo vem antes da data porque é o que responde a pergunta que
 * alguém faz olhando a lista — *quando isso sai?* — sem precisar comparar com o
 * calendário.
 */
export const agendamentoLabel = (date: Date, timeZone: TimeZone = APP_TIMEZONE): string => {
  const dias = Math.round(
    (inicioDoDia(date, timeZone) - inicioDoDia(new Date(), timeZone)) / 86_400_000,
  );
  const hora = horaLabel(date, timeZone);
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã às ${hora}`;
  if (dias === -1) return `ontem às ${hora}`;
  return `${dataCurtaLabel(date, timeZone)} às ${hora}`;
};

/* ==========================================================================
   Formato de data escolhido pela empresa.
   ========================================================================== */

/**
 * Os formatos que a tela de Empresa oferece.
 *
 * Guardado em `AccountSettings.company.dateFormat`. A preferência existia e era
 * gravada desde sempre, e **nenhum formatador a lia**: todas as datas do
 * produto saíam de `toLocaleDateString('pt-BR')` com o padrão fixo, então
 * escolher ISO ou americano não mudava um pixel. Acrescentar o ano de dois
 * dígitos sem isto teria repetido o mesmo vazio.
 */
export const DATE_FORMATS = ['DD/MM/YYYY', 'DD/MM/YY', 'YYYY-MM-DD', 'MM/DD/YYYY'] as const;
export type DateFormatPreference = (typeof DATE_FORMATS)[number];

export const DEFAULT_DATE_FORMAT: DateFormatPreference = 'DD/MM/YYYY';

/** Aceita o que veio do banco (string livre) e devolve um formato conhecido. */
export const asDateFormat = (raw: string | undefined): DateFormatPreference =>
  (DATE_FORMATS as readonly string[]).includes(raw ?? '')
    ? (raw as DateFormatPreference)
    : DEFAULT_DATE_FORMAT;

const OPCOES: Readonly<
  Record<DateFormatPreference, { locale: string; options: Intl.DateTimeFormatOptions }>
> = {
  'DD/MM/YYYY': { locale: 'pt-BR', options: { day: '2-digit', month: '2-digit', year: 'numeric' } },
  'DD/MM/YY': { locale: 'pt-BR', options: { day: '2-digit', month: '2-digit', year: '2-digit' } },
  // `en-CA` é o atalho honesto para ISO 8601: é o único locale cujo formato
  // curto já é `AAAA-MM-DD`, e usá-lo evita montar a string na mão.
  'YYYY-MM-DD': { locale: 'en-CA', options: { day: '2-digit', month: '2-digit', year: 'numeric' } },
  'MM/DD/YYYY': { locale: 'en-US', options: { day: '2-digit', month: '2-digit', year: 'numeric' } },
};

/**
 * Data absoluta no formato que a empresa escolheu.
 *
 * Sempre no fuso de exibição, como todo o resto deste módulo: sem `timeZone` o
 * servidor (UTC) e o navegador imprimiriam dias diferentes na virada da
 * meia-noite, e o React acusaria divergência de hidratação.
 *
 * Vale para **data absoluta**. Hora ("14:32") e rótulo relativo ("há 3 dias")
 * não passam por aqui: não é disso que a preferência trata.
 */
export const formatarData = (
  date: Date,
  formato: DateFormatPreference = DEFAULT_DATE_FORMAT,
  timeZone: TimeZone = APP_TIMEZONE,
): string => {
  const { locale, options } = OPCOES[formato];
  return date.toLocaleDateString(locale, { timeZone, ...options });
};
