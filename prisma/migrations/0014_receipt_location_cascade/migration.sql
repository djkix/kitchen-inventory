-- Supprimer un emplacement utilisé par un ticket de caisse levait P2003 (EF-29) :
-- Réglages › Emplacements affichait une erreur interne pour une suppression qui
-- fonctionnait avant la branche. Le ticket suit son emplacement ; le stock déjà
-- versé n'en dépend pas.
ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_locationId_fkey";
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
