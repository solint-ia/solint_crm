-- CreateTable
CREATE TABLE IF NOT EXISTS "Inbox" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "teamName" TEXT,
    "businessHours" JSONB NOT NULL,
    "awayMessage" JSONB NOT NULL,
    "greeting" JSONB NOT NULL,
    "webhookUrl" TEXT,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- Seed default Inboxes for existing accounts so foreign keys match
INSERT INTO "Inbox" ("id", "accountId", "name", "channel", "identifier", "status", "provider", "teamName", "businessHours", "awayMessage", "greeting", "webhookUrl")
SELECT 'ibx-wa-oficial', "id", 'WhatsApp · Comercial', 'whatsapp', '+55 79 99999-1000', 'conectado', 'API oficial (Cloud API)', 'Comercial', '{"days":[],"timezone":"America/Sao_Paulo"}', '{"text":"","enabled":false}', '{"text":"","enabled":false}', NULL
FROM "Account" WHERE "id" = 'acc-solint'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Inbox" ("id", "accountId", "name", "channel", "identifier", "status", "provider", "teamName", "businessHours", "awayMessage", "greeting", "webhookUrl")
SELECT 'ibx-wa-suporte', "id", 'WhatsApp · Suporte', 'whatsapp', '+55 11 98213-4470', 'pareando', 'QR Code (sessão Web)', 'Suporte N1', '{"days":[],"timezone":"America/Sao_Paulo"}', '{"text":"","enabled":false}', '{"text":"","enabled":false}', NULL
FROM "Account" WHERE "id" = 'acc-solint'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Inbox" ("id", "accountId", "name", "channel", "identifier", "status", "provider", "teamName", "businessHours", "awayMessage", "greeting", "webhookUrl")
SELECT 'ibx-instagram', "id", 'Instagram Direct', 'instagram', '@solintcrm', 'conectado', 'Meta Graph API', 'Comercial', '{"days":[],"timezone":"America/Sao_Paulo"}', '{"text":"","enabled":false}', '{"text":"","enabled":false}', NULL
FROM "Account" WHERE "id" = 'acc-solint'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Inbox" ("id", "accountId", "name", "channel", "identifier", "status", "provider", "teamName", "businessHours", "awayMessage", "greeting", "webhookUrl")
SELECT 'ibx-webchat', "id", 'Webchat do site', 'webchat', 'solint.com.br', 'desconectado', 'Widget embarcado', NULL, '{"days":[],"timezone":"America/Sao_Paulo"}', '{"text":"","enabled":false}', '{"text":"","enabled":false}', NULL
FROM "Account" WHERE "id" = 'acc-solint'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Inbox" ("id", "accountId", "name", "channel", "identifier", "status", "provider", "teamName", "businessHours", "awayMessage", "greeting", "webhookUrl")
SELECT 'ibx-email', "id", 'E-mail (IMAP/SMTP)', 'email', 'suporte@solint.com', 'conectado', 'IMAP + SMTP', 'Financeiro', '{"days":[],"timezone":"America/Sao_Paulo"}', '{"text":"","enabled":false}', '{"text":"","enabled":false}', NULL
FROM "Account" WHERE "id" = 'acc-solint'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Inbox" ("id", "accountId", "name", "channel", "identifier", "status", "provider", "teamName", "businessHours", "awayMessage", "greeting", "webhookUrl")
SELECT 'ibx-telegram', "id", 'Telegram', 'telegram', '—', 'nao_configurado', 'Bot API', NULL, '{"days":[],"timezone":"America/Sao_Paulo"}', '{"text":"","enabled":false}', '{"text":"","enabled":false}', NULL
FROM "Account" WHERE "id" = 'acc-solint'
ON CONFLICT ("id") DO NOTHING;

-- DropTable if exists
DROP TABLE IF EXISTS "ChannelConnection";

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppConnection" (
    "inboxId" TEXT NOT NULL,
    "phoneJid" TEXT,
    "profileName" TEXT,
    "pairedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'desconectado',
    "lastError" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "qrPayload" TEXT,
    "qrExpiresAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "credsCipher" BYTEA,
    "credsIv" BYTEA,
    "credsTag" BYTEA,
    "lockOwner" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("inboxId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppKey" (
    "inboxId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "valueCipher" BYTEA NOT NULL,
    "valueIv" BYTEA NOT NULL,
    "valueTag" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppKey_pkey" PRIMARY KEY ("inboxId","category","keyId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppCommand" (
    "id" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Inbox_accountId_idx" ON "Inbox"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppKey_inboxId_category_idx" ON "WhatsAppKey"("inboxId", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppCommand_inboxId_status_idx" ON "WhatsAppCommand"("inboxId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppCommand_status_createdAt_idx" ON "WhatsAppCommand"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_inboxId_channelThreadId_key" ON "Conversation"("inboxId", "channelThreadId");

-- AddForeignKey
ALTER TABLE "Inbox" DROP CONSTRAINT IF EXISTS "Inbox_accountId_fkey";
ALTER TABLE "Inbox" ADD CONSTRAINT "Inbox_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_inboxId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" DROP CONSTRAINT IF EXISTS "WhatsAppConnection_inboxId_fkey";
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppKey" DROP CONSTRAINT IF EXISTS "WhatsAppKey_inboxId_fkey";
ALTER TABLE "WhatsAppKey" ADD CONSTRAINT "WhatsAppKey_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "WhatsAppConnection"("inboxId") ON DELETE CASCADE ON UPDATE CASCADE;
