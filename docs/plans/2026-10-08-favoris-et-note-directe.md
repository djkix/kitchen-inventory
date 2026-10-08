# Favoris et note directe — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** pouvoir marquer une recette en favori et la noter sans l'avoir cuisinée.

**Spec:** `docs/specs/2026-10-08-favoris-et-note-directe.md`

## Global Constraints

- TypeScript strict, `any` interdit hors tests. Libellés en français, code en anglais.
- Règles métier dans des fonctions pures testées de `packages/shared`, jamais recopiées.
- Schémas Zod définis une seule fois dans `packages/shared`.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- Cibles tactiles `min-h-touch`. La couleur ne porte jamais seule une information.
- `npm run build -w @kitchen/shared` après toute modification du paquet partagé.
- `README.md` et la ligne de changelog : par la DERNIÈRE tâche seulement.
- Tout changement de libellé ou de comportement visible oblige à regarder `e2e/` : le lot précédent a rendu la CI rouge pour l'avoir oublié.

## Review Focus

1. Une recette sans note directe ET sans réalisation : aucune étoile fantôme, aucun « 0 ». → tâches 2, 3.
2. Une recette notée directement ET cuisinée plusieurs fois : une seule note affichée, la directe. → tâches 1, 3.
3. Retirer une note directe doit faire réapparaître la moyenne des réalisations, pas un vide. → tâches 1, 3.
4. Le tri par note doit classer ensemble des recettes dont la note vient de sources différentes. → tâche 1.
5. Les recettes déjà en base : `favorite` à faux, `rating` nul, aucun écran ne doit s'en trouver cassé. → tâche 2.

---

### Task 1 : la règle de note effective, partagée (D3, A5)

**Files:**
- Create: `packages/shared/src/rules/effective-rating.ts` et son test
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Produces: `effectiveRating(direct: number | null, averageFromLogs: number | null): { value: number | null; source: 'direct' | 'cooked' | null }`

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
it('préfère la note directe quand elle existe', () => {
  expect(effectiveRating(5, 2.5)).toEqual({ value: 5, source: 'direct' });
});

it('se rabat sur la moyenne des réalisations', () => {
  expect(effectiveRating(null, 2.5)).toEqual({ value: 2.5, source: 'cooked' });
});

it('rend null quand rien n’a été noté : pas d’étoiles vides', () => {
  expect(effectiveRating(null, null)).toEqual({ value: null, source: null });
});

it('retirer la note directe fait réapparaître la moyenne', () => {
  expect(effectiveRating(null, 4)).toEqual({ value: 4, source: 'cooked' });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : écrire la règle, l'exporter**
- [ ] **Step 4 : relancer, vérifier le succès**
- [ ] **Step 5 : commit** `feat(recipes): règle de note effective (EF-21)`

---

### Task 2 : migration, schémas et API (A1, A4)

**Files:**
- Modify: `prisma/schema.prisma` (`Recipe.favorite`, `Recipe.rating`)
- Create: `prisma/migrations/0008_recipe_favorite_rating/migration.sql`
- Modify: `packages/shared/src/schemas/recipes.ts` (DTO, entrée de mise à jour, filtre `favorite`)
- Modify: `apps/api/src/recipes/recipes.service.ts`, `recipes.controller.ts`
- Test: `apps/api/src/recipes/recipes.e2e-spec.ts`

**Interfaces:**
- Produces: `RecipeDto.favorite: boolean`, `RecipeDto.rating: number | null`, mêmes champs sur `RecipeSummaryDto` ; filtre `favorite` dans la requête de liste ; une route de mise à jour acceptant `favorite` et `rating` (`rating: null` retire la note).

- [ ] **Step 1 : tests d'API qui échouent** — marquer puis démarquer un favori ; poser, corriger puis retirer une note ; filtrer sur les favoris ; vérifier qu'une recette existante arrive avec `favorite: false` et `rating: null`.
- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : migration Prisma, schémas partagés, service et contrôleur**
- [ ] **Step 4 : relancer ; vérifier aussi que la dérive de schéma est nulle (`npx prisma migrate diff`)**
- [ ] **Step 5 : commit** `feat(recipes): favori et note directe, migration 0008 (EF-21)`

---

### Task 3 : étoiles, favoris et filtre à l'écran (A2, A3, A4, A6)

**Files:**
- Modify: `apps/web/src/screens/recipe/recipe-screen.tsx`, `apps/web/src/screens/recipes/recipe-card.tsx`, `recipe-filters.tsx`
- Create: un composant d'étoiles réutilisable et son test
- Modify: `apps/web/src/lib/queries.ts`, `apps/web/src/lib/recipes-api.ts`
- Test: les tests des composants touchés

- [ ] **Step 1 : tests qui échouent** — l'étoile de favori bascule et annonce son état ; cinq étoiles notent, corrigent et retirent ; une recette sans note n'affiche aucune étoile sur sa carte ; la fiche d'une recette jamais cuisinée explique qu'aucune réalisation n'est enregistrée.
- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : implémenter, en passant par `effectiveRating` pour tout affichage de note**
- [ ] **Step 4 : pastille « Favoris » dans la première rangée, à côté de « Déjà faites »**
- [ ] **Step 5 : relancer, vérifier le succès**
- [ ] **Step 6 : commit** `feat(web): favoris et note directe à l'écran (EF-21)`

---

### Task 4 : tri, parcours bout en bout et documentation

**Files:**
- Modify: `apps/api/src/recipes/recipes.service.ts` (tri `rating`)
- Modify: `e2e/` — tout parcours que les libellés nouveaux touchent
- Modify: `README.md`

- [ ] **Step 1 : test du tri** — deux recettes, l'une notée directement, l'autre par ses réalisations : le classement les mélange correctement.
- [ ] **Step 2 : relire tout `e2e/`** à la recherche de ce que ce lot change. Les parcours ne tournent qu'en CI : ils se relisent, ils ne s'exécutent pas ici.
- [ ] **Step 3 : `README.md`** — favoris, note directe, règle de préséance, et une ligne de changelog (une seule).
- [ ] **Step 4 : types, lint, suite complète, commit**
