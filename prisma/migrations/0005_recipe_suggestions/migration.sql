-- Fournées de suggestions de recettes et journal d'appels partagé (EF-26).
--
-- Ajout pur : aucune colonne existante n'est retouchée, aucune donnée n'est
-- réécrite. Le scan continue de fonctionner à l'identique, "purpose" valant
-- "VISION" par défaut pour toutes les lignes déjà en base comme pour les
-- nouvelles écritures du scan.

-- CreateEnum
CREATE TYPE "AiPurpose" AS ENUM ('VISION', 'RECIPE_SUGGESTION');

-- AlterTable
ALTER TABLE "RecognitionLog" ADD COLUMN "purpose" "AiPurpose" NOT NULL DEFAULT 'VISION';

-- CreateIndex
CREATE INDEX "RecognitionLog_purpose_createdAt_idx" ON "RecognitionLog"("purpose", "createdAt");

-- CreateTable
CREATE TABLE "SuggestionBatch" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "costCents" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionBatch_signature_key" ON "SuggestionBatch"("signature");

-- CreateIndex
CREATE INDEX "SuggestionBatch_createdAt_idx" ON "SuggestionBatch"("createdAt");
