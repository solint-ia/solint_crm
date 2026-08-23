import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Configuração do CLI do Prisma (migrate, generate, studio).
 *
 * A URL vive aqui, e não no `schema.prisma`, porque o Prisma 7 moveu a conexão
 * para fora do esquema. Ao trocar SQLite por Supabase, mudam duas coisas: o
 * `provider` no esquema e o adaptador em `src/infrastructure/db/prisma.ts`.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
  },
});
