import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { prisma } from '@/infrastructure/db/prisma';
import {
  BUCKETS,
  isStorageConfigured,
  storage,
  type BucketName,
} from '@/infrastructure/storage/supabase-storage';

/**
 * Depósito das mídias do WhatsApp.
 *
 * A mídia do WhatsApp é criptografada e só pode ser baixada pela sessão ativa: a
 * URL original não serve para o navegador. Por isso o conteúdo é decifrado uma
 * vez, guardado, e servido pela própria aplicação.
 *
 * **Três camadas, cada uma com um papel.**
 *
 *  1. **Supabase Storage** guarda os bytes. É a fonte da verdade.
 *  2. **`MediaObject`** guarda o que o banco precisa saber sobre eles — de quem
 *     é, quanto ocupa, quando entrou. Sem isso não dá para saber o que uma conta
 *     armazena, nem cobrar por isso, nem limpar com critério.
 *  3. **Disco local** é só *cache*. Pode sumir a qualquer momento sem prejuízo.
 *
 * Antes existia só a terceira. O disco era a fonte da verdade, e isso quebrava
 * de três jeitos: sumia no primeiro deploy que trocasse o contêiner, não era
 * alcançável pelo worker (que roda noutro processo, e pode rodar noutra
 * máquina), e o `clear()` da desconexão apagava os arquivos deixando os
 * `avatarUrl` gravados no banco apontando para o nada — que é o `404` das fotos
 * de perfil. Com o disco rebaixado a cache, apagá-lo deixou de significar
 * perder alguma coisa.
 *
 * A rota `/api/whatsapp/media/[id]` continua sendo a única porta de saída, de
 * propósito: URL assinada do Storage perderia as quatro proteções que ela
 * carrega (sessão obrigatória, `Content-Disposition` defensivo, CSP `sandbox` e
 * `nosniff`). Ver PLANO-BACKEND.md seção 6.3.
 */

const CACHE_DIR = path.resolve(process.cwd(), '.media', 'whatsapp');

/** Ids vêm do WhatsApp; validar impede que um id forjado escape do diretório. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
/** Retenção do cache em disco. O objeto no Storage não é tocado por isto. */
const CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredMedia {
  readonly filePath: string;
  readonly mimeType: string;
  readonly fileName?: string;
  readonly size: number;
}

interface MediaMeta {
  readonly mimeType: string;
  readonly fileName?: string;
}

/**
 * A quem a mídia pertence.
 *
 * O `accountId` entra no caminho do bucket, não só na tabela: é o que torna
 * possível, no dia em que o RLS do Storage entrar, escrever a política em uma
 * linha. Ver PLANO-BACKEND.md seção 6.1.
 */
export interface MediaScope {
  readonly accountId: string;
  readonly inboxId?: string;
  /** Foto de perfil vai para outro bucket, com retenção própria. */
  readonly kind?: 'mensagem' | 'avatar';
}

export const isSafeMediaId = (id: string): boolean => SAFE_ID.test(id);

const pathsFor = (id: string) => ({
  bin: path.join(CACHE_DIR, `${id}.bin`),
  meta: path.join(CACHE_DIR, `${id}.json`),
});

/** URL pública servida por `/api/whatsapp/media/[id]`. */
export const mediaUrlFor = (id: string): string => `/api/whatsapp/media/${id}`;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

const extensionFor = (mimeType: string): string =>
  EXTENSIONS[mimeType.split(';')[0] ?? ''] ?? 'bin';

const bucketFor = (scope: MediaScope): BucketName =>
  scope.kind === 'avatar' ? BUCKETS.AVATARS : BUCKETS.MEDIA;

const bucketPathFor = (id: string, scope: MediaScope, mimeType: string): string => {
  const ext = extensionFor(mimeType);
  return scope.kind === 'avatar'
    ? `${scope.accountId}/${id}.${ext}`
    : `${scope.accountId}/${scope.inboxId ?? 'sem-caixa'}/${id}.${ext}`;
};

/** Grava no cache local. Falha aqui nunca é fatal: o Storage já tem os bytes. */
const writeCache = async (id: string, data: Buffer, meta: MediaMeta): Promise<void> => {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    const { bin, meta: metaPath } = pathsFor(id);
    await fsp.writeFile(bin, data);
    await fsp.writeFile(metaPath, JSON.stringify(meta), 'utf-8');
  } catch (error) {
    console.warn('[wa-media-store] Não foi possível gravar o cache local:', error);
  }
};

const readCache = async (id: string): Promise<StoredMedia | null> => {
  const { bin, meta } = pathsFor(id);
  try {
    const stat = await fsp.stat(bin);
    let parsed: MediaMeta = { mimeType: 'application/octet-stream' };
    try {
      parsed = JSON.parse(await fsp.readFile(meta, 'utf-8')) as MediaMeta;
    } catch {
      // Sidecar ausente ou corrompido: serve como binário genérico.
    }
    return {
      filePath: bin,
      mimeType: parsed.mimeType || 'application/octet-stream',
      ...(parsed.fileName ? { fileName: parsed.fileName } : {}),
      size: stat.size,
    };
  } catch {
    return null;
  }
};

export const mediaStore = {
  /**
   * A mídia já existe em algum lugar?
   *
   * Assíncrono porque a resposta pode estar no banco, e não no disco: o worker
   * baixou e gravou, o site pergunta. Antes era síncrono e só olhava o disco,
   * o que fazia cada processo achar que a mídia do outro não existia — e baixar
   * de novo.
   */
  async has(id: string): Promise<boolean> {
    if (!isSafeMediaId(id)) return false;
    if (fs.existsSync(pathsFor(id).bin)) return true;
    if (!isStorageConfigured()) return false;
    return (await prisma.mediaObject.count({ where: { id } })) > 0;
  },

  /**
   * Guarda a mídia decifrada e devolve a URL local, ou `undefined` se recusada.
   *
   * A ordem importa: sobe para o Storage primeiro e só registra o `MediaObject`
   * se a subida deu certo. O contrário deixaria uma linha no banco apontando
   * para um objeto que não existe — o mesmo defeito que este módulo veio
   * corrigir, só que numa camada acima.
   */
  async save(
    id: string,
    data: Buffer,
    meta: MediaMeta,
    scope?: MediaScope,
  ): Promise<string | undefined> {
    if (!isSafeMediaId(id) || data.length === 0 || data.length > MAX_MEDIA_BYTES) {
      return undefined;
    }

    const mimeType = meta.mimeType || 'application/octet-stream';

    // Sem conta não há caminho com inquilino, e sem isso a mídia não pode ir
    // para um bucket compartilhado. Fica só em cache — degradado, mas servível.
    if (scope && isStorageConfigured()) {
      const bucket = bucketFor(scope);
      const objectPath = bucketPathFor(id, scope, mimeType);

      if (await storage.upload(bucket, objectPath, data, mimeType)) {
        try {
          const checksum = createHash('sha256').update(data).digest('hex');
          await prisma.mediaObject.upsert({
            where: { id },
            create: {
              id,
              accountId: scope.accountId,
              inboxId: scope.inboxId ?? null,
              bucketPath: `${bucket}/${objectPath}`,
              mimeType,
              fileName: meta.fileName ?? null,
              sizeBytes: data.length,
              checksum,
            },
            update: {
              bucketPath: `${bucket}/${objectPath}`,
              mimeType,
              fileName: meta.fileName ?? null,
              sizeBytes: data.length,
              checksum,
            },
          });
        } catch (error) {
          console.warn('[wa-media-store] Mídia gravada, mas o registro falhou:', error);
        }
      }
    }

    await writeCache(id, data, { mimeType, ...(meta.fileName ? { fileName: meta.fileName } : {}) });
    return mediaUrlFor(id);
  },

  /**
   * Lê a mídia: cache primeiro, Storage depois.
   *
   * O cache existe para não pagar uma ida à rede por avatar numa lista de
   * conversas. O Storage é o que garante que a resposta existe mesmo quando o
   * disco foi trocado — ou quando quem gravou foi o outro processo.
   */
  async read(id: string): Promise<StoredMedia | null> {
    if (!isSafeMediaId(id)) return null;

    const cached = await readCache(id);
    if (cached) return cached;
    if (!isStorageConfigured()) return null;

    const object = await prisma.mediaObject.findUnique({ where: { id } });
    if (!object) return null;

    const slash = object.bucketPath.indexOf('/');
    if (slash < 0) return null;
    const bucket = object.bucketPath.slice(0, slash) as BucketName;
    const objectPath = object.bucketPath.slice(slash + 1);

    const data = await storage.download(bucket, objectPath);
    if (!data) return null;

    const meta: MediaMeta = {
      mimeType: object.mimeType,
      ...(object.fileName ? { fileName: object.fileName } : {}),
    };
    await writeCache(id, data, meta);
    return (await readCache(id)) ?? null;
  },

  /**
   * Descarta cache local antigo.
   *
   * Só o cache: os objetos no Storage seguem uma política de retenção por conta,
   * que é decisão de produto e não de disco cheio. Apagar aqui não faz nenhuma
   * mídia deixar de ser servível — no máximo, a próxima leitura vai à rede.
   */
  async prune(): Promise<void> {
    try {
      const entries = await fsp.readdir(CACHE_DIR);
      const deadline = Date.now() - CACHE_RETENTION_MS;
      await Promise.all(
        entries.map(async (entry) => {
          const target = path.join(CACHE_DIR, entry);
          const stat = await fsp.stat(target).catch(() => null);
          if (stat && stat.mtimeMs < deadline) {
            await fsp.rm(target, { force: true }).catch(() => undefined);
          }
        }),
      );
    } catch {
      // Diretório ainda não existe: nada a limpar.
    }
  },

  /**
   * Esvazia o cache local.
   *
   * **Não apaga nada do Storage.** Isto é chamado na desconexão do WhatsApp, e
   * apagar os arquivos ali era o que deixava sete `avatarUrl` no banco
   * apontando para o vazio — a conversa perdia a foto do contato por causa de
   * um logout. Contato é dado do CRM; sessão é outra coisa.
   */
  async clear(): Promise<void> {
    await fsp.rm(CACHE_DIR, { recursive: true, force: true }).catch(() => undefined);
  },
};
