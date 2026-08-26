-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "teams";

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "inboxIds",
DROP COLUMN "members";
