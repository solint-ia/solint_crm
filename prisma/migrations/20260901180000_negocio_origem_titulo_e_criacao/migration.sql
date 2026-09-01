-- Três colunas que a tela já coletava e o banco jogava fora.
--
-- `title` e `source` viajavam da modal de nova oportunidade até a assinatura do
-- repositório e morriam ali: o título só sobrevivia dentro do texto do
-- histórico, e a origem não sobrevivia em lugar nenhum. O filtro de Origem do
-- Kanban existia na barra e nunca casava com card nenhum.
ALTER TABLE "Deal" ADD COLUMN "title" TEXT;
ALTER TABLE "Deal" ADD COLUMN "source" TEXT;

-- `createdAt` para o filtro de período dizer a verdade.
--
-- O único campo temporal do card era `enteredStageAt`, que é a entrada na etapa
-- atual: um card criado ontem e movido hoje apareceria em "Criados hoje". O
-- backfill usa `enteredStageAt` porque é a melhor aproximação que existe para as
-- linhas antigas, e é sempre <= a criação real.
ALTER TABLE "Deal" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Deal"
SET "createdAt" = COALESCE(NULLIF("enteredStageAt", '')::timestamp, CURRENT_TIMESTAMP);

CREATE INDEX "Deal_accountId_createdAt_idx" ON "Deal"("accountId", "createdAt");
