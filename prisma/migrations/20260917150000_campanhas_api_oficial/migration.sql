-- Campanhas pela API oficial: público, mapeamento das variáveis, ritmo e
-- rastro do executor (cancelamento, último erro, quem criou).
ALTER TABLE "Campaign"
  ALTER COLUMN "status" SET DEFAULT 'rascunho',
  ADD COLUMN "audience" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "variables" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "rateLimit" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "canceledAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "createdById" TEXT;

-- Linhas antigas gravadas com os nomes em inglês do protótipo.
UPDATE "Campaign" SET "status" = CASE "status"
  WHEN 'draft' THEN 'rascunho'
  WHEN 'scheduled' THEN 'agendada'
  WHEN 'running' THEN 'em_andamento'
  WHEN 'paused' THEN 'pausada'
  WHEN 'completed' THEN 'concluida'
  WHEN 'canceled' THEN 'cancelada'
  ELSE "status" END;

ALTER TABLE "CampaignRecipient" ADD COLUMN "conversationId" TEXT;

CREATE INDEX "CampaignRecipient_phone_status_idx" ON "CampaignRecipient"("phone", "status");
