-- Réservoir permanent des suggestions (EF-26, spec du 2026-10-15). Une ligne
-- par recette, clé de dédoublonnage `identity` = `suggestionIdentity` partagée
-- (titre normalisé + URL source). Rien n'est jamais effacé : décision D1,
-- « pas d'âge max, tu logges tout ». `verifiedAt` reste NULL pour une
-- composition du modèle, qui n'a pas de page à vérifier. `pageRecipe` et
-- `pageText` recopient le contenu lu une seule fois (D10), pour que la
-- conservation d'une recette web ne rappelle plus jamais le site.

-- CreateTable
CREATE TABLE "SuggestionPoolRecipe" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "provenance" TEXT NOT NULL,
    "dishType" "DishType" NOT NULL,
    "sourceUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "pageRecipe" JSONB,
    "pageText" TEXT,
    "model" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionPoolRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionPoolRecipe_identity_key" ON "SuggestionPoolRecipe"("identity");

-- CreateIndex
CREATE INDEX "SuggestionPoolRecipe_dishType_idx" ON "SuggestionPoolRecipe"("dishType");

-- CreateIndex
CREATE INDEX "SuggestionPoolRecipe_firstSeenAt_idx" ON "SuggestionPoolRecipe"("firstSeenAt");
