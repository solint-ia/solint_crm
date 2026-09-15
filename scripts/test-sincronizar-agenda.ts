/**
 * Sincronização da agenda do WhatsApp com o cadastro de contatos.
 *
 * Tranca os defeitos que faziam o nome salvo no celular não chegar ao CRM:
 * cadastro gravado com o nono dígito e agenda sem ele (ou o contrário), e
 * cadastro duplicado em que só a primeira linha encontrada era renomeada.
 *
 * Roda só em PostgreSQL descartável no localhost. As contas são criadas aqui e
 * apagadas no final.
 *
 *   npx tsx scripts/test-sincronizar-agenda.ts
 */
import { randomUUID } from 'node:crypto';
import { prisma, asJson } from '../src/infrastructure/db/prisma';
import {
  aplicarAgendaNosContatos,
  variantesDoTelefone,
} from '../src/infrastructure/whatsapp/wa-contact-sync';

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
if (database.hostname !== 'localhost' && database.hostname !== '127.0.0.1') {
  throw new Error('Este teste só roda em PostgreSQL descartável no localhost.');
}

const sufixo = randomUUID().slice(0, 8);
const accountId = `acc-sync-${sufixo}`;
const outraConta = `acc-sync-outra-${sufixo}`;

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

const criarContato = (conta: string, id: string, name: string, phone: string, kind = 'pessoa') =>
  prisma.contact.create({
    data: {
      id,
      accountId: conta,
      name,
      phone,
      channel: 'whatsapp',
      avatarTone: 'blue',
      kind,
      customFields: asJson([]),
      timeline: asJson([]),
    },
  });

const nomeDe = async (id: string) =>
  (await prisma.contact.findUnique({ where: { id }, select: { name: true } }))?.name;

async function main() {
  console.log('\n1) Variantes do telefone');
  check(
    'com o 9 gera a forma sem o 9',
    variantesDoTelefone('5579999990001').includes('557999990001'),
  );
  check(
    'sem o 9 gera a forma com o 9',
    variantesDoTelefone('557999990001').includes('5579999990001'),
  );
  check('número de fora do Brasil fica como está', variantesDoTelefone('14155550100').length === 1);

  for (const id of [accountId, outraConta]) {
    await prisma.account.create({ data: { id, name: `Agenda ${id}`, plan: 'starter' } });
  }

  try {
    const wess = `ct-wess-${sufixo}`;
    const dup1 = `ct-dup1-${sufixo}`;
    const dup2 = `ct-dup2-${sufixo}`;
    const grupo = `ct-grupo-${sufixo}`;
    const deOutraConta = `ct-outra-${sufixo}`;
    await criarContato(accountId, wess, 'wess', '+5579999990001');
    await criarContato(accountId, dup1, 'Perfil A', '+5511988880002');
    await criarContato(accountId, dup2, 'Perfil B', '+5511988880002');
    await criarContato(accountId, grupo, 'Grupo', '+5511988880002', 'grupo');
    await criarContato(outraConta, deOutraConta, 'wess', '+5579999990001');

    console.log('\n2) Primeira sincronização');
    const entradas = [
      { phoneDigits: '557999990001', addressBookName: 'amor' },
      { phoneDigits: '5511988880002', addressBookName: 'Fornecedor' },
      { phoneDigits: '5511977770003', addressBookName: 'Novo da agenda' },
      { phoneDigits: '5511966660004', pushName: 'Só passou num grupo' },
      { phoneDigits: '5511955550005', pushName: 'Cliente atendido' },
    ];
    const primeira = await aplicarAgendaNosContatos(
      accountId,
      entradas,
      new Set(['5511955550005']),
    );

    check('agenda sem o 9 renomeia cadastro com o 9', (await nomeDe(wess)) === 'amor');
    check(
      'todos os cadastros duplicados recebem o nome da agenda',
      (await nomeDe(dup1)) === 'Fornecedor' && (await nomeDe(dup2)) === 'Fornecedor',
    );
    check('grupo com o mesmo telefone não é renomeado', (await nomeDe(grupo)) === 'Grupo');
    check('contato de outra conta não é renomeado', (await nomeDe(deOutraConta)) === 'wess');
    check(
      'contato da agenda que não existia é criado com o nome salvo',
      (await nomeDe(`ct-wa-${accountId}-5511977770003`)) === 'Novo da agenda',
    );
    check(
      'quem só passou num grupo não vira contato',
      (await prisma.contact.count({ where: { accountId, phone: '+5511966660004' } })) === 0,
    );
    check(
      'quem tem conversa direta vira contato com o nome do perfil',
      (await nomeDe(`ct-wa-${accountId}-5511955550005`)) === 'Cliente atendido',
    );
    check(
      'contagem: 4 conferidos, 2 criados, 3 renomeados, 0 falhas',
      primeira.synced === 4 &&
        primeira.created === 2 &&
        primeira.renamed === 3 &&
        primeira.failed === 0,
      JSON.stringify(primeira),
    );

    console.log('\n3) Sincronizar de novo');
    const segunda = await aplicarAgendaNosContatos(accountId, entradas, new Set(['5511955550005']));
    check(
      'nada é criado nem renomeado outra vez',
      segunda.created === 0 && segunda.renamed === 0 && segunda.failed === 0,
      JSON.stringify(segunda),
    );
  } finally {
    await prisma.account.deleteMany({ where: { id: { in: [accountId, outraConta] } } });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (falhas.length > 0) {
      console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
      process.exit(1);
    }
    console.log('\nTodos os testes de sincronização da agenda passaram.');
  })
  .catch(async (erro) => {
    console.error('Erro no teste:', erro);
    await prisma.$disconnect();
    process.exit(1);
  });
