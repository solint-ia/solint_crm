ALTER TABLE "Message" ADD COLUMN "authorId" TEXT;

CREATE INDEX "Message_authorId_idx" ON "Message"("authorId");
CREATE INDEX "AuditLogEntry_createdAt_idx" ON "AuditLogEntry"("createdAt");
CREATE INDEX "AuditLogEntry_accountId_action_createdAt_idx"
ON "AuditLogEntry"("accountId", "action", "createdAt");
