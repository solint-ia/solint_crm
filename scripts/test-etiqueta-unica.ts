/**
 * Uma etiqueta por conversa e por contato.
 *
 * Tranca as duas regras puras da mudança:
 *  - `singleLabel`: escolher outra etiqueta substitui a anterior, e o conjunto
 *    inteiro que uma aba antiga ainda manda vira só a escolha nova;
 *  - `contactLabelsAfterMove`: arrastar o card para uma etapa com etiqueta deixa
 *    o contato só com ela.
 *
 * Funções puras, sem banco:
 *
 *   npx tsx scripts/test-etiqueta-unica.ts
 */
import { singleLabel } from '../src/core/domain/label';
import { contactLabelsAfterMove, type Pipeline } from '../src/core/domain/pipeline';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

const ids = (labels: readonly { readonly id: string }[]) =>
  labels.map((label) => label.id).join(',');
const et = (id: string) => ({ id });

console.log('\n1) singleLabel');
check('nenhuma continua nenhuma', ids(singleLabel(['a'], [])) === '');
check('uma continua uma', ids(singleLabel([], [et('a')])) === 'a');
check(
  'a nova substitui a anterior',
  ids(singleLabel(['a'], [et('a'), et('b')])) === 'b',
  ids(singleLabel(['a'], [et('a'), et('b')])),
);
check(
  'a nova vence mesmo vindo antes na lista',
  ids(singleLabel(['b'], [et('a'), et('b')])) === 'a',
  ids(singleLabel(['b'], [et('a'), et('b')])),
);
check(
  'sem nova, fica a última',
  ids(singleLabel(['a', 'b'], [et('a'), et('b')])) === 'b',
  ids(singleLabel(['a', 'b'], [et('a'), et('b')])),
);

console.log('\n2) contactLabelsAfterMove');
const funil: Pipeline = {
  id: 'p1',
  accountId: 'acc',
  name: 'Vendas',
  isDefault: true,
  stages: [
    {
      id: 's1',
      pipelineId: 'p1',
      name: 'Novo',
      order: 0,
      color: '',
      isWon: false,
      isLost: false,
      conversionWeight: 0,
      labelId: 'novo',
    },
    {
      id: 's2',
      pipelineId: 'p1',
      name: 'Proposta',
      order: 1,
      color: '',
      isWon: false,
      isLost: false,
      conversionWeight: 0,
      labelId: 'proposta',
    },
    {
      id: 's3',
      pipelineId: 'p1',
      name: 'Sem etiqueta',
      order: 2,
      color: '',
      isWon: false,
      isLost: false,
      conversionWeight: 0,
    },
  ],
} as unknown as Pipeline;

check(
  'destino com etiqueta deixa só ela',
  contactLabelsAfterMove(funil, 's2', ['novo', 'vip']).join(',') === 'proposta',
  contactLabelsAfterMove(funil, 's2', ['novo', 'vip']).join(','),
);
check(
  'destino sem etiqueta tira a deste funil',
  contactLabelsAfterMove(funil, 's3', ['novo']).join(',') === '',
);
check(
  'destino sem etiqueta preserva a de fora do funil',
  contactLabelsAfterMove(funil, 's3', ['vip']).join(',') === 'vip',
);

if (falhas.length > 0) {
  console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
  process.exit(1);
}
console.log('\nTodos os testes de etiqueta única passaram.');
