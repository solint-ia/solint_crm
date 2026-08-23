import 'server-only';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Deposito local das midias do WhatsApp.
 *
 * A midia do WhatsApp e criptografada e so pode ser baixada pela sessão ativa:
 * a URL original não serve para o navegador. Por isso o conteúdo e decifrado
 * uma vez, gravado em disco e servido pela propria aplicacao.
 *
 * Cada item vira dois arquivos: `<id>.bin` (bytes) e `<id>.json` (mimetype e
 * nome original). O sidecar evita ter que adivinhar a extensao a partir do
 * mimetype — documentos aceitam qualquer tipo.
 */

const MEDIA_DIR = path.resolve(process.cwd(), '.media', 'whatsapp');

/** Ids vem do WhatsApp; validar impede que um id forjado escape do diretorio. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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

export const isSafeMediaId = (id: string): boolean => SAFE_ID.test(id);

const pathsFor = (id: string) => ({
  bin: path.join(MEDIA_DIR, `${id}.bin`),
  meta: path.join(MEDIA_DIR, `${id}.json`),
});

/** URL publica servida por `/api/whatsapp/media/[id]`. */
export const mediaUrlFor = (id: string): string => `/api/whatsapp/media/${id}`;

export const mediaStore = {
  has(id: string): boolean {
    return isSafeMediaId(id) && fs.existsSync(pathsFor(id).bin);
  },

  /** Grava a midia decifrada e devolve a URL local, ou `undefined` se recusada. */
  async save(
    id: string,
    data: Buffer,
    meta: MediaMeta,
  ): Promise<string | undefined> {
    if (!isSafeMediaId(id) || data.length === 0 || data.length > MAX_MEDIA_BYTES) {
      return undefined;
    }
    try {
      await fsp.mkdir(MEDIA_DIR, { recursive: true });
      const { bin, meta: metaPath } = pathsFor(id);
      await fsp.writeFile(bin, data);
      await fsp.writeFile(metaPath, JSON.stringify(meta), 'utf-8');
      return mediaUrlFor(id);
    } catch (error) {
      console.error('[wa-media-store] Falha ao gravar mídia:', error);
      return undefined;
    }
  },

  async read(id: string): Promise<StoredMedia | null> {
    if (!isSafeMediaId(id)) return null;
    const { bin, meta } = pathsFor(id);
    try {
      const stat = await fsp.stat(bin);
      let parsed: MediaMeta = { mimeType: 'application/octet-stream' };
      try {
        parsed = JSON.parse(await fsp.readFile(meta, 'utf-8')) as MediaMeta;
      } catch {
        // Sidecar ausente ou corrompido: serve como binario generico.
      }
      return {
        filePath: bin,
        mimeType: parsed.mimeType || 'application/octet-stream',
        fileName: parsed.fileName,
        size: stat.size,
      };
    } catch {
      return null;
    }
  },

  /** Descarta midias antigas — o store de conversas e volatil, o disco não. */
  async prune(): Promise<void> {
    try {
      const entries = await fsp.readdir(MEDIA_DIR);
      const deadline = Date.now() - RETENTION_MS;
      await Promise.all(
        entries.map(async (entry) => {
          const target = path.join(MEDIA_DIR, entry);
          const stat = await fsp.stat(target).catch(() => null);
          if (stat && stat.mtimeMs < deadline) {
            await fsp.rm(target, { force: true }).catch(() => undefined);
          }
        }),
      );
    } catch {
      // Diretorio ainda não existe: nada a limpar.
    }
  },

  async clear(): Promise<void> {
    await fsp.rm(MEDIA_DIR, { recursive: true, force: true }).catch(() => undefined);
  },
};
