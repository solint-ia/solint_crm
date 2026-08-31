-- AlterTable
ALTER TABLE "Inbox" ADD COLUMN IF NOT EXISTS "closingMessage" JSONB;
ALTER TABLE "Inbox" ADD COLUMN IF NOT EXISTS "waitingMessage" JSONB;
