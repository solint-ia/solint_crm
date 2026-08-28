import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { prisma } from '@/infrastructure/db/prisma';
import { open, seal } from './crypto';
import { waLog } from '../wa-log';

type KeyCategory = keyof SignalDataTypeMap;

/**
 * Adaptador de autenticação do Baileys sobre o Postgres.
 *
 * As credenciais mestre e as chaves de sessão são cifradas individualmente com
 * AES-256-GCM antes da gravação.
 *
 * ## Por que este arquivo era o gargalo do WhatsApp inteiro
 *
 * O `makeCacheableSignalKeyStore` do Baileys envolve `get` **e** `set` no mesmo
 * mutex, e o `await store.set(...)` roda dentro dele. Enquanto uma gravação
 * daqui está pendente, nenhuma leitura de chave acontece no socket — e cifrar
 * mensagem de saída e decifrar mensagem de entrada precisam ler chaves.
 *
 * Medido no ambiente real (Supabase us-east-2, ida e volta de 127 ms): o
 * Baileys 7 grava mapeamentos LID↔PN continuamente, ~8 por segundo, uma ida ao
 * banco cada. Com 126 ms por gravação o mutex ficava ocupado praticamente 100%
 * do tempo, e os envios levavam de 30 a 300 segundos. Não era o WhatsApp que
 * estava lento: era a fila de espera por uma chave.
 *
 * Duas mudanças resolvem isso, e as duas estão aqui:
 *
 *  1. **Gravação em lote de verdade.** Um `INSERT ... ON CONFLICT` multi-linha
 *     no lugar de N upserts. Medido: 25 chaves passaram de 3.397 ms para 127 ms.
 *  2. **Escrita adiada para o que é cache.** `lid-mapping` e `tctoken` são
 *     material que o Baileys refaz sozinho por USync; não há razão para o mutex
 *     esperar o banco por eles. Vão para uma fila que descarrega fora do mutex.
 *     O material do Signal — sessão, pré-chave, identidade — continua sendo
 *     gravado na hora, porque perder isso quebra a decifra.
 */

/**
 * Categorias que o Baileys reconstrói sozinho.
 *
 * Perder uma destas num desligamento abrupto custa uma consulta USync na
 * próxima vez, não uma sessão quebrada. É o que autoriza a escrita adiada.
 */
const CACHE_CATEGORIES: ReadonlySet<string> = new Set(['lid-mapping', 'tctoken']);

/** Teto do cache L1. Sem ele o mapa crescia sem limite — 9 mil entradas e subindo. */
const L1_MAX_ENTRIES = 20_000;

/** Intervalo de descarga da fila adiada. Curto o bastante para não acumular. */
const FLUSH_INTERVAL_MS = 250;

/**
 * Linhas por statement.
 *
 * O Postgres aceita 65.535 parâmetros por consulta e cada linha usa 6. O teto
 * real fica perto de 10.900; 500 deixa margem larga e continua sendo uma ida ao
 * banco só.
 */
const ROWS_PER_STATEMENT = 500;

/**
 * Cache L1 com descarte do mais antigo.
 *
 * `Map` preserva a ordem de inserção, então o primeiro item do iterador é
 * sempre o mais antigo — e isso basta para um teto. Um LRU de verdade exigiria
 * reposicionar a cada leitura, e o ganho não pagaria numa estrutura que já é só
 * um atalho para o banco.
 */
const keyL1Cache = new Map<string, unknown>();

const cacheSet = (key: string, value: unknown): void => {
  if (keyL1Cache.size >= L1_MAX_ENTRIES && !keyL1Cache.has(key)) {
    const oldest = keyL1Cache.keys().next().value;
    if (oldest !== undefined) keyL1Cache.delete(oldest);
  }
  keyL1Cache.set(key, value);
};

function getCacheKey(inboxId: string, category: string, keyId: string): string {
  return `${inboxId}:${category}:${keyId}`;
}

/* ==========================================================================
   Gravação em lote
   ========================================================================== */

interface PendingWrite {
  readonly inboxId: string;
  readonly category: string;
  readonly keyId: string;
  /** `null` significa remover a chave. */
  readonly value: unknown;
}

/**
 * Grava um lote inteiro num único statement.
 *
 * O `ON CONFLICT` sobre a chave primária composta faz o papel do `upsert` do
 * Prisma, com a diferença que importa: uma ida ao banco em vez de uma por
 * chave. Com ida e volta de 127 ms, essa diferença é a diferença entre 127 ms e
 * 3,4 s para um lote de 25.
 */
const writeBatch = async (rows: readonly PendingWrite[]): Promise<number> => {
  if (rows.length === 0) return 0;

  const columns = '"inboxId","category","keyId","valueCipher","valueIv","valueTag","updatedAt"';
  let written = 0;

  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const slice = rows.slice(i, i + ROWS_PER_STATEMENT);
    const params: unknown[] = [];
    const tuples: string[] = [];

    for (const row of slice) {
      const serialized = Buffer.from(JSON.stringify(row.value, BufferJSON.replacer));
      const { cipher, iv, tag } = seal(serialized);
      const base = params.length;
      params.push(row.inboxId, row.category, row.keyId, cipher, iv, tag);
      tuples.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},now())`,
      );
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WhatsAppKey" (${columns}) VALUES ${tuples.join(',')} ` +
        `ON CONFLICT ("inboxId","category","keyId") DO UPDATE SET ` +
        `"valueCipher" = EXCLUDED."valueCipher", "valueIv" = EXCLUDED."valueIv", ` +
        `"valueTag" = EXCLUDED."valueTag", "updatedAt" = now()`,
      ...params,
    );
    written += slice.length;
  }

  return written;
};

/** Remoções agrupadas por categoria: uma consulta por categoria, não por chave. */
const deleteBatch = async (rows: readonly PendingWrite[]): Promise<number> => {
  if (rows.length === 0) return 0;

  const byScope = new Map<string, { inboxId: string; category: string; keyIds: string[] }>();
  for (const row of rows) {
    const scope = `${row.inboxId}:${row.category}`;
    const entry = byScope.get(scope);
    if (entry) entry.keyIds.push(row.keyId);
    else byScope.set(scope, { inboxId: row.inboxId, category: row.category, keyIds: [row.keyId] });
  }

  let removed = 0;
  for (const { inboxId, category, keyIds } of byScope.values()) {
    const { count } = await prisma.whatsAppKey.deleteMany({
      where: { inboxId, category, keyId: { in: keyIds } },
    });
    removed += count;
  }
  return removed;
};

/**
 * Aplica um conjunto de mudanças: grava o que tem valor, remove o que é nulo.
 *
 * A instrumentação está aqui, e não em cada chamador, porque este é o único
 * ponto por onde toda escrita de chave passa. Ligue com `WA_LOG_LEVEL=debug`.
 */
const applyWrites = async (rows: readonly PendingWrite[], origem: string): Promise<void> => {
  const started = Date.now();
  const upserts = rows.filter((row) => row.value !== null && row.value !== undefined);
  const deletes = rows.filter((row) => row.value === null || row.value === undefined);

  const gravadas = await writeBatch(upserts);
  const removidas = await deleteBatch(deletes);

  waLog.debug(
    `[keystore] ${origem}: ${gravadas} gravada(s), ${removidas} removida(s) em ${Date.now() - started}ms`,
  );
};

/* ==========================================================================
   Fila de escrita adiada
   ========================================================================== */

/**
 * Mudanças pendentes, coalescidas por chave.
 *
 * O `Map` faz metade do trabalho sozinho: gravar a mesma chave duas vezes antes
 * da descarga deixa só a última versão. O Baileys reescreve o mesmo mapeamento
 * com frequência, então isso não é detalhe — é parte do ganho.
 */
const pendingWrites = new Map<string, PendingWrite>();
let flushTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> = Promise.resolve();

const flushPending = async (): Promise<void> => {
  if (pendingWrites.size === 0) return;
  const rows = [...pendingWrites.values()];
  pendingWrites.clear();

  try {
    await applyWrites(rows, 'descarga adiada');
  } catch (error) {
    // Recolocar o que falhou seria tentador e errado: uma falha persistente
    // faria a fila crescer para sempre. Este material é cache — o Baileys o
    // refaz por USync. Registrar e seguir é a resposta correta.
    waLog.warn('[keystore] Falha ao descarregar chaves adiadas:', error);
  }
};

/** Serializa as descargas: duas ao mesmo tempo disputariam as mesmas linhas. */
const scheduleFlush = (): void => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushing = flushing.then(flushPending).catch(() => undefined);
  }, FLUSH_INTERVAL_MS);
  // Não segura o processo vivo: é trabalho de fundo, não razão para existir.
  flushTimer.unref?.();
};

/**
 * Retenção do material de cache no banco.
 *
 * O LRU que o Baileys mantém em memória expira em 3 dias; 30 é folga larga
 * sobre isso e ainda assim limita a tabela. Uma chave descartada aqui não é uma
 * chave perdida: na próxima vez que o Baileys precisar dela, uma consulta USync
 * a traz de volta.
 */
const CACHE_KEY_RETENTION_DAYS = 30;

/**
 * Descarta mapeamentos de cache que ninguém toca há tempo demais.
 *
 * Sem isto a `WhatsAppKey` só crescia. Medido com dois dias de uso: 9.203 linhas
 * de `lid-mapping` — 83% da tabela — para uma conta com algumas dezenas de
 * conversas. O número não acompanha quantos contatos existem, e sim quantos
 * usuários do WhatsApp a conta já cruzou alguma vez: cada participante de cada
 * grupo, cada remetente de cada lista. Nunca havia razão para guardar isso para
 * sempre, e ninguém apagava.
 *
 * **Só as categorias de cache.** `session`, `pre-key`, `identity-key` e
 * `sender-key` são estado do Signal: apagar por idade quebraria a decifra de
 * uma conversa que voltou depois de um mês parada. Quem administra o ciclo de
 * vida daquelas é o próprio Baileys — as pré-chaves consumidas, por exemplo,
 * ele remove sozinho.
 */
export const pruneCacheKeys = async (): Promise<number> => {
  const limite = new Date(Date.now() - CACHE_KEY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const { count } = await prisma.whatsAppKey.deleteMany({
      where: { category: { in: [...CACHE_CATEGORIES] }, updatedAt: { lt: limite } },
    });
    if (count > 0) {
      waLog.info(`[keystore] ${count} chave(s) de cache expirada(s) removida(s).`);
    }
    return count;
  } catch (err) {
    waLog.warn('[keystore] Falha ao expirar chaves de cache:', err);
    return 0;
  }
};

/**
 * Descarrega tudo o que estiver pendente e espera terminar.
 *
 * Chamado no desligamento do worker. Sem isto, o que estivesse na fila no
 * momento do `SIGINT` se perderia — recuperável, mas custaria uma rodada de
 * USync na conexão seguinte sem necessidade nenhuma.
 */
export const flushPendingKeys = async (): Promise<void> => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushing = flushing.then(flushPending).catch(() => undefined);
  await flushing;
};

/* ==========================================================================
   Credenciais
   ========================================================================== */

/**
 * Estas credenciais representam uma sessão pareada?
 *
 * `credsCipher` preenchido não basta como resposta: o Baileys grava credenciais
 * durante a tentativa de pareamento, antes de ela dar certo. Uma sessão que
 * mostrou o QR e nunca foi lida deixa material cifrado no banco, e quem olhar só
 * para a coluna conclui que existe sessão onde não existe.
 *
 * **O `registered` sozinho também não serve, e isso custou caro.** No Baileys 7
 * ele é marcado num lugar só — o ramo `link_code_pairing_ref` de
 * `messages-recv.js`, que é o fluxo do código de 8 dígitos. Quem pareia lendo o
 * QR fica com `registered: false` para sempre, mesmo depois de conectar. O
 * efeito era duplo e passava por outra coisa:
 *
 *  - o worker descartava toda sessão salva no boot e nunca reconectava sozinho.
 *    Era preciso clicar em "Conectar" a cada reinício — e a fila de comandos
 *    guardava dezenas desses `connect` como prova;
 *  - `isPaired` ficava falso na sessão, então uma queda de conexão caía no ramo
 *    de "ninguém leu o QR" em vez do backoff de reconexão.
 *
 * O sinal confiável é o `me.id`: o WhatsApp só o devolve depois que o
 * pareamento conclui. `registered` continua sendo aceito para não quebrar quem
 * pareou pelo código.
 */
export const isPairedCreds = (creds: AuthenticationCreds | null | undefined): boolean =>
  Boolean(creds && (creds.registered || creds.me?.id));

/**
 * A caixa chegou a ser pareada de verdade?
 *
 * Decifrar é inevitável aqui, porque a resposta está dentro das credenciais.
 * Custa uma leitura por caixa, no boot.
 */
export async function hasPairedSession(inboxId: string): Promise<boolean> {
  const conn = await prisma.whatsAppConnection.findUnique({
    where: { inboxId },
    select: { credsCipher: true, credsIv: true, credsTag: true },
  });
  if (!conn?.credsCipher || !conn.credsIv || !conn.credsTag) return false;

  try {
    const plain = open(
      Buffer.from(conn.credsCipher),
      Buffer.from(conn.credsIv),
      Buffer.from(conn.credsTag),
    ).toString('utf-8');
    return isPairedCreds(JSON.parse(plain, BufferJSON.reviver) as AuthenticationCreds);
  } catch {
    // Credencial ilegivel (chave trocada, dado corrompido) equivale a nao pareada.
    return false;
  }
}

export async function initPostgresAuthState(
  inboxId: string,
  options: { forceFresh?: boolean } = {},
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { inboxId } });

  let creds: AuthenticationCreds | null = null;

  // A condição é a **existência do material cifrado**, nunca o `status` da linha.
  //
  // Prender a restauração a `status === 'conectado'` criava um impasse: o status
  // só vira `conectado` depois que o socket abre, mas o socket só abre se as
  // credenciais forem restauradas. O Baileys fecha a conexão com `515
  // restartRequired` logo após o pareamento — comportamento normal do protocolo
  // — e nessa reconexão o status ainda era `conectando`. Resultado: as
  // credenciais recém-salvas eram descartadas, as `WhatsAppKey` apagadas e o
  // usuário via um QR novo, em laço, sem nunca conseguir parear.
  //
  // Restaurar é sempre a tentativa; quem julga se o resultado presta é
  // `isPairedCreds`, no chamador. Aqui só se descarta o que nem decifra.
  if (!options.forceFresh && conn?.credsCipher && conn.credsIv && conn.credsTag) {
    try {
      creds = JSON.parse(
        open(
          Buffer.from(conn.credsCipher),
          Buffer.from(conn.credsIv),
          Buffer.from(conn.credsTag),
        ).toString('utf-8'),
        BufferJSON.reviver,
      );
    } catch {
      creds = null;
    }
  }

  // Inicializa novas credenciais apenas se não houver nenhuma salva ou se for forçado
  if (!creds) {
    creds = initAuthCreds();
    for (const k of keyL1Cache.keys()) {
      if (k.startsWith(`${inboxId}:`)) {
        keyL1Cache.delete(k);
      }
    }
    // A fila adiada pode ter chaves da sessão que acabou de ser descartada.
    // Descarregá-las depois recriaria material que este ramo existe para apagar.
    for (const [k, row] of pendingWrites) {
      if (row.inboxId === inboxId) pendingWrites.delete(k);
    }
    await prisma.whatsAppKey.deleteMany({ where: { inboxId } }).catch(() => {});
  }

function toBuffer(val: unknown): Buffer {
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array) return Buffer.from(val);
  if (typeof val === 'object' && val !== null) {
    if ('type' in val && (val as { type: unknown }).type === 'Buffer' && 'data' in val) {
      const data = (val as { data: unknown }).data;
      if (typeof data === 'string') return Buffer.from(data, 'base64');
      if (Array.isArray(data)) return Buffer.from(data);
    }
    if ('data' in val && typeof (val as { data: unknown }).data === 'string') {
      return Buffer.from((val as { data: string }).data, 'base64');
    }
    if (Array.isArray(val)) {
      return Buffer.from(val);
    }
  }
  return Buffer.from(String(val ?? ''));
}

function fixSenderKeyBuffers(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const val = value as Record<string, unknown>;
  if (Array.isArray(val['senderMessageKeys'])) {
    for (const msgKey of val['senderMessageKeys'] as Record<string, unknown>[]) {
      if (msgKey && msgKey['seed'] && !Buffer.isBuffer(msgKey['seed'])) {
        msgKey['seed'] = toBuffer(msgKey['seed']);
      }
    }
  }
  if (val['senderSigningKey'] && typeof val['senderSigningKey'] === 'object') {
    const signingKey = val['senderSigningKey'] as Record<string, unknown>;
    if (signingKey['public'] && !Buffer.isBuffer(signingKey['public'])) {
      signingKey['public'] = toBuffer(signingKey['public']);
    }
    if (signingKey['private'] && !Buffer.isBuffer(signingKey['private'])) {
      signingKey['private'] = toBuffer(signingKey['private']);
    }
  }
  if (val['senderChainKey'] && typeof val['senderChainKey'] === 'object') {
    const chainKey = val['senderChainKey'] as Record<string, unknown>;
    if (chainKey['seed'] && !Buffer.isBuffer(chainKey['seed'])) {
      chainKey['seed'] = toBuffer(chainKey['seed']);
    }
  }
  return value;
}

  return {
    state: {
      creds,
      keys: {
        get: async <T extends KeyCategory>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          if (ids.length === 0) return out;

          const missingIds: string[] = [];

          // 1. Cache L1 em memória — inclui o que ainda não foi ao banco, e é
          //    por isso que a escrita adiada é invisível para quem lê.
          for (const id of ids) {
            const ck = getCacheKey(inboxId, type, id);
            if (keyL1Cache.has(ck)) {
              const val = keyL1Cache.get(ck);
              if (val !== undefined && val !== null) {
                let resolved: unknown = val;
                if (type === 'app-state-sync-key') {
                  resolved = proto.Message.AppStateSyncKeyData.fromObject(val as object);
                } else if (type === 'sender-key') {
                  resolved = fixSenderKeyBuffers(val);
                }
                out[id] = resolved as SignalDataTypeMap[T];
              }
            } else {
              missingIds.push(id);
            }
          }

          if (missingIds.length === 0) {
            return out;
          }

          // 2. Busca no banco apenas os IDs faltantes
          const started = Date.now();
          const rows = await prisma.whatsAppKey.findMany({
            where: { inboxId, category: type, keyId: { in: missingIds } },
          });
          waLog.debug(
            `[keystore] leitura ${type}: ${missingIds.length} pedida(s), ${rows.length} achada(s) em ${Date.now() - started}ms`,
          );

          for (const row of rows) {
            let value: unknown;
            try {
              const plain = open(
                Buffer.from(row.valueCipher),
                Buffer.from(row.valueIv),
                Buffer.from(row.valueTag),
              ).toString('utf-8');
              value = JSON.parse(plain, BufferJSON.reviver);
            } catch {
              continue;
            }

            if (type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            } else if (type === 'sender-key') {
              value = fixSenderKeyBuffers(value);
            }

            cacheSet(getCacheKey(inboxId, type, row.keyId), value);

            out[row.keyId] = value as SignalDataTypeMap[T];
          }

          return out;
        },

        set: async (data) => {
          const agora: PendingWrite[] = [];
          let adiadas = 0;

          for (const category of Object.keys(data) as KeyCategory[]) {
            const bucket = data[category] as Record<string, unknown> | undefined;
            if (!bucket) continue;

            for (const [keyId, value] of Object.entries(bucket)) {
              const ck = getCacheKey(inboxId, category, keyId);
              const vazio = value === null || value === undefined;

              // O L1 é atualizado sempre e primeiro: é ele que torna a escrita
              // adiada invisível para quem ler em seguida.
              if (vazio) keyL1Cache.delete(ck);
              else cacheSet(ck, value);

              const row: PendingWrite = {
                inboxId,
                category,
                keyId,
                value: vazio ? null : value,
              };

              if (CACHE_CATEGORIES.has(category)) {
                pendingWrites.set(ck, row);
                adiadas += 1;
              } else {
                agora.push(row);
              }
            }
          }

          if (adiadas > 0) scheduleFlush();

          // Só o material do Signal segura o mutex do Baileys — e agora num
          // statement único, não um por chave.
          if (agora.length > 0) {
            await applyWrites(agora, 'gravação imediata');
          }
        },
      },
    },

    saveCreds: async () => {
      const serialized = Buffer.from(JSON.stringify(creds, BufferJSON.replacer));
      const { cipher, iv, tag } = seal(serialized);

      await prisma.whatsAppConnection.upsert({
        where: { inboxId },
        create: {
          inboxId,
          status: 'conectando',
          credsCipher: Uint8Array.from(cipher),
          credsIv: Uint8Array.from(iv),
          credsTag: Uint8Array.from(tag),
        },
        update: {
          credsCipher: Uint8Array.from(cipher),
          credsIv: Uint8Array.from(iv),
          credsTag: Uint8Array.from(tag),
        },
      });
    },
  };
}
