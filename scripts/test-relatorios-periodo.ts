/**
 * Recorte de período e comparação dos relatórios.
 *
 * Tranca três defeitos da auditoria de métricas:
 *  - o dia cortado no fuso do servidor (UTC) em vez do fuso da conta;
 *  - a comparação que mostrava queda de 100% quando um período não tinha nota;
 *  - a taxa comparada em porcentagem relativa em vez de pontos.
 *
 * Funções puras, sem banco:
 *
 *   npx tsx scripts/test-relatorios-periodo.ts
 */
import { bucketIndexOf, periodRangeLabel, periodWindow } from '../src/core/domain/analytics-period';
import { compareRow, formatComparisonValue } from '../src/core/domain/analytics';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

const SP = 'America/Sao_Paulo';

console.log('\n1) "Hoje" no fuso da conta');
// 15/09/2026 01:30 em UTC = 14/09/2026 22:30 em Brasília.
const madrugadaUtc = new Date('2026-09-15T01:30:00Z');
const hoje = periodWindow('hoje', madrugadaUtc, SP);
check(
  'começa à meia-noite de Brasília (03:00 UTC)',
  hoje.from.toISOString() === '2026-09-14T03:00:00.000Z',
  hoje.from.toISOString(),
);
check(
  'um balde por hora já passada (0h a 22h)',
  hoje.buckets.length === 23,
  `${hoje.buckets.length}`,
);
check(
  'ontem começa 24h antes',
  hoje.previousFrom.toISOString() === '2026-09-13T03:00:00.000Z',
  hoje.previousFrom.toISOString(),
);
check(
  'mensagem das 22h de Brasília cai no balde 22h',
  hoje.buckets[bucketIndexOf(hoje, new Date('2026-09-15T01:10:00Z'))]?.label === '22h',
);

console.log('\n2) Sete dias');
const semana = periodWindow('7d', new Date('2026-09-15T12:00:00Z'), SP);
check('sete baldes', semana.buckets.length === 7);
check(
  'primeiro dia é 09/09 à meia-noite de Brasília',
  semana.from.toISOString() === '2026-09-09T03:00:00.000Z',
  semana.from.toISOString(),
);
check(
  'último balde é terça (15/09/2026)',
  semana.buckets[6]?.label === 'Ter',
  semana.buckets[6]?.label,
);
check(
  'conversa das 23h de 14/09 em Brasília fica em 14/09 (segunda)',
  semana.buckets[bucketIndexOf(semana, new Date('2026-09-15T02:00:00Z'))]?.label === 'Seg',
);
check(
  'baldes contíguos, sem buraco nem sobreposição',
  semana.buckets.every(
    (bucket, i) => i === 0 || bucket.from.getTime() === semana.buckets[i - 1]?.to.getTime(),
  ),
);

console.log('\n3) Este mês e rótulo das datas');
const mes = periodWindow('mes', new Date('2026-09-15T12:00:00Z'), SP);
check('15 dias no dia 15', mes.buckets.length === 15);
check(
  'rótulo do período',
  periodRangeLabel(mes.from, mes.to, SP) === '01/09/2026 a 15/09/2026',
  periodRangeLabel(mes.from, mes.to, SP),
);
check('um dia só vira uma data', periodRangeLabel(hoje.from, hoje.to, SP) === '14/09/2026');
check(
  'virada de mês no 30 dias',
  periodWindow('30d', new Date('2026-09-15T12:00:00Z'), SP).buckets[0]?.label === '17/08',
);

console.log('\n4) Comparação');
const csatSemNota = compareRow({
  id: 'csat',
  label: 'CSAT',
  current: 0,
  previous: 4.5,
  currentMissing: true,
});
check(
  'período sem nota não vira queda de 100%',
  csatSemNota.label === 'sem base' && csatSemNota.direction === 'neutro',
);
check(
  'lado sem base aparece como travessão',
  formatComparisonValue(
    { id: 'x', label: 'x', current: 0, previous: 1, currentMissing: true },
    'current',
  ) === '—',
);
const taxa = compareRow({
  id: 't',
  label: 'Taxa',
  current: 50,
  previous: 40,
  format: 'percentual',
});
check(
  'taxa varia em pontos percentuais',
  taxa.label === '+10 p.p.' && taxa.direction === 'positivo',
  taxa.label,
);
const tmr = compareRow({
  id: 'tmr',
  label: 'TMR',
  current: 60,
  previous: 120,
  lowerIsBetter: true,
  format: 'duracao',
});
check('tempo de resposta caindo é positivo', tmr.direction === 'positivo', tmr.label);
check(
  'duração formatada',
  formatComparisonValue(
    { id: 'tmr', label: 'TMR', current: 125, previous: 0, format: 'duracao' },
    'current',
  ) === '2m 05s',
);

if (falhas.length > 0) {
  console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
  process.exit(1);
}
console.log('\nTodos os testes de período e comparação passaram.');
