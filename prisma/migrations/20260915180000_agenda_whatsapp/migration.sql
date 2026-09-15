-- CreateTable
CREATE TABLE "WhatsAppAddressBookName" (
    "accountId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "ownerJid" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAddressBookName_pkey" PRIMARY KEY ("inboxId","ownerJid","jid")
);

-- CreateIndex
CREATE INDEX "WhatsAppAddressBookName_accountId_idx" ON "WhatsAppAddressBookName"("accountId");

-- AddForeignKey
ALTER TABLE "WhatsAppAddressBookName" ADD CONSTRAINT "WhatsAppAddressBookName_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppAddressBookName" ADD CONSTRAINT "WhatsAppAddressBookName_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "Inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
