-- AlterTable
ALTER TABLE "material_usage_items" ADD COLUMN     "amount" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "material_usages" ADD COLUMN     "section" VARCHAR(100);

-- AlterTable
ALTER TABLE "production_output_items" ADD COLUMN     "amount" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "production_outputs" ADD COLUMN     "section" VARCHAR(100);
