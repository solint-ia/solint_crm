import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '@/generated/prisma';

/**
 * Cliente Prisma da aplicação.
 *
 * O adaptador é o único ponto que sabe qual banco está por trás. Foi trocar
 * `PrismaBetterSqlite3` por `PrismaPg` aqui e o `provider` no `schema.prisma`
 * para sair do SQLite e ir para o Supabase — nenhum repositório, caso de uso ou
 * tela mudou.
 *
 * `DATABASE_URL` aponta para o pooler em **modo transação** (porta 6543), com
 * `pgbouncer=true` e `connection_limit=1`. As migrações usam outra URL
 * (`DIRECT_URL`, porta de sessão) porque advisory lock e statement preparado não
 * sobrevivem ao modo transação — ver `prisma.config.ts` e `.env.example`.
 *
 * Guardado em `globalThis` em desenvolvimento porque o hot-reload do Next
 * reavalia os módulos: sem isso, cada alteração de arquivo abriria um pool novo
 * e o teto de conexões do Supabase seria alcançado em poucos minutos.
 */
const createClient = (): PrismaClient => {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL ausente. Copie `.env.example` para `.env` e preencha — ' +
        'rode `npm run db:check` para conferir as três conexões.',
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
};

const globalRef = globalThis as typeof globalThis & { __solintPrisma?: PrismaClient };

export const prisma: PrismaClient = globalRef.__solintPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalRef.__solintPrisma = prisma;
}

/**
 * Adapta um agregado do domínio para uma coluna `Json`.
 *
 * O cast existe por um motivo estrutural, não por preguiça: os tipos do domínio
 * são `readonly` em toda parte, e `InputJsonValue` do Prisma exige arrays
 * mutáveis. Não há perda — o Prisma serializa sem mutar — mas sem o cast nada
 * compila. Um cast, num lugar só, documentado.
 *
 * Substituiu o antigo `toJson`, que fazia `JSON.stringify`: em Postgres a coluna
 * é `jsonb` nativo e serializar à mão gravaria uma string dentro do JSON.
 */
export const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/**
 * Lê uma coluna `Json`.
 *
 * Substituiu o antigo `fromJson`, que fazia `JSON.parse` com `try/catch`. Em
 * Postgres o JSON é validado na escrita, então texto malformado deixou de ser
 * possível — mas duas coisas continuam: a coluna pode ser nula, e pode conter
 * um valor de forma inesperada, gravado por uma versão antiga do código.
 *
 * Nos dois casos devolve o padrão em vez de explodir. O motivo é o mesmo de
 * antes: uma conversa inteira não deve sumir da caixa de entrada porque um
 * campo auxiliar ficou estranho numa migração passada.
 */
export const readJson = <T>(value: Prisma.JsonValue | null | undefined, fallback: T): T => {
  if (value === null || value === undefined) return fallback;

  // Escalar numa coluna de agregado significa dado gravado errado. Devolver o
  // padrão mantém a linha utilizável; deixar passar quebraria na primeira
  // iteração, longe daqui e sem pista de onde veio.
  if (typeof value !== 'object') return fallback;

  return value as T;
};
