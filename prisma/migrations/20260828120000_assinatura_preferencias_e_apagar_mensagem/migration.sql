-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB,
ADD COLUMN     "signatureEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedAt" TIMESTAMP(3);
