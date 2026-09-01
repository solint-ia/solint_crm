/**
 * Corrige nomes de contatos que são apenas o telefone (inteiro ou mascarado).
 *
 * Uso:
 *   node --env-file=.env scripts/limpar-nomes-contatos-whatsapp.mjs
 *   node --env-file=.env scripts/limpar-nomes-contatos-whatsapp.mjs --aplicar
 *
 * Sem `--aplicar`, apenas mostra o diagnóstico. Contatos e históricos nunca
 * são apagados; somente `Contact.name` pode voltar ao telefone formatado.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const APLICAR = process.argv.includes('--aplicar');
const MASCARA_DE_NUMERO = /[∙•·‧・･*]/;
const SOMENTE_NUMERO = /^\+?[0-9\s().-]{6,}$/;

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DIRECT_URL ou DATABASE_URL. Rode com: node --env-file=.env');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const formatarTelefone = (raw) => {
  const digits = raw.replace(/[^\d+]/g, '');
  const normalized = digits.startsWith('+') ? digits : `+${digits}`;
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(normalized);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : normalized;
};

const main = async () => {
  const contatos = await prisma.contact.findMany({
    where: { kind: { not: 'grupo' } },
    select: { id: true, name: true, phone: true },
    orderBy: { name: 'asc' },
  });

  const contaminados = contatos
    .filter((contato) => MASCARA_DE_NUMERO.test(contato.name) || SOMENTE_NUMERO.test(contato.name))
    .map((contato) => ({ ...contato, fallback: formatarTelefone(contato.phone) }))
    .filter((contato) => contato.name !== contato.fallback);

  console.log(`Contatos pessoais analisados .... ${contatos.length}`);
  console.log(`Nomes a corrigir ................. ${contaminados.length}`);
  for (const contato of contaminados.slice(0, 20)) {
    console.log(`  ${contato.name} -> ${contato.fallback}`);
  }
  if (contaminados.length > 20) console.log(`  ... e mais ${contaminados.length - 20}.`);

  if (!APLICAR) {
    console.log('\nSimulação. Nada foi alterado. Acrescente --aplicar para executar.');
    return;
  }

  let corrigidos = 0;
  for (const contato of contaminados) {
    await prisma.contact.update({
      where: { id: contato.id },
      data: { name: contato.fallback },
    });
    corrigidos += 1;
  }
  console.log(`\nPronto: ${corrigidos} nome(s) corrigido(s).`);
};

main()
  .catch((erro) => {
    console.error('Falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
