/*
  Warnings:

  - Added the required column `owner` to the `adjustments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `owner` to the `material_usages` table without a default value. This is not possible if the table is not empty.
  - Added the required column `owner` to the `production_outputs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "adjustments" ADD COLUMN     "owner" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "material_usages" ADD COLUMN     "owner" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "production_outputs" ADD COLUMN     "owner" INTEGER NOT NULL;

-- RenameIndex
ALTER INDEX "stock_daily_snapshot_uom_company_item_snapshot_key" RENAME TO "stock_daily_snapshot_company_code_item_type_item_code_uom_s_key";
