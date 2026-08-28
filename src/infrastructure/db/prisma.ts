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
/**
 * Piso do pool fora de produção.
 *
 * `next dev` e o worker são **um processo longo**, não uma função por
 * requisição: com o pool em 1, uma sincronização de histórico do WhatsApp
 * seguraria a única conexão e as telas ficariam esperando atrás dela.
 */
const DEV_MIN_POOL = 10;

/**
 * Tamanho do pool, de fato aplicado.
 *
 * `connection_limit` na URL é convenção do *engine* do Prisma. Com o adaptador
 * `pg` quem abre conexão é o `pg.Pool`, que lê `max` — e o `pg-connection-string`
 * descarta em silêncio todo parâmetro que não reconhece. Ou seja: o
 * `connection_limit=1` documentado no `.env.example` não tinha efeito algum e o
 * pool subia com o padrão do `pg`, que é 10.
 *
 * Isso é inofensivo num processo longo e perigoso exatamente onde o limite foi
 * escrito para valer — em serverless, onde cada instância abriria até 10
 * conexões e o teto do Supabase cairia. Aqui o valor volta a ser respeitado.
 *
 * `DB_POOL_SIZE` tem a última palavra, para quando for preciso ajustar sem
 * reescrever a URL de conexão.
 */
/**
 * Teto do worker sobre um pooler em **modo sessão**.
 *
 * O modo sessão do Supabase entrega ~15 clientes para o projeto inteiro, e o
 * worker não é o único a gastá-los: a escuta `LISTEN` do próprio worker é mais
 * uma, a do processo do site mais outra, e `prisma migrate deploy` abre a sua
 * durante o build. Com o `connection_limit=10` que o `.env.example` sugeria, um
 * redeploy — em que o worker antigo ainda segura as conexões enquanto o novo
 * sobe — passava do teto e o Postgres respondia `EMAXCONNSESSION` a **tudo**:
 * gravar mensagem, publicar evento, ler conversa.
 *
 * Seis deixa folga para todos os outros e continua sendo três vezes o que o
 * limitador de gravação do WhatsApp consome. `DB_POOL_SIZE` tem a última
 * palavra para quem tiver um banco maior.
 */
const WORKER_MAX_POOL = 6;

const poolSize = (connectionString: string): number => {
  const explicit = Number(process.env.DB_POOL_SIZE);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;

  const declared = Number(new URL(connectionString).searchParams.get('connection_limit'));
  const fromUrl = Number.isInteger(declared) && declared > 0 ? declared : DEV_MIN_POOL;

  const base =
    process.env.NODE_ENV === 'production' ? fromUrl : Math.max(fromUrl, DEV_MIN_POOL);

  return process.env.SOLINT_WORKER ? Math.min(base, WORKER_MAX_POOL) : base;
};

/**
 * Tamanho do pool em uso, para quem precisa dimensionar trabalho por ele.
 *
 * O limitador de gravação do WhatsApp derivava do `DB_POOL_SIZE` por conta
 * própria e chutava 10 quando a variável não existia — o que ficava errado
 * exatamente quando o pool era menor que isso, que é o caso que importa.
 */
export const DB_POOL_SIZE = (() => {
  const connectionString =
    (process.env.SOLINT_WORKER ? process.env.WORKER_DATABASE_URL : undefined) ??
    process.env.DATABASE_URL;
  return connectionString ? poolSize(connectionString) : DEV_MIN_POOL;
})();

const createClient = (): PrismaClient => {
  // O worker é um processo longo que mantém `LISTEN` e grava lotes de chaves:
  // o pooler em modo transação não serve a ele. Ver `.env.example` item 3.
  const connectionString =
    (process.env.SOLINT_WORKER ? process.env.WORKER_DATABASE_URL : undefined) ??
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL ausente. Copie `.env.example` para `.env` e preencha — ' +
        'rode `npm run db:check` para conferir as três conexões.',
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: poolSize(connectionString) }),
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
