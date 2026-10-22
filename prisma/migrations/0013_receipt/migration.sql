-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'VALIDATED');

-- CreateEnum
CREATE TYPE "ReceiptLineState" AS ENUM ('MATCHED', 'AMBIGUOUS', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'RECEIPT';

-- CreateTable
CREATE TABLE "ReceiptLabelAlias" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptLabelAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "rawLabel" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "productId" TEXT,
    "state" "ReceiptLineState" NOT NULL,
    "candidateIds" TEXT[],

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptLabelAlias_label_key" ON "ReceiptLabelAlias"("label");

-- CreateIndex
CREATE INDEX "ReceiptLabelAlias_productId_idx" ON "ReceiptLabelAlias"("productId");

-- CreateIndex
CREATE INDEX "Receipt_locationId_idx" ON "Receipt"("locationId");

-- CreateIndex
CREATE INDEX "Receipt_createdById_idx" ON "Receipt"("createdById");

-- CreateIndex
CREATE INDEX "ReceiptLine_receiptId_position_idx" ON "ReceiptLine"("receiptId", "position");

-- CreateIndex
CREATE INDEX "ReceiptLine_productId_idx" ON "ReceiptLine"("productId");

-- AddForeignKey
ALTER TABLE "ReceiptLabelAlias" ADD CONSTRAINT "ReceiptLabelAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

