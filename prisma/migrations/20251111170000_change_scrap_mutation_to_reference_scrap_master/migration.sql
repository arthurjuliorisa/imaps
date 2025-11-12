-- DropForeignKey
ALTER TABLE "ScrapMutation" DROP CONSTRAINT "ScrapMutation_itemId_fkey";

-- DropIndex
DROP INDEX "ScrapMutation_date_itemId_key";

-- AlterTable
ALTER TABLE "ScrapMutation"
  DROP COLUMN "itemId",
  ADD COLUMN "scrapId" TEXT;

-- Step 1: For any existing data, we need to handle the migration
-- Since this is a breaking change and we're changing the reference model,
-- existing data cannot be automatically migrated without business logic.
-- You may need to manually migrate existing ScrapMutation records or clear the table.

-- WARNING: The following line will DELETE all existing scrap mutation data
-- Comment this out if you want to manually migrate data instead
DELETE FROM "ScrapMutation";

-- Step 2: Make scrapId required after data migration/deletion
ALTER TABLE "ScrapMutation" ALTER COLUMN "scrapId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ScrapMutation_date_scrapId_key" ON "ScrapMutation"("date", "scrapId");

-- AddForeignKey
ALTER TABLE "ScrapMutation" ADD CONSTRAINT "ScrapMutation_scrapId_fkey" FOREIGN KEY ("scrapId") REFERENCES "ScrapMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
