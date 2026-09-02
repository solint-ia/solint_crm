-- O nome empresarial já existia como `company`; apenas damos à coluna física
-- o nome do contrato B2B sem quebrar o campo `company` usado pela aplicação.
ALTER TABLE "Contact" RENAME COLUMN "company" TO "empresa";

ALTER TABLE "Contact"
  ADD COLUMN "cnpj" TEXT,
  ADD COLUMN "endereco" TEXT,
  ADD COLUMN "telefone_empresa" TEXT,
  ADD COLUMN "telefone_socio" TEXT,
  ADD COLUMN "classificacao" TEXT,
  ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE "contact_import_batches" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_import_batch_contacts" (
  "batch_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "row_number" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_import_batch_contacts_pkey" PRIMARY KEY ("batch_id", "contact_id")
);

CREATE INDEX "contact_import_batches_accountId_createdAt_idx"
  ON "contact_import_batches"("account_id", "created_at");

CREATE INDEX "contact_import_batch_contacts_contactId_idx"
  ON "contact_import_batch_contacts"("contact_id");

ALTER TABLE "contact_import_batches"
  ADD CONSTRAINT "contact_import_batches_accountId_fkey"
  FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_import_batch_contacts"
  ADD CONSTRAINT "contact_import_batch_contacts_batchId_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "contact_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_import_batch_contacts"
  ADD CONSTRAINT "contact_import_batch_contacts_contactId_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
