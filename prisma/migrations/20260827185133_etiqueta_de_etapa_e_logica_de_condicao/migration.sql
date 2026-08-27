-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "conditionLogic" TEXT NOT NULL DEFAULT 'e';

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "labelId" TEXT;

-- CreateIndex
CREATE INDEX "PipelineStage_labelId_idx" ON "PipelineStage"("labelId");

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE SET NULL ON UPDATE CASCADE;
