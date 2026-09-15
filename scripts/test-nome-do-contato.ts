/**
 * Qual nome a conversa individual mostra.
 *
 * Tranca a ordem do WhatsApp (agenda, depois cadastro, depois perfil) e o
 * defeito que ela corrige: o nome do perfil, que chega em toda mensagem
 * recebida, sobrescrevia o nome salvo e fazia a conversa trocar de nome a cada
 * mensagem do contato.
 *
 * Não usa banco.
 *
 *   npx tsx scripts/test-nome-do-contato.ts
 */
import { nomeDoContato } from '../src/infrastructure/whatsapp/wa-format';

const falhas: string[] = [];
const check = (label: string, obtido: string, esperado: string) => {
  const ok = obtido === esperado;
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${ok ? '' : ` (veio "${obtido}")`}`);
  if (!ok) falhas.push(label);
};

const TELEFONE = '+55 11 99999-0000';

console.log('\nOrdem das fontes');
check(
  'agenda vence cadastro e perfil',
  nomeDoContato({
    agenda: 'João Oficina',
    cadastro: 'João Silva',
    perfil: 'João S.',
    reserva: TELEFONE,
  }),
  'João Oficina',
);
check(
  'sem agenda, o cadastro não é trocado pelo perfil',
  nomeDoContato({ cadastro: 'João Oficina', perfil: 'João Silva', reserva: TELEFONE }),
  'João Oficina',
);
check(
  'sem agenda e sem cadastro, vale o perfil',
  nomeDoContato({ cadastro: '', perfil: 'João Silva', reserva: TELEFONE }),
  'João Silva',
);
check('sem nada, vale a reserva', nomeDoContato({ reserva: TELEFONE }), TELEFONE);

console.log('\nCadastro que não é nome');
check(
  'cadastro com o número formatado aceita o perfil',
  nomeDoContato({ cadastro: TELEFONE, perfil: 'João Silva', reserva: TELEFONE }),
  'João Silva',
);
check(
  'cadastro com nome provisório aceita o perfil',
  nomeDoContato({ cadastro: 'Contato 123456', perfil: 'João Silva', reserva: 'Contato 123456' }),
  'João Silva',
);
check(
  'nome provisório antigo, diferente da reserva atual, também aceita o perfil',
  nomeDoContato({ cadastro: 'Contato 654321', perfil: 'João Silva', reserva: TELEFONE }),
  'João Silva',
);

console.log('\nFontes inválidas');
check(
  'agenda com número é ignorada',
  nomeDoContato({ agenda: '5511999990000', cadastro: 'João Oficina', reserva: TELEFONE }),
  'João Oficina',
);
check(
  'perfil mascarado cai na reserva',
  nomeDoContato({ perfil: '•••', reserva: TELEFONE }),
  TELEFONE,
);
check(
  'espaços nas pontas são removidos',
  nomeDoContato({ agenda: '  Maria  ', reserva: TELEFONE }),
  'Maria',
);

console.log('\nMensagem enviada por nós');
check(
  'sem perfil, agenda continua valendo',
  nomeDoContato({ agenda: 'João Oficina', cadastro: 'João Silva', reserva: TELEFONE }),
  'João Oficina',
);

if (falhas.length > 0) {
  console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
  process.exit(1);
}
console.log('\nTodos os testes de nome passaram.');
