ALTER TABLE "Contact"
ADD COLUMN "whatsapp_opt_out_at" TIMESTAMP(3),
ADD COLUMN "whatsapp_opt_out_reason" TEXT,
ADD COLUMN "whatsapp_opt_in_at" TIMESTAMP(3);

CREATE INDEX "Contact_accountId_whatsapp_opt_out_at_idx"
ON "Contact"("accountId", "whatsapp_opt_out_at");
