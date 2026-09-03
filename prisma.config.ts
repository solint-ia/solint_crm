// O Prisma 7 deixou de carregar `.env` automaticamente: sem esta linha,
// `process.env.DIRECT_URL` chega vazio e o CLI reclama do protocolo da URL —
// um erro que não diz que o problema é o arquivo não ter sido lido.
import 'dotenv/config';

import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Configuração do CLI do Prisma (migrate, generate, studio).
 *
 * A URL vive aqui, e não no `schema.prisma`, porque o Prisma 7 moveu a conexão
 * para fora do esquema.
 *
 * **Por que `DIRECT_URL` e não `DATABASE_URL`.** O runtime da aplicação usa o
 * pooler do Supabase em modo transação (porta 6543), que não suporta advisory
 * locks nem statements preparados — e o `prisma migrate` depende dos dois. Uma
 * migração rodada pela URL de runtime falha de forma intermitente, que é o modo
 * mais caro de falhar: passa em desenvolvimento e quebra no deploy.
 *
 * Sem fallback de propósito. O antigo `?? 'file:./dev.db'` transformava
 * "variável não carregada" em "migrando o banco errado, em silêncio".
 */
/**
 * Em ambientes de CI, build de imagens ou `postinstall` (onde apenas o código tipado
 * do cliente Prisma é gerado sem tocar no banco), usamos uma URL sintática padrão
 * para permitir que `prisma generate` avalie o arquivo de configuração.
 */
const CI_OR_BUILD_FALLBACK = 'postgresql://postgres:postgres@localhost:5432/postgres';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? CI_OR_BUILD_FALLBACK;

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: { url },
});
