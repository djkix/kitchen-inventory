-- Favori et note directe sur une recette (EF-21, 2026-10-08) : le favori est
-- partagé par le foyer (décision D4), une seule colonne booléenne, pas de
-- table de liaison par personne. La note directe coexiste avec la notation
-- par réalisation (décision D2) ; `rating` reste nullable, une recette jamais
-- notée directement n'a pas d'avis général. `favorite` pose un défaut à
-- `false` : les recettes déjà en base arrivent favori décoché, jamais NULL.

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rating" INTEGER;
