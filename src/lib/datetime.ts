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

/** Rótulo de hora ("14:32") no fuso de exibição. */
export const horaLabel = (date: Date): string =>
  date.toLocaleTimeString('pt-BR', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });

/** Rótulo curto de data ("27 de ago." → "27 ago.") no fuso de exibição. */
export const dataCurtaLabel = (date: Date): string =>
  date.toLocaleDateString('pt-BR', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
  });

/** Data e hora juntas — usado onde a tela mostra "27/08/2026 14:32". */
export const dataHoraLabel = (date: Date): string =>
  date.toLocaleString('pt-BR', {
    timeZone: APP_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });

const DIA_CIVIL = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Início do dia civil **no fuso de exibição**, como epoch comparável.
 *
 * Não dá para usar `new Date(y, m, d)`: esse construtor monta a meia-noite do
 * fuso do processo, que em produção é UTC. Uma mensagem das 22h em Brasília já
 * é o dia seguinte em UTC, e o divisor da timeline dizia "Hoje" numa conversa
 * de ontem. Aqui o dia é extraído pelo `Intl` no fuso certo e só então virá
 * número.
 */
export const inicioDoDia = (date: Date): number => {
  const partes = DIA_CIVIL.formatToParts(date);
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
export const horaDaMensagem = (mensagem: {
  readonly createdAt?: string;
  readonly time: string;
}): string => (mensagem.createdAt ? horaLabel(new Date(mensagem.createdAt)) : mensagem.time);

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
export const agendamentoLabel = (date: Date): string => {
  const dias = Math.round((inicioDoDia(date) - inicioDoDia(new Date())) / 86_400_000);
  const hora = horaLabel(date);
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã às ${hora}`;
  if (dias === -1) return `ontem às ${hora}`;
  return `${dataCurtaLabel(date)} às ${hora}`;
};
