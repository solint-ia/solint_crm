import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { prisma } from '../src/infrastructure/db/prisma';
import { storage, type BucketName } from '../src/infrastructure/storage/supabase-storage';

const GROUP_BATCH_SIZE = 100;

export interface BackfillMediaBlobsOptions {
  readonly apply: boolean;
  readonly accountId?: string;
  readonly verify?: boolean;
  readonly orphansOut?: string;
  readonly quiet?: boolean;
}

export interface OrphanedMediaPath {
  readonly accountId: string;
  readonly checksum: string;
  readonly bucketPath: string;
  readonly sizeBytes: number;
}

export interface BackfillMediaBlobsReport {
  readonly groups: number;
  readonly linkedRows: number;
  readonly createdBlobs: number;
  readonly skippedGroups: number;
  readonly orphanPaths: readonly OrphanedMediaPath[];
  readonly orphanBytes: number;
}

interface CanonicalObject {
  readonly bucketPath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

const chunksOf = <T>(items: readonly T[], size: number): readonly (readonly T[])[] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const splitBucketPath = (
  bucketPath: string,
  accountId: string,
): { readonly bucket: BucketName; readonly objectPath: string } | null => {
  const slash = bucketPath.indexOf('/');
  if (slash < 0) return null;
  const bucket = bucketPath.slice(0, slash) as BucketName;
  const objectPath = bucketPath.slice(slash + 1);
  return objectPath.startsWith(`${accountId}/`) ? { bucket, objectPath } : null;
};

/** `--verify` prova existência e conteúdo; sem ele o script não faz GET algum. */
const verifyCanonical = async (
  accountId: string,
  checksum: string,
  canonical: CanonicalObject,
): Promise<boolean> => {
  const location = splitBucketPath(canonical.bucketPath, accountId);
  if (!location) return false;
  const data = await storage.download(location.bucket, location.objectPath);
  return Boolean(data && createHash('sha256').update(data).digest('hex') === checksum);
};

export const backfillMediaBlobs = async (
  options: BackfillMediaBlobsOptions,
): Promise<BackfillMediaBlobsReport> => {
  const log = (...parts: readonly unknown[]) => {
    if (!options.quiet) console.log(...parts);
  };

  const grouped = await prisma.mediaObject.groupBy({
    by: ['accountId', 'checksum'],
    where: {
      mediaKind: 'mensagem',
      blobId: null,
      checksum: { not: null },
      ...(options.accountId ? { accountId: options.accountId } : {}),
    },
    orderBy: [{ accountId: 'asc' }, { checksum: 'asc' }],
  });
  const groups = grouped.flatMap((group) =>
    group.checksum ? [{ accountId: group.accountId, checksum: group.checksum }] : [],
  );

  let linkedRows = 0;
  let createdBlobs = 0;
  let skippedGroups = 0;
  const orphanPaths = new Map<string, OrphanedMediaPath>();
  let processedGroups = 0;

  for (const batch of chunksOf(groups, GROUP_BATCH_SIZE)) {
    for (const group of batch) {
      const rows = await prisma.mediaObject.findMany({
        where: {
          accountId: group.accountId,
          checksum: group.checksum,
          mediaKind: 'mensagem',
          blobId: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (rows.length === 0) continue;

      const existingBlob = await prisma.mediaBlob.findUnique({
        where: {
          accountId_checksum: { accountId: group.accountId, checksum: group.checksum },
        },
      });
      const oldest = rows[0];
      if (!oldest) continue;
      const canonical: CanonicalObject = existingBlob ?? {
        bucketPath: oldest.bucketPath,
        mimeType: oldest.mimeType,
        sizeBytes: oldest.sizeBytes,
      };

      if (options.verify && !(await verifyCanonical(group.accountId, group.checksum, canonical))) {
        skippedGroups += 1;
        log(`  ignorado ${group.accountId}/${group.checksum.slice(0, 12)}: objeto inválido`);
        continue;
      }

      const projectedOrphans = rows.filter((row) => row.bucketPath !== canonical.bucketPath);

      if (options.apply) {
        const applied = await prisma.$transaction(async (tx) => {
          const currentRows = await tx.mediaObject.findMany({
            where: {
              accountId: group.accountId,
              checksum: group.checksum,
              mediaKind: 'mensagem',
              blobId: null,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          const currentOldest = currentRows[0];
          if (!currentOldest) return null;

          // `upsert` fecha a corrida com o worker novo sem deixar uma
          // transação PostgreSQL abortada por P2002.
          const blob = await tx.mediaBlob.upsert({
            where: {
              accountId_checksum: { accountId: group.accountId, checksum: group.checksum },
            },
            create: {
              accountId: group.accountId,
              checksum: group.checksum,
              bucketPath: currentOldest.bucketPath,
              mimeType: currentOldest.mimeType,
              sizeBytes: currentOldest.sizeBytes,
            },
            update: {},
          });
          const updated = await tx.mediaObject.updateMany({
            where: {
              accountId: group.accountId,
              checksum: group.checksum,
              mediaKind: 'mensagem',
              blobId: null,
            },
            data: { blobId: blob.id, bucketPath: blob.bucketPath },
          });
          return {
            linkedRows: updated.count,
            createdBlob: !existingBlob,
            canonicalPath: blob.bucketPath,
            rows: currentRows,
          };
        });
        if (!applied) continue;
        linkedRows += applied.linkedRows;
        if (applied.createdBlob) createdBlobs += 1;
        for (const row of applied.rows) {
          if (row.bucketPath === applied.canonicalPath) continue;
          orphanPaths.set(row.bucketPath, {
            accountId: group.accountId,
            checksum: group.checksum,
            bucketPath: row.bucketPath,
            sizeBytes: row.sizeBytes,
          });
        }
      } else {
        linkedRows += rows.length;
        if (!existingBlob) createdBlobs += 1;
        for (const row of projectedOrphans) {
          orphanPaths.set(row.bucketPath, {
            accountId: group.accountId,
            checksum: group.checksum,
            bucketPath: row.bucketPath,
            sizeBytes: row.sizeBytes,
          });
        }
      }

      processedGroups += 1;
    }
    log(`  ${Math.min(processedGroups + skippedGroups, groups.length)}/${groups.length} grupos`);
  }

  const sortedOrphans = [...orphanPaths.values()].sort((a, b) =>
    a.bucketPath.localeCompare(b.bucketPath),
  );
  const report: BackfillMediaBlobsReport = {
    groups: groups.length,
    linkedRows,
    createdBlobs,
    skippedGroups,
    orphanPaths: sortedOrphans,
    orphanBytes: sortedOrphans.reduce((total, orphan) => total + orphan.sizeBytes, 0),
  };

  if (options.orphansOut) {
    const output = path.resolve(options.orphansOut);
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await fsp.writeFile(output, `${JSON.stringify(sortedOrphans, null, 2)}\n`, 'utf8');
    log(`Órfãos gravados em ${output}`);
  }

  return report;
};

const parseArgs = (args: readonly string[]): BackfillMediaBlobsOptions => {
  let apply = false;
  let verify = false;
  let accountId: string | undefined;
  let orphansOut: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--verify') verify = true;
    else if (arg === '--account') accountId = args[++index];
    else if (arg === '--orphans-out') orphansOut = args[++index];
    else throw new Error(`Opção desconhecida: ${arg ?? '(vazia)'}`);
  }

  if (args.includes('--account') && !accountId) throw new Error('Informe o id após --account.');
  if (args.includes('--orphans-out') && !orphansOut) {
    throw new Error('Informe o arquivo após --orphans-out.');
  }
  return {
    apply,
    verify,
    ...(accountId ? { accountId } : {}),
    ...(orphansOut ? { orphansOut } : {}),
  };
};

const printReport = (options: BackfillMediaBlobsOptions, report: BackfillMediaBlobsReport) => {
  console.log(`\nBackfill de mídia — ${options.apply ? 'APLICADO' : 'SIMULAÇÃO'}`);
  console.log(`  grupos:            ${report.groups}`);
  console.log(`  linhas vinculadas: ${report.linkedRows}`);
  console.log(`  blobs criados:     ${report.createdBlobs}`);
  console.log(`  grupos ignorados:  ${report.skippedGroups}`);
  console.log(`  caminhos órfãos:   ${report.orphanPaths.length}`);
  console.log(`  bytes órfãos:      ${report.orphanBytes}`);
};

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  const options = parseArgs(process.argv.slice(2));
  backfillMediaBlobs(options)
    .then(async (report) => {
      printReport(options, report);
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('\nFalha no backfill de mídia:', error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
