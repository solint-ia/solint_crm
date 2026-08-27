import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

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

/**
 * Onde o cache mora — e por que o lugar não é fixo.
 *
 * `process.cwd()` é gravável no worker e em desenvolvimento, e **somente
 * leitura** na função serverless que serve `/api/whatsapp/media/[id]`: lá o
 * único diretório gravável é o temporário do sistema. Fixar o primeiro fazia
 * toda gravação de cache falhar na Vercel — silenciosamente, porque falha de
 * cache não é fatal por design.
 *
 * A escolha é feita uma vez, na primeira necessidade, e `null` é resposta
 * legítima: sem lugar para o cache o depósito continua inteiro, só mais lento.
 */
const CACHE_CANDIDATES = [
  path.resolve(process.cwd(), '.media', 'whatsapp'),
  path.join(os.tmpdir(), 'solint-crm', 'media', 'whatsapp'),
] as const;

let resolvedCacheDir: string | null | undefined;

const cacheDir = (): string | null => {
  if (resolvedCacheDir !== undefined) return resolvedCacheDir;
  for (const dir of CACHE_CANDIDATES) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      resolvedCacheDir = dir;
      return dir;
    } catch {
      // Sistema de arquivos somente leitura: tenta o próximo candidato.
    }
  }
  console.warn(
    '[wa-media-store] Nenhum diretório gravável para o cache; servindo direto do Storage.',
  );
  resolvedCacheDir = null;
  return null;
};

/** Ids vêm do WhatsApp; validar impede que um id forjado escape do diretório. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
/** Retenção do cache em disco. O objeto no Storage não é tocado por isto. */
const CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mídia pronta para servir.
 *
 * **Não expõe caminho de arquivo, de propósito.** Expunha, e todo consumidor
 * fazia `readFile(filePath)` — o que só funciona quando os bytes couberam no
 * disco. Na Vercel eles nunca cabem, então uma leitura que já tinha os bytes na
 * mão em memória voltava `null` por não conseguir gravá-los antes: era esse o
 * `404` das fotos de perfil, com a linha no banco e o objeto no bucket ambos
 * presentes. Com um acessador só, de onde vieram os bytes deixa de ser assunto
 * de quem lê — e não há como um chamador novo reintroduzir a suposição.
 */
export interface StoredMedia {
  readonly mimeType: string;
  readonly fileName?: string;
  readonly size: number;
  /** Bytes completos. Do cache em disco ou do Storage, indistintamente. */
  readonly bytes: () => Promise<Buffer>;
  /** Os mesmos bytes em fluxo, para a rota HTTP não carregar 25 MB de uma vez. */
  readonly stream: () => ReadableStream<Uint8Array>;
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

const pathsFor = (id: string): { bin: string; meta: string } | null => {
  const dir = cacheDir();
  if (!dir) return null;
  return { bin: path.join(dir, `${id}.bin`), meta: path.join(dir, `${id}.json`) };
};

/** Fluxo de leitura de um arquivo do cache, no formato que a resposta HTTP usa. */
const fileStream = (filePath: string): ReadableStream<Uint8Array> =>
  Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;

/** Fluxo de um buffer já em memória — mesma forma, outra origem. */
const bufferStream = (data: Buffer): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
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
  const paths = pathsFor(id);
  if (!paths) return;
  try {
    // Recriado a cada gravação de propósito: o diretório escolhido é lembrado,
    // mas ele pode sumir por baixo — um `clear()` de outro processo, a faxina
    // do temporário do sistema — e uma gravação que não se repara sozinha
    // deixaria o cache desligado até o próximo boot.
    await fsp.mkdir(path.dirname(paths.bin), { recursive: true });
    await fsp.writeFile(paths.bin, data);
    await fsp.writeFile(paths.meta, JSON.stringify(meta), 'utf-8');
  } catch (error) {
    console.warn('[wa-media-store] Não foi possível gravar o cache local:', error);
  }
};

const readCache = async (id: string): Promise<StoredMedia | null> => {
  const paths = pathsFor(id);
  if (!paths) return null;
  try {
    const stat = await fsp.stat(paths.bin);
    let parsed: MediaMeta = { mimeType: 'application/octet-stream' };
    try {
      parsed = JSON.parse(await fsp.readFile(paths.meta, 'utf-8')) as MediaMeta;
    } catch {
      // Sidecar ausente ou corrompido: serve como binário genérico.
    }
    return {
      mimeType: parsed.mimeType || 'application/octet-stream',
      ...(parsed.fileName ? { fileName: parsed.fileName } : {}),
      size: stat.size,
      bytes: () => fsp.readFile(paths.bin),
      stream: () => fileStream(paths.bin),
    };
  } catch {
    return null;
  }
};

/** Mídia servida a partir dos bytes em memória, sem passar pelo disco. */
const fromBuffer = (data: Buffer, meta: MediaMeta): StoredMedia => ({
  mimeType: meta.mimeType || 'application/octet-stream',
  ...(meta.fileName ? { fileName: meta.fileName } : {}),
  size: data.length,
  bytes: async () => data,
  stream: () => bufferStream(data),
});

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

    // Com Storage configurado, a pergunta é sobre **durabilidade**, e o disco
    // não responde por ela: um arquivo que só existe no cache deste processo é
    // inalcançável para quem serve a rota, que roda noutra máquina. Responder
    // `true` por causa dele fazia o worker devolver uma URL que o navegador
    // recebia como `404` — e, pior, pular o download que teria consertado.
    if (isStorageConfigured()) {
      // tenant-ok: existência do registro, não entrega de conteúdo. Chamado só
      // pelo worker para decidir se precisa baixar de novo — quem entrega ao
      // navegador é `read`, e lá a posse é conferida.
      return (await prisma.mediaObject.count({ where: { id } })) > 0;
    }

    // Sem Storage, quem grava e quem serve são o mesmo host: o disco é a verdade.
    const paths = pathsFor(id);
    return paths ? fs.existsSync(paths.bin) : false;
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

    /** A mídia ficou onde qualquer processo consegue lê-la depois? */
    let durable = false;

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
          // O registro é o que torna a mídia localizável: o objeto no bucket
          // sem a linha no banco não é servível, porque `read` confere a posse
          // pela linha. Só depois dela a mídia conta como durável.
          durable = true;
        } catch (error) {
          console.warn('[wa-media-store] Mídia gravada, mas o registro falhou:', error);
        }
      }
    }

    await writeCache(id, data, { mimeType, ...(meta.fileName ? { fileName: meta.fileName } : {}) });

    // Recusar vale mais do que devolver uma URL que só funciona aqui dentro.
    //
    // Quem recebe esta URL a grava — em `Contact.avatarUrl`, no conteúdo da
    // mensagem — e passa a apontar para algo que existe apenas no disco deste
    // processo. Era o defeito que este módulo veio corrigir, reintroduzido uma
    // camada acima: o `undefined` deixa o chamador cair no caminho alternativo
    // que ele já tem, em vez de gravar um `404` no banco.
    //
    // **Quem serve a rota decide se o disco vale como depósito.** Rodando dentro
    // do site, o cache local é alcançável e a URL funciona — é a queda graciosa
    // que `isStorageConfigured` autoriza. No worker não: ele é outro processo,
    // quase sempre noutra máquina, e o disco dele nunca é lido por quem atende o
    // navegador. Sem esta distinção, um worker sem `SUPABASE_URL` gravava a
    // mídia no próprio disco, devolvia a URL, e toda foto recebida virava um
    // `404` silencioso na tela — com a linha do banco apontando para o vazio.
    const precisaSerDuravel = isStorageConfigured() || Boolean(process.env.SOLINT_WORKER);

    if (precisaSerDuravel && !durable) {
      console.warn(
        `[wa-media-store] Mídia ${id} não pôde ser guardada de forma durável` +
          (isStorageConfigured()
            ? '.'
            : ': o worker não tem SUPABASE_URL/SUPABASE_SECRET_KEY, e o disco dele ' +
              'não é alcançável por quem serve /api/whatsapp/media.'),
      );
      return undefined;
    }

    return mediaUrlFor(id);
  },

  /**
   * Lê a mídia: cache primeiro, Storage depois.
   *
   * O cache existe para não pagar uma ida à rede por avatar numa lista de
   * conversas. O Storage é o que garante que a resposta existe mesmo quando o
   * disco foi trocado — ou quando quem gravou foi o outro processo.
   */
  async read(id: string, scope?: { readonly accountId: string }): Promise<StoredMedia | null> {
    if (!isSafeMediaId(id)) return null;

    // A posse é conferida **antes** do cache, não depois.
    //
    // O cache em disco não sabe de quem é o arquivo, então perguntar a ele
    // primeiro entregaria a mídia de outra empresa sem passar por conferência
    // nenhuma — bastava conhecer o id, que é o id da mensagem no WhatsApp.
    // Quem não informa `scope` é código de servidor que já opera dentro de uma
    // conta (o worker, ao enviar um anexo); quem atende requisição de navegador
    // informa, sempre.
    if (scope) {
      const owned = await prisma.mediaObject.count({
        where: { id, accountId: scope.accountId },
      });
      if (owned === 0) return null;
    }

    const cached = await readCache(id);
    if (cached) return cached;
    if (!isStorageConfigured()) return null;

    // tenant-ok: a posse já foi conferida acima, quando `scope` foi informado.
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

    // O cache é povoado para a próxima leitura, mas **esta** resposta sai dos
    // bytes que já estão aqui. Voltar pelo disco fazia a leitura inteira
    // depender de uma gravação que é opcional por definição — e que é sempre
    // impossível no sistema de arquivos somente leitura da função serverless.
    await writeCache(id, data, meta);
    return fromBuffer(data, meta);
  },

  /**
   * Descarta cache local antigo.
   *
   * Só o cache: os objetos no Storage seguem uma política de retenção por conta,
   * que é decisão de produto e não de disco cheio. Apagar aqui não faz nenhuma
   * mídia deixar de ser servível — no máximo, a próxima leitura vai à rede.
   */
  async prune(): Promise<void> {
    const dir = cacheDir();
    if (!dir) return;
    try {
      const entries = await fsp.readdir(dir);
      const deadline = Date.now() - CACHE_RETENTION_MS;
      await Promise.all(
        entries.map(async (entry) => {
          const target = path.join(dir, entry);
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
    const dir = cacheDir();
    if (!dir) return;
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    // O diretório volta a ser criado sob demanda; guardar a escolha depois de
    // apagá-lo faria `pathsFor` devolver um caminho que deixou de existir.
    resolvedCacheDir = undefined;
  },
};
