-- Recette à la demande écrite (spécification du 2026-11-24).
--
-- Un genre propre plutôt que la réutilisation de SUGGESTIONS : le rejoueur de
-- SUGGESTIONS (suggestions.controller.ts, onModuleInit) appelle
-- SuggestionsService.list() et rendrait une fournée au rejeu d'une demande
-- différée, là où l'écran attend une recette unique.
ALTER TYPE "AiRequestKind" ADD VALUE 'RECIPE_REQUEST';
