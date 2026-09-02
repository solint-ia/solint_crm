-- Estado da conta: suspender e excluir sem apagar linha nenhuma.
ALTER TABLE "Account" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ativa';
ALTER TABLE "Account" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "suspendedReason" TEXT;

-- Contato arquivado: sai da agenda, a conversa e as mensagens ficam.
ALTER TABLE "Contact" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Contact_accountId_deletedAt_idx" ON "Contact"("accountId", "deletedAt");
