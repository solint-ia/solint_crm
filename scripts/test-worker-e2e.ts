/**
 * Teste de ponta a ponta do motor `worker`, sem passar pela interface.
 *
 * Verifica as tres pecas novas que a tela depende:
 *   1. presenca — a aplicacao enxerga a batida do worker;
 *   2. recusa honesta — sem worker, o canal diz o porque em vez de esperar;
 *   3. fila — um comando enfileirado e acordado por NOTIFY e consumido.
 *
 * Roda contra o banco real. Usa o comando `read` de proposito: ele nao toca no
 * WhatsApp, entao o teste exercita o transporte sem depender de uma sessao
 * pareada nem arriscar a conexao de ninguem.
 */
import { prisma } from '../src/infrastructure/db/prisma';
import { QueueWhatsAppChannel } from '../src/infrastructure/whatsapp/queue-channel';
import { waitForWorker, workerPresence } from '../src/infrastructure/whatsapp/worker-presence';

const line = (label: string, ok: boolean, detail = '') =>
  console.log(`  ${ok ? 'OK  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail = '') => {
    line(label, ok, detail);
    if (!ok) failures.push(label);
  };

  const inbox = await prisma.inbox.findFirst({
    where: { channel: 'whatsapp' },
    select: { id: true, accountId: true },
  });
  if (!inbox) throw new Error('Nenhuma caixa de WhatsApp no banco para testar.');

  const channel = new QueueWhatsAppChannel();

  console.log('\n1) Presenca do worker');
  const online = await waitForWorker(8000);
  check('batida do worker detectada', online, `workerId=${workerPresence().workerId ?? '-'}`);

  console.log('\n2) Status pelo canal de fila');
  const status = await channel.getStatus(inbox.accountId);
  if (online) {
    check('status reportado', status.status !== undefined, `status=${status.status}`);
    check('caixa identificada no payload', status.inboxId === inbox.id, `inboxId=${status.inboxId}`);
  } else {
    check(
      'sem worker, o canal recusa com motivo',
      status.status === 'desconectado' && Boolean(status.error),
      status.error ?? '(sem mensagem)',
    );
  }

  if (!online) {
    console.log('\nWorker fora do ar: o teste da fila precisa dele. Rode `npm run worker`.');
    return failures;
  }

  console.log('\n3) Fila: enfileirar, acordar por NOTIFY e consumir');
  const before = Date.now();
  await channel.markRead(inbox.accountId, 'cv-teste-inexistente');

  const command = await prisma.whatsAppCommand.findFirst({
    where: { inboxId: inbox.id, kind: 'read' },
    orderBy: { createdAt: 'desc' },
  });
  check('comando gravado na fila', Boolean(command), command?.id ?? '-');
  if (!command) return failures;

  let final = command;
  // A varredura de seguranca roda a cada 15s; se o comando terminar bem antes
  // disso, foi o NOTIFY que o acordou — que e exatamente o que se quer provar.
  for (let i = 0; i < 40 && final.status !== 'completed' && final.status !== 'failed'; i += 1) {
    await sleep(250);
    final =
      (await prisma.whatsAppCommand.findUnique({ where: { id: command.id } })) ?? final;
  }

  const elapsed = Date.now() - before;
  check('comando consumido pelo worker', final.status === 'completed', `status=${final.status}`);
  check(
    'acordado pelo aviso, nao pela varredura',
    final.status === 'completed' && elapsed < 10_000,
    `${elapsed}ms (varredura roda a cada 15000ms)`,
  );

  await prisma.whatsAppCommand.delete({ where: { id: command.id } }).catch(() => undefined);
  return failures;
}

main()
  .then(async (failures) => {
    console.log(
      failures.length === 0
        ? '\nTodos os testes passaram.\n'
        : `\n${failures.length} teste(s) falharam: ${failures.join(', ')}\n`,
    );
    await prisma.$disconnect();
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('\nErro no teste:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
