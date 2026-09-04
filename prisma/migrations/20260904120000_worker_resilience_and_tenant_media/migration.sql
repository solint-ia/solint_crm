-- Resiliência do worker, fencing, outboxes duráveis e escopo de mídia.

ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatchError" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Message_idempotencyKey_key"
  ON "Message"("idempotencyKey");

ALTER TABLE "WhatsAppConnection"
  ADD COLUMN IF NOT EXISTS "lockVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "credsKeyId" TEXT;

ALTER TABLE "WhatsAppKey"
  ADD COLUMN IF NOT EXISTS "encryptionKeyId" TEXT;

ALTER TABLE "WhatsAppCommand"
  ADD COLUMN IF NOT EXISTS "sequence" BIGSERIAL,
  ADD COLUMN IF NOT EXISTS "workerId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "result" JSONB,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

DROP INDEX IF EXISTS "WhatsAppCommand_status_createdAt_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppCommand_idempotencyKey_key"
  ON "WhatsAppCommand"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppCommand_sequence_key"
  ON "WhatsAppCommand"("sequence");
CREATE INDEX IF NOT EXISTS "WhatsAppCommand_status_availableAt_createdAt_idx"
  ON "WhatsAppCommand"("status", "availableAt", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppCommand_status_leaseUntil_idx"
  ON "WhatsAppCommand"("status", "leaseUntil");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WhatsAppCommand_inboxId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppCommand"
      ADD CONSTRAINT "WhatsAppCommand_inboxId_fkey"
      FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id")
      ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

-- Comandos deixados em processing por versões sem lease não podem permanecer
-- invisíveis para sempre. Envios são marcados como falha para revisão, pois a
-- versão antiga não usava um id estável no provedor e repeti-los poderia duplicar.
UPDATE "WhatsAppCommand"
SET
  "status" = CASE WHEN "kind" IN ('send', 'send_media') THEN 'failed' ELSE 'pending' END,
  "error" = CASE
    WHEN "kind" IN ('send', 'send_media')
      THEN 'Comando legado interrompido; confirme a entrega antes de reenviar.'
    ELSE 'Comando recuperado após interrupção do worker.'
  END,
  "workerId" = NULL,
  "claimedAt" = NULL,
  "leaseUntil" = NULL,
  "availableAt" = CURRENT_TIMESTAMP
WHERE "status" = 'processing';

-- Bolhas antigas sem comando correspondente não podem continuar em "enviando".
UPDATE "Message" AS m
SET
  "deliveryStatus" = 'falha',
  "dispatchError" = 'Envio antigo sem comando na fila; confirme antes de reenviar.'
WHERE m."deliveryStatus" = 'enviando'
  AND m."createdAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
  AND NOT EXISTS (
    SELECT 1
    FROM "WhatsAppCommand" AS c
    WHERE c."payload"->>'messageId' = m."id"
      AND c."status" IN ('pending', 'processing')
  );

ALTER TABLE "ScheduledMessage"
  ADD COLUMN IF NOT EXISTS "workerId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ScheduledMessage_status_leaseUntil_idx"
  ON "ScheduledMessage"("status", "leaseUntil");

-- Agendamentos legados interrompidos ficam visíveis como falha. Repetir sem
-- saber se o provedor recebeu seria mais perigoso que exigir revisão manual.
UPDATE "ScheduledMessage"
SET
  "status" = 'failed',
  "error" = 'Execução interrompida por versão antiga do worker; revise antes de reenviar.',
  "workerId" = NULL,
  "claimedAt" = NULL,
  "leaseUntil" = NULL
WHERE "status" = 'sending';

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "webhookId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
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
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookDelivery_webhookId_fkey"
    FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WebhookDelivery_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_webhookId_dedupeKey_key"
  ON "WebhookDelivery"("webhookId", "dedupeKey");
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_sequence_key"
  ON "WebhookDelivery"("sequence");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_availableAt_createdAt_idx"
  ON "WebhookDelivery"("status", "availableAt", "createdAt");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_leaseUntil_idx"
  ON "WebhookDelivery"("status", "leaseUntil");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_accountId_createdAt_idx"
  ON "WebhookDelivery"("accountId", "createdAt");

CREATE TABLE IF NOT EXISTS "BackgroundLease" (
  "name" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "leaseUntil" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackgroundLease_pkey" PRIMARY KEY ("name")
);

ALTER TABLE "MediaObject"
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "scopeKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "mediaKind" TEXT NOT NULL DEFAULT 'mensagem';

-- O caminho no Storage é a fonte de verdade do objeto que realmente existe.
-- Para mídia de mensagem ele também contém uma inbox válida da mesma conta.
UPDATE "MediaObject" AS m
SET
  "accountId" = i."accountId",
  "inboxId" = i."id"
FROM "Inbox" AS i
WHERE m."bucketPath" LIKE 'whatsapp-media/%'
  AND i."id" = split_part(m."bucketPath", '/', 3)
  AND i."accountId" = split_part(m."bucketPath", '/', 2)
  AND (m."accountId" <> i."accountId" OR m."inboxId" IS DISTINCT FROM i."id");

UPDATE "MediaObject" AS m
SET
  "accountId" = a."id",
  "inboxId" = NULL
FROM "Account" AS a
WHERE m."bucketPath" LIKE 'whatsapp-avatars/%'
  AND a."id" = split_part(m."bucketPath", '/', 2)
  AND (m."accountId" <> a."id" OR m."inboxId" IS NOT NULL);

UPDATE "MediaObject"
SET
  "sourceId" = CASE WHEN "sourceId" = '' THEN "id" ELSE "sourceId" END,
  "scopeKey" = COALESCE("inboxId", 'account'),
  "mediaKind" = CASE
    WHEN "bucketPath" LIKE 'whatsapp-avatars/%' THEN 'avatar'
    ELSE 'mensagem'
  END;

ALTER TABLE "MediaObject"
  ALTER COLUMN "sourceId" DROP DEFAULT,
  ALTER COLUMN "scopeKey" DROP DEFAULT,
  ALTER COLUMN "mediaKind" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "MediaObject_accountId_scopeKey_mediaKind_sourceId_key"
  ON "MediaObject"("accountId", "scopeKey", "mediaKind", "sourceId");
