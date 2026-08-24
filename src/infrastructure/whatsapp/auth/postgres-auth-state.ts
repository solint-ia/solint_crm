import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/infrastructure/db/prisma';
import { open, seal } from './crypto';

type KeyCategory = keyof SignalDataTypeMap;

const keyL1Cache = new Map<string, unknown>();

function getCacheKey(inboxId: string, category: string, keyId: string): string {
  return `${inboxId}:${category}:${keyId}`;
}

/**
 * Adaptador de Autenticação L2: Persistência do material criptográfico do Baileys no Postgres (Supabase).
 *
 * As credenciais mestre e as chaves de sessão são cifradas individualmente com AES-256-GCM antes da gravação.
 * Inclui cache L1 em memória para consultas instantâneas (0ms) sem round-trips repetidos ao banco de dados.
 */
export async function initPostgresAuthState(
  inboxId: string,
  options: { forceFresh?: boolean } = {},
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // 1. Busca a conexão da caixa de entrada ou inicializa uma nova credencial se ainda não pareada
  const conn = await prisma.whatsAppConnection.findUnique({ where: { inboxId } });

  let creds: AuthenticationCreds | null = null;

  if (
    !options.forceFresh &&
    conn?.status === 'conectado' &&
    conn.credsCipher &&
    conn.credsIv &&
    conn.credsTag
  ) {
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

  // Se a sessão não estiver autenticada/registrada, limpa resquícios e cria credencial limpa
  if (!creds || !creds.registered) {
    creds = initAuthCreds();
    for (const k of keyL1Cache.keys()) {
      if (k.startsWith(`${inboxId}:`)) {
        keyL1Cache.delete(k);
      }
    }
    await prisma.whatsAppKey.deleteMany({ where: { inboxId } }).catch(() => {});
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends KeyCategory>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          if (ids.length === 0) return out;

          const missingIds: string[] = [];

          // 1. Tenta recuperar do cache L1 em memória (0ms)
          for (const id of ids) {
            const ck = getCacheKey(inboxId, type, id);
            if (keyL1Cache.has(ck)) {
              const val = keyL1Cache.get(ck);
              if (val !== undefined && val !== null) {
                out[id] = (
                  type === 'app-state-sync-key'
                    ? proto.Message.AppStateSyncKeyData.fromObject(val as object)
                    : val
                ) as SignalDataTypeMap[T];
              }
            } else {
              missingIds.push(id);
            }
          }

          if (missingIds.length === 0) {
            return out;
          }

          // 2. Busca no banco apenas os IDs faltantes
          const rows = await prisma.whatsAppKey.findMany({
            where: { inboxId, category: type, keyId: { in: missingIds } },
          });

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

            keyL1Cache.set(getCacheKey(inboxId, type, row.keyId), value);

            out[row.keyId] = (
              type === 'app-state-sync-key'
                ? proto.Message.AppStateSyncKeyData.fromObject(value as object)
                : value
            ) as SignalDataTypeMap[T];
          }

          return out;
        },

        set: async (data) => {
          const writes: Prisma.PrismaPromise<unknown>[] = [];

          for (const category of Object.keys(data) as KeyCategory[]) {
            const bucket = data[category] as Record<string, unknown> | undefined;
            if (!bucket) continue;

            for (const [keyId, value] of Object.entries(bucket)) {
              const ck = getCacheKey(inboxId, category, keyId);

              if (value === null || value === undefined) {
                keyL1Cache.delete(ck);
                writes.push(
                  prisma.whatsAppKey.deleteMany({
                    where: { inboxId, category, keyId },
                  }),
                );
                continue;
              }

              // Atualiza imediatamente na memória (0ms) para consultas subsequentes no mesmo ciclo
              keyL1Cache.set(ck, value);

              const serialized = Buffer.from(JSON.stringify(value, BufferJSON.replacer));
              const { cipher, iv, tag } = seal(serialized);

              writes.push(
                prisma.whatsAppKey.upsert({
                  where: { inboxId_category_keyId: { inboxId, category, keyId } },
                  create: {
                    inboxId,
                    category,
                    keyId,
                    valueCipher: Uint8Array.from(cipher),
                    valueIv: Uint8Array.from(iv),
                    valueTag: Uint8Array.from(tag),
                  },
                  update: {
                    valueCipher: Uint8Array.from(cipher),
                    valueIv: Uint8Array.from(iv),
                    valueTag: Uint8Array.from(tag),
                  },
                }),
              );
            }
          }

          if (writes.length === 0) return;

          // Para pequenas escritas (caso padrão de envio/recebimento de mensagens),
          // executa em paralelo direto com Promise.all para latência mínima (< 50ms)
          if (writes.length <= 5) {
            await Promise.all(writes);
          } else {
            // Para grandes lotes (ex: 100+ pre-keys no pareamento inicial), divide em chunks com timeout estendido
            const CHUNK_SIZE = 25;
            for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
              const chunk = writes.slice(i, i + CHUNK_SIZE);
              await prisma.$transaction(chunk, { timeout: 30000, maxWait: 10000 });
            }
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
