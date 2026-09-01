ALTER TABLE "PipelineStage"
ADD COLUMN "conversionWeight" INTEGER NOT NULL DEFAULT 0;

UPDATE "PipelineStage"
SET "conversionWeight" = 100
WHERE "isWon" = true;

UPDATE "PipelineStage"
SET "conversionWeight" = 50
WHERE "isWon" = false
  AND "isLost" = false
  AND lower("name") LIKE '%negocia%';
