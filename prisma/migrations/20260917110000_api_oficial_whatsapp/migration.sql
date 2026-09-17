-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "whatsappUserId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "channelMeta" JSONB;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "wabaId" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppCloudConnection" (
    "inboxId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "coexistence" BOOLEAN NOT NULL DEFAULT false,
    "businessId" TEXT,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "messagingLimit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'conectando',
    "lastError" TEXT,
    "tokenCipher" BYTEA NOT NULL,
    "tokenIv" BYTEA NOT NULL,
    "tokenTag" BYTEA NOT NULL,
    "tokenKeyId" TEXT,
    "appId" TEXT,
    "appSecretCipher" BYTEA,
    "appSecretIv" BYTEA,
    "appSecretTag" BYTEA,
    "appSecretKeyId" TEXT,
    "pinCipher" BYTEA,
    "pinIv" BYTEA,
    "pinTag" BYTEA,
    "pinKeyId" TEXT,
    "webhookKey" TEXT NOT NULL,
    "verifyTokenHash" TEXT NOT NULL,
    "subscribedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "contactsSyncAt" TIMESTAMP(3),
    "historySyncAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "connectedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppCloudConnection_pkey" PRIMARY KEY ("inboxId")
);

-- CreateTable
CREATE TABLE "WhatsAppCloudEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "inboxId" TEXT,
    "phoneNumberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "orderKey" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "workerId" TEXT,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppCloudEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCloudConnection_phoneNumberId_key" ON "WhatsAppCloudConnection"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCloudConnection_webhookKey_key" ON "WhatsAppCloudConnection"("webhookKey");

-- CreateIndex
CREATE INDEX "WhatsAppCloudConnection_accountId_idx" ON "WhatsAppCloudConnection"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCloudEvent_dedupeKey_key" ON "WhatsAppCloudEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WhatsAppCloudEvent_status_availableAt_idx" ON "WhatsAppCloudEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "WhatsAppCloudEvent_inboxId_receivedAt_idx" ON "WhatsAppCloudEvent"("inboxId", "receivedAt");

-- CreateIndex
CREATE INDEX "WhatsAppCloudEvent_status_processedAt_idx" ON "WhatsAppCloudEvent"("status", "processedAt");

-- CreateIndex
CREATE INDEX "Contact_accountId_whatsappUserId_idx" ON "Contact"("accountId", "whatsappUserId");

-- CreateIndex
CREATE INDEX "MessageTemplate_accountId_wabaId_idx" ON "MessageTemplate"("accountId", "wabaId");

-- AddForeignKey
ALTER TABLE "WhatsAppCloudConnection" ADD CONSTRAINT "WhatsAppCloudConnection_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCloudConnection" ADD CONSTRAINT "WhatsAppCloudConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

