-- DropIndex
DROP INDEX "MediaObject_bucketPath_key";

-- AlterTable
ALTER TABLE "MediaObject" ADD COLUMN     "blobId" TEXT;

-- CreateTable
CREATE TABLE "MediaBlob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "bucketPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaBlob_bucketPath_key" ON "MediaBlob"("bucketPath");

-- CreateIndex
CREATE UNIQUE INDEX "MediaBlob_accountId_checksum_key" ON "MediaBlob"("accountId", "checksum");

-- CreateIndex
CREATE INDEX "MediaObject_bucketPath_idx" ON "MediaObject"("bucketPath");

-- CreateIndex
CREATE INDEX "MediaObject_blobId_idx" ON "MediaObject"("blobId");

-- AddForeignKey
ALTER TABLE "MediaObject" ADD CONSTRAINT "MediaObject_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "MediaBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBlob" ADD CONSTRAINT "MediaBlob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
