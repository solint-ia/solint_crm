-- Tetos por conta definidos pela plataforma (nulo = sem limite) e a conta de
-- origem de cada workspace criado pelo CRM, para o teto de workspaces ter o
-- que contar.
ALTER TABLE "Account"
  ADD COLUMN "maxInboxes" INTEGER,
  ADD COLUMN "maxWorkspaces" INTEGER,
  ADD COLUMN "rootAccountId" TEXT;

CREATE INDEX "Account_rootAccountId_idx" ON "Account"("rootAccountId");
