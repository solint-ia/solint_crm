-- AlterTable
ALTER TABLE "WhatsAppConnection"
ADD COLUMN "historyImportDays" INTEGER,
ADD COLUMN "historyImportCutoff" TIMESTAMP(3),
ADD COLUMN "historyImportStatus" TEXT,
ADD COLUMN "historyImportStartedAt" TIMESTAMP(3),
ADD COLUMN "historyImportEndedAt" TIMESTAMP(3),
ADD COLUMN "historyImportStats" JSONB,
ADD COLUMN "historyOwnerPhoneJid" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "importedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PendingMedia" (
    "messageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "cipher" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "keyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMedia_pkey" PRIMARY KEY ("messageId")
);

-- Preserve the number that owned the existing history before a future logout.
UPDATE "WhatsAppConnection" AS connection
SET "historyOwnerPhoneJid" = COALESCE(
    connection."phoneJid",
    CASE
        WHEN inbox."identifier" LIKE '%@s.whatsapp.net' THEN inbox."identifier"
        ELSE NULL
    END
)
FROM "Inbox" AS inbox
WHERE inbox."id" = connection."inboxId"
  AND connection."historyOwnerPhoneJid" IS NULL;

-- CreateIndex
CREATE INDEX "Conversation_accountId_importedAt_idx"
ON "Conversation"("accountId", "importedAt");

-- CreateIndex
CREATE INDEX "PendingMedia_accountId_inboxId_status_idx"
ON "PendingMedia"("accountId", "inboxId", "status");

-- AddForeignKey
ALTER TABLE "PendingMedia"
ADD CONSTRAINT "PendingMedia_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMedia"
ADD CONSTRAINT "PendingMedia_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMedia"
ADD CONSTRAINT "PendingMedia_inboxId_fkey"
FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
