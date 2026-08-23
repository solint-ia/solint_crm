import 'server-only';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@/generated/prisma';

/**
 * Cliente Prisma da aplicação.
 *
 * O adaptador é o único ponto que sabe qual banco está por trás. Trocar SQLite
 * por Supabase/Postgres é trocar `PrismaBetterSqlite3` por `PrismaPg` aqui e o
 * `provider` no `schema.prisma` — nenhum repositório, caso de uso ou tela muda.
 *
 * Guardado em `globalThis` em desenvolvimento porque o hot-reload do Next
 * reavalia os módulos: sem isso, cada alteração de arquivo abriria uma conexão
 * nova e o SQLite acabaria travado por excesso de handles.
 */
const createClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
    }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

const globalRef = globalThis as typeof globalThis & { __solintPrisma?: PrismaClient };

export const prisma: PrismaClient = globalRef.__solintPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalRef.__solintPrisma = prisma;
}

/** Serializa um agregado para a coluna `*Json`. */
export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * Lê uma coluna `*Json`.
 *
 * Devolve o padrão em vez de explodir quando o conteúdo está corrompido: uma
 * conversa inteira não deve sumir da caixa de entrada porque um campo auxiliar
 * ficou inválido numa migração antiga.
 */
export const fromJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
};
