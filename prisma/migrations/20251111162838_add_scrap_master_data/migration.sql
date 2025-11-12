-- CreateTable
CREATE TABLE "ScrapMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapItem" (
    "id" TEXT NOT NULL,
    "scrapId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrapMaster_code_key" ON "ScrapMaster"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapItem_scrapId_itemId_key" ON "ScrapItem"("scrapId", "itemId");

-- AddForeignKey
ALTER TABLE "ScrapItem" ADD CONSTRAINT "ScrapItem_scrapId_fkey" FOREIGN KEY ("scrapId") REFERENCES "ScrapMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapItem" ADD CONSTRAINT "ScrapItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
