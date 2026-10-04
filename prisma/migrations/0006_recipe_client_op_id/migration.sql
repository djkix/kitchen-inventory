-- Idempotence de la conservation d'une suggestion (section 8, tâche 9) : la
-- création de la recette porte désormais un `clientOpId`, comme le reste des
-- écritures du projet (`StockMovement`, `RecipeLog`). Ajout pur, nullable :
-- aucune recette existante n'est affectée.

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "clientOpId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_clientOpId_key" ON "Recipe"("clientOpId");
