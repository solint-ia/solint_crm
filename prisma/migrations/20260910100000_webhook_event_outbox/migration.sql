CREATE TABLE "WebhookEventOutbox" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "inboxId" TEXT,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEventOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookEventOutbox_sequence_key" ON "WebhookEventOutbox"("sequence");
CREATE UNIQUE INDEX "WebhookEventOutbox_dedupeKey_key" ON "WebhookEventOutbox"("dedupeKey");
CREATE INDEX "WebhookEventOutbox_status_availableAt_sequence_idx" ON "WebhookEventOutbox"("status", "availableAt", "sequence");
CREATE INDEX "WebhookEventOutbox_status_leaseUntil_idx" ON "WebhookEventOutbox"("status", "leaseUntil");
CREATE INDEX "WebhookEventOutbox_accountId_sequence_idx" ON "WebhookEventOutbox"("accountId", "sequence");
