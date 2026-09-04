import { prisma } from '@/infrastructure/db/prisma';

export interface BackgroundLeaseHandle {
  readonly name: string;
  readonly owner: string;
  readonly version: number;
  readonly ttlMs: number;
}

/** Lease global com relógio do Postgres e fencing monotônico. */
export const acquireBackgroundLease = async (
  name: string,
  owner: string,
  ttlMs: number,
): Promise<BackgroundLeaseHandle | null> => {
  const rows = await prisma.$queryRaw<Array<{ version: number }>>`
    INSERT INTO "BackgroundLease" ("name", "owner", "version", "leaseUntil", "updatedAt")
    VALUES (
      ${name},
      ${owner},
      1,
      CURRENT_TIMESTAMP + (${ttlMs} * INTERVAL '1 millisecond'),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("name") DO UPDATE SET
      "owner" = EXCLUDED."owner",
      "version" = "BackgroundLease"."version" + 1,
      "leaseUntil" = EXCLUDED."leaseUntil",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "BackgroundLease"."owner" = ${owner}
       OR "BackgroundLease"."leaseUntil" <= CURRENT_TIMESTAMP
    RETURNING "version"
  `;
  const version = rows[0]?.version;
  return version === undefined ? null : { name, owner, version, ttlMs };
};

export const renewBackgroundLease = async (lease: BackgroundLeaseHandle): Promise<boolean> => {
  const count = await prisma.$executeRaw`
    UPDATE "BackgroundLease"
    SET
      "leaseUntil" = CURRENT_TIMESTAMP + (${lease.ttlMs} * INTERVAL '1 millisecond'),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "name" = ${lease.name}
      AND "owner" = ${lease.owner}
      AND "version" = ${lease.version}
  `;
  return count === 1;
};

export const releaseBackgroundLease = async (lease: BackgroundLeaseHandle): Promise<void> => {
  await prisma.backgroundLease.deleteMany({
    where: { name: lease.name, owner: lease.owner, version: lease.version },
  });
};
