/**
 * Teste do fuso de exibição.
 *
 * O bug original só aparecia em produção, porque só lá o processo roda em UTC:
 * na máquina do time o relógio já era o de Brasília e o rótulo saía certo por
 * acidente. Por isso este teste é rodado com `TZ=UTC` — ele reproduz o servidor,
 * não a bancada. Rodá-lo no fuso local não prova nada.
 */
import { buildTimeline } from '../src/infrastructure/repositories/prisma/mappers';
import {
  APP_TIMEZONE,
  dataCurtaLabel,
  horaDaMensagem,
  horaLabel,
  inicioDoDia,
} from '../src/lib/datetime';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas.push(label);
};

/** Linha de mensagem mínima, no formato que `buildTimeline` recebe do Prisma. */
const linha = (id: string, createdAt: Date, time = '00:00') =>
  ({
    id,
    conversationId: 'cv-1',
    author: 'contact',
    authorName: null,
    contentType: 'text',
    content: { type: 'text', text: 'oi' },
    time,
    createdAt,
    deliveryStatus: null,
    isPrivate: false,
    replyToId: null,
    externalId: null,
    origin: null,
  }) as never;

function main() {
  console.log(`\nTZ do processo: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(`APP_TIMEZONE:   ${APP_TIMEZONE}`);

  const tzProcesso = Intl.DateTimeFormat().resolvedOptions().timeZone;
  check('processo esta em UTC (rode com TZ=UTC)', tzProcesso === 'UTC', tzProcesso);

  console.log('\n1) A hora exibida e a de Brasilia, nao a do servidor');
  // 13:55Z é 10:55 em Brasília — exatamente o caso relatado pelo usuário.
  const instante = new Date('2026-08-27T13:55:47.000Z');
  check('13:55Z vira 10:55', horaLabel(instante) === '10:55', horaLabel(instante));

  // Meio-dia UTC continua sendo 09:00: a diferença é constante o ano todo,
  // porque o Brasil não usa mais horário de verão desde 2019.
  check(
    '12:00Z vira 09:00',
    horaLabel(new Date('2026-01-15T12:00:00.000Z')) === '09:00',
    horaLabel(new Date('2026-01-15T12:00:00.000Z')),
  );
  check(
    'janeiro e agosto tem o mesmo deslocamento (sem horario de verao)',
    horaLabel(new Date('2026-01-15T12:00:00.000Z')) ===
      horaLabel(new Date('2026-08-15T12:00:00.000Z')),
  );

  console.log('\n2) A virada do dia respeita o fuso, nao o UTC');
  // 23:30 em Brasília é 02:30Z do dia seguinte. O dia civil tem de ser o 27.
  const noite = new Date('2026-08-28T02:30:00.000Z');
  const manha = new Date('2026-08-27T13:00:00.000Z');
  check(
    '22:30 e 10:00 do mesmo dia local caem no mesmo dia civil',
    inicioDoDia(noite) === inicioDoDia(manha),
    `${new Date(inicioDoDia(noite)).toISOString()} vs ${new Date(inicioDoDia(manha)).toISOString()}`,
  );
  check('rotulo curto usa o dia local', dataCurtaLabel(noite).startsWith('27'), dataCurtaLabel(noite));

  console.log('\n3) A timeline nao inventa um divisor de dia no meio da noite');
  const agora = new Date('2026-08-28T12:00:00.000Z'); // 09:00 local do dia 28
  const itens = buildTimeline([linha('m1', manha), linha('m2', noite)], agora);
  const divisores = itens.filter((i) => i.kind === 'divider');
  check(
    'as duas mensagens do dia 27 ficam sob um unico divisor',
    divisores.length === 1,
    `${divisores.length} divisor(es): ${divisores.map((d) => (d as { label: string }).label).join(', ')}`,
  );
  check(
    'e esse divisor diz "Ontem"',
    divisores[0] !== undefined && (divisores[0] as { label: string }).label === 'Ontem',
    (divisores[0] as { label: string } | undefined)?.label ?? '-',
  );

  console.log('\n4) Mensagens de dias diferentes ainda sao separadas');
  const doisDias = buildTimeline(
    [linha('m1', new Date('2026-08-26T15:00:00.000Z')), linha('m2', manha)],
    agora,
  );
  check(
    'dois dias, dois divisores',
    doisDias.filter((i) => i.kind === 'divider').length === 2,
    `${doisDias.filter((i) => i.kind === 'divider').length}`,
  );

  console.log('\n5) O historico antigo e corrigido sem reescrever o banco');
  // Rótulo gravado errado (UTC) + instante certo: a tela tem de mostrar o certo.
  check(
    'createdAt vence o rotulo gravado em UTC',
    horaDaMensagem({ createdAt: instante.toISOString(), time: '13:55' }) === '10:55',
    horaDaMensagem({ createdAt: instante.toISOString(), time: '13:55' }),
  );
  check(
    'sem createdAt, o rotulo ainda serve (mensagem otimista)',
    horaDaMensagem({ time: '10:55' }) === '10:55',
  );

  console.log('\n6) Servidor e navegador produzem o mesmo texto (hidratacao)');
  // Se o resultado dependesse do relógio do processo, estes dois rodariam
  // diferente no servidor e no cliente e o React acusaria divergência.
  const comoNoServidor = horaLabel(instante);
  const comoNoCliente = instante.toLocaleTimeString('pt-BR', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
  check('mesmo texto dos dois lados', comoNoServidor === comoNoCliente, comoNoServidor);
}

main();
console.log(
  falhas.length === 0
    ? '\nTodos os testes passaram.\n'
    : `\n${falhas.length} falha(s): ${falhas.join(', ')}\n`,
);
process.exit(falhas.length === 0 ? 0 : 1);
