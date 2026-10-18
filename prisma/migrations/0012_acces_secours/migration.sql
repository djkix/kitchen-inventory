-- Porte de secours en ligne de commande (D6, spec du 2026-10-18). Supprimer le
-- mot de passe au profit de Google crée un risque d'enfermement : si la
-- configuration OAuth casse, si le projet Google est suspendu ou si le domaine
-- change, plus personne n'entre, et il n'y a pas de support à appeler sur une
-- application auto-hébergée.
--
-- `recoveryExpiresAt` est la fin de validité du mot de passe à usage unique que
-- `tools/acces-secours.ts` pose dans `passwordHash`, une heure durant. NULL —
-- la valeur de toutes les lignes existantes, et le seul état normal — veut dire
-- qu'aucune porte n'est ouverte : `POST /auth/recovery` n'ouvre alors rien.
-- Pas de valeur par défaut, pas de secret dormant.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "recoveryExpiresAt" TIMESTAMP(3);
