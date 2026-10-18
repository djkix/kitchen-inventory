-- Connexion par compte Google (section 10, spec du 2026-10-18). `status` porte
-- trois états et non un booléen : « jamais validé » et « validé puis révoqué »
-- ne s'affichent pas pareil, et un booléen obligerait à deviner lequel on
-- regarde. Les comptes déjà en base passent ACTIVE : la mise à jour ne doit
-- enfermer personne dehors (D8). `passwordHash` devient nullable plutôt que de
-- recevoir une valeur aléatoire — une colonne qui ment sur son contenu est
-- pire qu'une colonne vide (D5). Le verrouillage après échecs disparaît avec
-- les mots de passe : un jeton Google ne se devine pas par essais (D9).

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "User" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING';
UPDATE "User" SET "status" = 'ACTIVE';
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" DROP COLUMN "failedLogins";
ALTER TABLE "User" DROP COLUMN "lockedUntil";

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
