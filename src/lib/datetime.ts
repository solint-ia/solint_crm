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
