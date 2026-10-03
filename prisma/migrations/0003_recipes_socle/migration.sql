-- CreateEnum
CREATE TYPE "Diet" AS ENUM ('VEGETARIAN', 'VEGAN', 'GLUTEN_FREE', 'LACTOSE_FREE', 'PORK_FREE');

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "RecipeRating" (
    "id" TEXT NOT NULL,
    "recipeLogId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeRating_recipeLogId_idx" ON "RecipeRating"("recipeLogId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeRating_recipeLogId_userId_key" ON "RecipeRating"("recipeLogId", "userId");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeRating" ADD CONSTRAINT "RecipeRating_recipeLogId_fkey" FOREIGN KEY ("recipeLogId") REFERENCES "RecipeLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeRating" ADD CONSTRAINT "RecipeRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise des notes existantes vers RecipeRating, attribuées à l'auteur de la
-- réalisation, avant la suppression des colonnes. Sans utilisateur rattaché,
-- la note est perdue : elle n'appartiendrait à personne.
INSERT INTO "RecipeRating" ("id", "recipeLogId", "userId", "stars", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, l."id", l."userId", l."rating", l."cookedAt", l."cookedAt"
FROM "RecipeLog" l
WHERE l."rating" IS NOT NULL AND l."userId" IS NOT NULL;

-- AlterTable : colonne ajoutée nullable, reprise, puis rendue obligatoire.
ALTER TABLE "Cuisine" ADD COLUMN "normalizedName" TEXT;

-- Nom normalisé des cuisines : minuscules et sans accent (A22).
UPDATE "Cuisine" SET "normalizedName" = unaccent_lite("name");

ALTER TABLE "Cuisine" ALTER COLUMN "normalizedName" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Cuisine_normalizedName_key" ON "Cuisine"("normalizedName");

-- SAUCE disparaît du type de plat : les recettes concernées deviennent SIDE.
-- Doit s'exécuter avant le changement de type de l'énumération ci-dessous :
-- la nouvelle énumération n'a plus de valeur SAUCE vers laquelle recaster.
UPDATE "Recipe" SET "dishType" = 'SIDE' WHERE "dishType" = 'SAUCE';

-- AlterEnum
BEGIN;
CREATE TYPE "DishType_new" AS ENUM ('STARTER', 'MAIN', 'DESSERT', 'SIDE', 'APERITIF', 'BREAKFAST', 'DRINK');
ALTER TABLE "Recipe" ALTER COLUMN "dishType" TYPE "DishType_new" USING ("dishType"::text::"DishType_new");
ALTER TYPE "DishType" RENAME TO "DishType_old";
ALTER TYPE "DishType_new" RENAME TO "DishType";
DROP TYPE "public"."DishType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Recipe" DROP COLUMN "rating",
ADD COLUMN     "activeTime" INTEGER,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "restMinutes" INTEGER;

-- Recipe.diets passe de String[] à Diet[] : la colonne est vide en pratique,
-- le cast est néanmoins écrit pour être correct sur une instance qui en a.
-- Une sous-requête n'étant pas acceptée dans la clause USING d'un ALTER
-- COLUMN TYPE, le recast passe par une colonne intermédiaire.
ALTER TABLE "Recipe" ADD COLUMN "diets_new" "Diet"[];
UPDATE "Recipe" SET "diets_new" = ARRAY(SELECT unnest("diets")::"Diet") WHERE "diets" IS NOT NULL;
ALTER TABLE "Recipe" DROP COLUMN "diets";
ALTER TABLE "Recipe" RENAME COLUMN "diets_new" TO "diets";

-- CreateIndex
CREATE INDEX "Recipe_archivedAt_idx" ON "Recipe"("archivedAt");

-- AlterTable
ALTER TABLE "RecipeIngredient" ALTER COLUMN "essential" SET DEFAULT false;

-- CreateIndex
CREATE INDEX "RecipeIngredient_categoryId_idx" ON "RecipeIngredient"("categoryId");

-- AlterTable
ALTER TABLE "RecipeLog" DROP COLUMN "rating",
ADD COLUMN     "clientOpId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RecipeLog_clientOpId_key" ON "RecipeLog"("clientOpId");
