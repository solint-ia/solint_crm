/**
 * Nomes da agenda do WhatsApp guardados no banco.
 *
 * Tranca o que faz o nome salvo no celular sobreviver a um reinício do worker:
 * gravar em lote sem duplicar, trocar só o que mudou, ignorar o que não é nome
 * e nunca misturar a agenda de um número com a de outro.
 *
 * Roda só em PostgreSQL descartável no localhost. Tudo acontece numa conta
 * criada aqui e apagada no final.
 *
 *   npx tsx scripts/test-agenda-persistida.ts
 */
import { randomUUID } from 'node:crypto';
import { defaultBusinessHours } from '../src/core/domain/business-hours';
import { prisma, asJson } from '../src/infrastructure/db/prisma';
import {
  loadAddressBookNames,
  saveAddressBookNames,
} from '../src/infrastructure/whatsapp/wa-address-book';

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
if (database.hostname !== 'localhost' && database.hostname !== '127.0.0.1') {
  throw new Error('Este teste só roda em PostgreSQL descartável no localhost.');
}

const sufixo = randomUUID().slice(0, 8);
const accountId = `acc-agenda-${sufixo}`;
const inboxA = `ibx-agenda-a-${sufixo}`;
const inboxB = `ibx-agenda-b-${sufixo}`;
/** Números improváveis de existir de verdade. */
const DONO = '5599900000001@s.whatsapp.net';
const OUTRO_DONO = '5599900000002@s.whatsapp.net';

const falhas: string[] = [];
const check = (label: string, ok: boolean, detalhe = '') => {
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${label}${detalhe ? ` (${detalhe})` : ''}`);
  if (!ok) falhas.push(label);
};

const criarCaixa = (id: string) =>
  prisma.inbox.create({
    data: {
      id,
      accountId,
      name: `Caixa ${id}`,
      channel: 'whatsapp',
      identifier: DONO,
      status: 'conectado',
      provider: 'baileys',
      businessHours: asJson(defaultBusinessHours()),
      awayMessage: asJson({ enabled: false, message: '' }),
      greeting: asJson({ enabled: false, message: '' }),
    },
  });

const nomes = async (inboxId: string, ownerJid: string) =>
  new Map(
    (await loadAddressBookNames({ accountId, inboxId, ownerJid })).map((row) => [
      row.jid,
      row.name,
    ]),
  );

async function main() {
  await prisma.account.create({
    data: { id: accountId, name: `Agenda ${sufixo}`, plan: 'starter' },
  });
  await criarCaixa(inboxA);
  await criarCaixa(inboxB);
  const escopo = { accountId, inboxId: inboxA, ownerJid: DONO };

  try {
    console.log('\n1) Primeira gravação');
    const primeira = await saveAddressBookNames(escopo, [
      { jid: '5511911110001@s.whatsapp.net', name: 'João Oficina' },
      { jid: '5511911110002@s.whatsapp.net', name: '  Maria Contabilidade ' },
      { jid: '5511911110003@s.whatsapp.net', name: '+55 11 91111-0003' },
      { jid: '5511911110004@s.whatsapp.net', name: '•••' },
      { jid: '5511911110005@s.whatsapp.net', name: 'Nome antigo' },
      { jid: '5511911110005@s.whatsapp.net', name: 'Nome mais novo' },
    ]);
    check(
      'grava só nomes utilizáveis, um por contato',
      primeira.created === 3,
      `criados=${primeira.created}`,
    );
    const atual = await nomes(inboxA, DONO);
    check(
      'nome salvo volta do banco',
      atual.get('5511911110001@s.whatsapp.net') === 'João Oficina',
    );
    check(
      'espaços nas pontas são removidos',
      atual.get('5511911110002@s.whatsapp.net') === 'Maria Contabilidade',
    );
    check('número no lugar do nome não é gravado', !atual.has('5511911110003@s.whatsapp.net'));
    check('número mascarado não é gravado', !atual.has('5511911110004@s.whatsapp.net'));
    check(
      'no mesmo lote, o último nome vence',
      atual.get('5511911110005@s.whatsapp.net') === 'Nome mais novo',
    );

    console.log('\n2) Regravação');
    const igual = await saveAddressBookNames(escopo, [
      { jid: '5511911110001@s.whatsapp.net', name: 'João Oficina' },
    ]);
    check('mesmo nome não escreve nada', igual.created === 0 && igual.updated === 0);
    const troca = await saveAddressBookNames(escopo, [
      { jid: '5511911110001@s.whatsapp.net', name: 'João da Oficina' },
    ]);
    const depois = await nomes(inboxA, DONO);
    check(
      'nome alterado no celular é atualizado',
      troca.updated === 1 && depois.get('5511911110001@s.whatsapp.net') === 'João da Oficina',
    );

    console.log('\n3) Isolamento');
    check(
      'outro número pareado na mesma caixa não herda a agenda',
      (await nomes(inboxA, OUTRO_DONO)).size === 0,
    );
    check('outra caixa não enxerga a agenda', (await nomes(inboxB, DONO)).size === 0);
    const deOutraConta = await loadAddressBookNames({
      accountId: `acc-outra-${sufixo}`,
      inboxId: inboxA,
      ownerJid: DONO,
    });
    check('outra conta não enxerga a agenda', deOutraConta.length === 0);

    console.log('\n4) Agenda grande');
    const grande = Array.from({ length: 1_200 }, (_, i) => ({
      jid: `55119220${String(i).padStart(5, '0')}@s.whatsapp.net`,
      name: `Contato ${i}`,
    }));
    const lote = await saveAddressBookNames({ ...escopo, inboxId: inboxB }, grande);
    check('1.200 nomes gravados em lotes', lote.created === 1_200, `criados=${lote.created}`);
    const reenvio = await saveAddressBookNames({ ...escopo, inboxId: inboxB }, grande);
    check(
      'reenviar a agenda inteira não escreve nada',
      reenvio.created === 0 && reenvio.updated === 0,
    );

    console.log('\n5) Exclusão');
    await prisma.inbox.delete({ where: { id: inboxB } });
    const daCaixa = await prisma.whatsAppAddressBookName.count({
      where: { accountId, inboxId: inboxB },
    });
    check('apagar a caixa leva a agenda junto', daCaixa === 0);
  } finally {
    await prisma.account.delete({ where: { id: accountId } }).catch(() => undefined);
  }

  const sobras = await prisma.whatsAppAddressBookName.count({ where: { accountId } });
  check('apagar a conta leva a agenda junto', sobras === 0);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    if (falhas.length > 0) {
      console.error(`\n${falhas.length} falha(s): ${falhas.join('; ')}`);
      process.exit(1);
    }
    console.log('\nTodos os testes da agenda passaram.');
  })
  .catch(async (erro) => {
    console.error('Erro no teste:', erro);
    await prisma.$disconnect();
    process.exit(1);
  });
