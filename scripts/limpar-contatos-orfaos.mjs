/**
 * Remove os contatos que a sincronização do WhatsApp criou por engano.
 *
 * **O que aconteceu.** A varredura em massa (`syncAllStoredContacts`) percorria
 * o `contactsStore` inteiro, que não é a agenda: é tudo que a sessão já viu —
 * inclusive todo participante de todo grupo de que a conta faz parte. Uma base
 * de 500 contatos virou 2000. A causa está corrigida no código; este script
 * trata o que já entrou no banco.
 *
 * **O critério.** Apaga contato de origem WhatsApp (`ct-wa-*`) que não tem
 * conversa nenhuma. É o corte grosseiro, escolhido de propósito: leva junto
 * contatos legítimos da agenda com quem ainda não se conversou, e eles voltam
 * na próxima sincronização se ainda estiverem salvos no aparelho.
 *
 * **O que ele nunca toca**, porque nada disso nasce de sincronização:
 *
 *   - grupos (`kind = 'grupo'`), que também usam o prefixo `ct-wa-`;
 *   - contatos criados à mão ou por importação, cujo id é `ct-<base36>`;
 *   - qualquer contato com conversa, etiqueta, negócio ou disparo de campanha
 *     — sinais de que alguém trabalhou aquele registro.
 *
 * Uso:
 *   node --env-file=.env scripts/limpar-contatos-orfaos.mjs           (simula)
 *   node --env-file=.env scripts/limpar-contatos-orfaos.mjs --apagar  (executa)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const APAGAR = process.argv.includes('--apagar');

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DIRECT_URL ou DATABASE_URL. Rode com: node --env-file=.env');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const main = async () => {
  // Os contatos que alguma outra parte do sistema referencia. Um `id` que
  // aparece aqui foi trabalhado por alguém e não é resíduo de sincronização.
  const [comNegocio, comCampanha] = await Promise.all([
    prisma.deal.findMany({ where: { contactId: { not: null } }, select: { contactId: true } }),
    prisma.campaignRecipient.findMany({
      where: { contactId: { not: null } },
      select: { contactId: true },
    }),
  ]);

  const intocaveis = new Set(
    [...comNegocio, ...comCampanha].map((linha) => linha.contactId).filter(Boolean),
  );

  const candidatos = await prisma.contact.findMany({
    where: {
      id: { startsWith: 'ct-wa-' },
      // Grupos compartilham o prefixo (`ct-wa-<conta>-g-<numero>`) e não vêm da
      // varredura de contatos: são sincronizados à parte, de propósito.
      kind: { not: 'grupo' },
      conversations: { none: {} },
      labels: { none: {} },
    },
    select: { id: true, name: true, phone: true, accountId: true },
    orderBy: { name: 'asc' },
  });

  const alvos = candidatos.filter((contato) => !intocaveis.has(contato.id));

  const total = await prisma.contact.count({ where: { kind: { not: 'grupo' } } });
  const preservadosPorVinculo = candidatos.length - alvos.length;

  console.log(`Contatos (pessoas) na base ....... ${total}`);
  console.log(`Sem conversa, origem WhatsApp .... ${candidatos.length}`);
  if (preservadosPorVinculo > 0) {
    console.log(`  preservados (negócio/campanha) . ${preservadosPorVinculo}`);
  }
  console.log(`A apagar ......................... ${alvos.length}`);
  console.log(`Restariam ........................ ${total - alvos.length}`);

  if (alvos.length > 0) {
    console.log('\nAmostra dos que seriam apagados:');
    for (const contato of alvos.slice(0, 15)) {
      console.log(`  ${contato.name} — ${contato.phone || '(sem telefone)'}`);
    }
    if (alvos.length > 15) console.log(`  ... e mais ${alvos.length - 15}.`);
  }

  if (!APAGAR) {
    console.log('\nSimulação. Nada foi alterado.');
    console.log('Para executar de verdade: acrescente --apagar ao comando.');
    return;
  }

  if (alvos.length === 0) {
    console.log('\nNada a apagar.');
    return;
  }

  // Em blocos: um `IN` com milhares de ids estoura o limite de parâmetros do
  // Postgres, e uma transação única desse tamanho segura a tabela sem motivo.
  const LOTE = 500;
  let apagados = 0;
  for (let i = 0; i < alvos.length; i += LOTE) {
    const ids = alvos.slice(i, i + LOTE).map((contato) => contato.id);
    const { count } = await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    apagados += count;
    console.log(`  apagados ${apagados}/${alvos.length}...`);
  }

  console.log(`\nPronto: ${apagados} contato(s) removido(s).`);
  console.log('Rode "Sincronizar WhatsApp" em Contatos para repovoar a agenda real.');
};

main()
  .catch((erro) => {
    console.error('Falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
