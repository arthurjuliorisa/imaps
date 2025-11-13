-- CreateEnum
CREATE TYPE "BeginningStockType" AS ENUM ('RAW_MATERIAL', 'FINISH_GOOD', 'CAPITAL_GOODS');

-- CreateTable
CREATE TABLE "BeginningStock" (
    "id" TEXT NOT NULL,
    "type" "BeginningStockType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "uomId" TEXT NOT NULL,
    "beginningBalance" DOUBLE PRECISION NOT NULL,
    "beginningDate" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeginningStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BeginningStock_type_idx" ON "BeginningStock"("type");

-- CreateIndex
CREATE INDEX "BeginningStock_itemId_idx" ON "BeginningStock"("itemId");

-- CreateIndex
CREATE INDEX "BeginningStock_beginningDate_idx" ON "BeginningStock"("beginningDate");

-- CreateIndex
CREATE UNIQUE INDEX "BeginningStock_type_itemId_beginningDate_key" ON "BeginningStock"("type", "itemId", "beginningDate");

-- AddForeignKey
ALTER TABLE "BeginningStock" ADD CONSTRAINT "BeginningStock_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeginningStock" ADD CONSTRAINT "BeginningStock_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UOM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
