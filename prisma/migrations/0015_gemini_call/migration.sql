-- CreateTable
CREATE TABLE "GeminiCall" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "tokens" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeminiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeminiCall_createdAt_idx" ON "GeminiCall"("createdAt");
