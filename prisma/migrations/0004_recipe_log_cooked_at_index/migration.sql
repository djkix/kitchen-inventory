-- Rappel de notation (EF-28) : la requête de la réalisation la plus récente
-- non notée filtre sur `cookedAt >= cutoff` avant de trier ; sans index, ce
-- filtre dégénère en balayage complet de la table à mesure qu'elle grossit.
CREATE INDEX "RecipeLog_cookedAt_idx" ON "RecipeLog"("cookedAt");
