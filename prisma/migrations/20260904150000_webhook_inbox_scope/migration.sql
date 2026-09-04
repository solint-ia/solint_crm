-- Webhooks existentes continuam recebendo todas as caixas. Webhooks novos
-- informam explicitamente allInboxes na action do superadmin.
ALTER TABLE "Webhook"
ADD COLUMN "allInboxes" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "WebhookInbox" (
    "webhookId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("webhookId", "inboxId")
);

CREATE INDEX "WebhookInbox_inboxId_idx" ON "WebhookInbox"("inboxId");

ALTER TABLE "WebhookInbox"
ADD CONSTRAINT "WebhookInbox_webhookId_fkey"
FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookInbox"
ADD CONSTRAINT "WebhookInbox_inboxId_fkey"
FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
ADD COLUMN "inboxId" TEXT;

CREATE INDEX "WebhookDelivery_webhookId_inboxId_status_idx"
ON "WebhookDelivery"("webhookId", "inboxId", "status");

ALTER TABLE "WebhookDelivery"
ADD CONSTRAINT "WebhookDelivery_inboxId_fkey"
FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
