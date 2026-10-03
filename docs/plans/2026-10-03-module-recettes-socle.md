# Module recettes, socle — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le socle du module recettes : saisie par le foyer, taux de couverture calculé sur le stock réel, filtres, écrans Recettes et Fiche recette, cuisson avec décrément ajusté aux portions.

**Architecture:** Les règles de correspondance et de difficulté sont des fonctions pures de `packages/shared`, testées isolément. L'API charge un instantané du stock en deux requêtes, applique les filtres prédicats en SQL, puis appelle ces fonctions pures en mémoire. Le front réutilise la coque, les composants et les conventions du lot 1.

**Tech Stack:** Node 22, TypeScript 5.9 strict, NestJS 12, Prisma 6, PostgreSQL 16, Zod 4, Vitest 4, React 19, Vite 8, Tailwind 4, TanStack Query 5.

**Spec:** `docs/specs/2026-10-03-module-recettes-socle.md`, qui s'appuie sur `docs/cahier-des-charges.md` sections 12, 14 et 15.

## Global Constraints

- `StockItem.quantity` est matérialisée : toute écriture insère un `StockMovement` puis recalcule `quantity = Σ delta` dans la même transaction. Jamais d'écriture directe.
- Chaque écriture de stock accepte `clientOpId` ; un identifiant déjà vu renvoie le résultat précédent.
- Les règles métier vivent dans `packages/shared`, jamais recopiées dans un contrôleur ni dans un composant.
- Anglais pour le code et les identifiants, français pour les libellés d'interface et les messages d'erreur.
- TypeScript strict, `any` interdit hors tests.
- Validation par Zod, schémas définis une seule fois dans `packages/shared` et réutilisés côté front.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- Aucun test ne dépend du réseau.
- Erreurs : `{error: {code, message, details?}}`, codes de la section 16.
- Pagination : `{items, total, page, limit}`, limite par défaut 50, maximum 200.
- Chaque évolution met à jour `README.md` en français dans le même commit, et la section « Derniers changements » reçoit sa ligne.
- Commits en Conventional Commits avec la référence de l'exigence : `feat(recipes): … (EF-17)`.

## Review Focus

Cinq cas que la spécification implique sans qu'un test évident les couvre, le plus probable en premier. Chacun reçoit son test dans la tâche qui détient le code.

1. **Recette sans aucun ingrédient retenu** — toutes les lignes sont « hors inventaire », ou la recette n'a pas d'ingrédient. Le taux est une division par zéro. Attendu : taux de 1 et groupe `ready`, car rien ne manque. Test en tâche 2.
2. **Cuisson de plus de portions que le stock ne permet** — le prorata dépasse la quantité disponible. Attendu : plafonnement ligne par ligne comme à la consommation, avec le signalement dans la réponse, jamais de quantité négative. Test en tâche 8.
3. **Produit d'un ingrédient fusionné depuis la saisie de la recette** — `Product.mergedIntoId` pointe ailleurs. Attendu : l'instantané suit la fusion et le stock du produit cible compte. Test en tâche 7.
4. **Filtre régime sur une recette sans régime déclaré** — `diets` vide. Attendu : la recette est exclue d'un filtre « végétarien », puisqu'on ne peut pas l'affirmer, et conservée sans filtre. Test en tâche 7.
5. **`steps` qui n'est pas un tableau de chaînes** — donnée héritée ou corrompue en base. Attendu : la lecture ne lève pas, la fiche affiche une recette sans étape plutôt qu'un écran blanc. Test en tâche 6.

---

## Structure des fichiers

```
packages/shared/src/rules/difficulty.ts        score de difficulté, techniques
packages/shared/src/rules/coverage.ts          instantané, disponibilité, couverture, tri
packages/shared/src/schemas/recipes.ts         schémas Zod et types d'API
prisma/migrations/0003_user_preference/        table de préférences, index
apps/api/src/recipes/recipes.module.ts         module
apps/api/src/recipes/recipes.controller.ts     routes
apps/api/src/recipes/recipes.service.ts        CRUD
apps/api/src/recipes/recipes.coverage.ts       instantané de stock et assemblage
apps/api/src/recipes/recipes.cook.ts           cuisson et mouvements
apps/api/src/recipes/recipe.mapper.ts          entité Prisma vers DTO
apps/api/src/cuisines/                         liste extensible des cuisines
apps/api/src/preferences/                      préférences par utilisateur
apps/web/src/screens/recipes/                  liste, filtres, carte
apps/web/src/screens/recipe/                   fiche, tiroir de cuisson
apps/web/src/screens/recipe-form/              formulaire de saisie
```

---

### Task 1: Règle pure — difficulté calculée

**Files:**
- Create: `packages/shared/src/rules/difficulty.ts`, `packages/shared/src/rules/difficulty.test.ts`
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Consumes: `normalizeProductName` de `rules/duplicates.ts` pour la normalisation sans accent.
- Produces:
```ts
export type Difficulty = 'VERY_EASY' | 'EASY' | 'INTERMEDIATE' | 'HARD';
export const TECHNIQUE_KEYWORDS: readonly string[];
export function detectTechniques(steps: readonly string[]): string[];
export function difficultyScore(input: { steps: readonly string[]; prepMinutes: number | null }): number;
export function computeDifficulty(input: { steps: readonly string[]; prepMinutes: number | null }): Difficulty;
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { computeDifficulty, detectTechniques, difficultyScore } from './difficulty.js';

describe('detectTechniques', () => {
  it('repère les techniques quelles que soient la casse et les accents', () => {
    expect(detectTechniques(['Émulsionner la sauce', 'Laisser réduire de moitié'])).toEqual(['emulsionner', 'reduire']);
  });
  it('ne compte qu’une fois une technique répétée', () => {
    expect(detectTechniques(['Réduire la sauce', 'Réduire encore'])).toEqual(['reduire']);
  });
  it('ne repère rien dans une recette sans technique', () => {
    expect(detectTechniques(['Mélanger les ingrédients', 'Servir frais'])).toEqual([]);
  });
});

describe('difficultyScore', () => {
  it('additionne étapes, temps actif et techniques', () => {
    // 2 étapes (0) + 5 min (0) + aucune technique (0)
    expect(difficultyScore({ steps: ['Ouvrir', 'Servir'], prepMinutes: 5 })).toBe(0);
    // 5 étapes (1) + 30 min (2) + 1 technique (1)
    expect(difficultyScore({ steps: ['a', 'b', 'c', 'd', 'Faire revenir et déglacer'], prepMinutes: 30 })).toBe(4);
  });
  it('traite un temps de préparation absent comme nul', () => {
    expect(difficultyScore({ steps: ['a'], prepMinutes: null })).toBe(0);
  });
});

describe('computeDifficulty', () => {
  it('place chaque score dans son palier', () => {
    expect(computeDifficulty({ steps: ['Ouvrir la boîte'], prepMinutes: 2 })).toBe('VERY_EASY');
    expect(computeDifficulty({ steps: ['a', 'b', 'c', 'd'], prepMinutes: 20 })).toBe('EASY');
    expect(computeDifficulty({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], prepMinutes: 30 })).toBe('INTERMEDIATE');
    expect(
      computeDifficulty({
        steps: ['Pétrir la pâte', 'Laisser lever', 'Émulsionner', 'Caraméliser', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
        prepMinutes: 90,
      }),
    ).toBe('HARD');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/rules/difficulty --root packages/shared`
Expected: FAIL, `difficultyScore is not a function`.

- [ ] **Step 3: Implémenter**

```ts
import { normalizeProductName } from './duplicates.js';

export type Difficulty = 'VERY_EASY' | 'EASY' | 'INTERMEDIATE' | 'HARD';

/**
 * Techniques dont la présence dans les étapes fait monter la difficulté
 * (décision 9). Chaque entrée est un radical normalisé, cherché tel quel dans
 * le texte normalisé : « reduire » attrape aussi « réduisez » et « réduction ».
 */
export const TECHNIQUE_KEYWORDS = [
  'emulsion', 'monter en neige', 'caramelis', 'flamb', 'poch', 'reduire', 'reduction',
  'clarifi', 'petrir', 'laisser lever', 'saisir', 'deglac', 'temper', 'blanchir', 'confire',
] as const;

export function detectTechniques(steps: readonly string[]): string[] {
  const haystack = normalizeProductName(steps.join(' '));
  const found = TECHNIQUE_KEYWORDS.filter((keyword) => haystack.includes(keyword));
  // « reduire » et « reduction » décrivent la même technique : on ne la compte qu'une fois.
  const canonical = new Set(found.map((keyword) => (keyword === 'reduction' ? 'reduire' : keyword)));
  return [...canonical];
}

function bucket(value: number, thresholds: readonly [number, number, number]): number {
  if (value <= thresholds[0]) return 0;
  if (value <= thresholds[1]) return 1;
  if (value <= thresholds[2]) return 2;
  return 3;
}

export function difficultyScore(input: { steps: readonly string[]; prepMinutes: number | null }): number {
  const steps = bucket(input.steps.length, [3, 6, 10]);
  const time = bucket(input.prepMinutes ?? 0, [10, 25, 45]);
  const techniques = Math.min(3, detectTechniques(input.steps).length);
  return steps + time + techniques;
}

export function computeDifficulty(input: { steps: readonly string[]; prepMinutes: number | null }): Difficulty {
  const score = difficultyScore(input);
  if (score <= 1) return 'VERY_EASY';
  if (score <= 3) return 'EASY';
  if (score <= 6) return 'INTERMEDIATE';
  return 'HARD';
}
```

Ajouter `export * from './difficulty.js';` à `rules/index.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/rules/difficulty --root packages/shared`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rules/difficulty.ts packages/shared/src/rules/difficulty.test.ts packages/shared/src/rules/index.ts
git commit -m "feat(shared): difficulté calculée d'après étapes, temps et techniques (EF-21)"
```

---

### Task 2: Règle pure — disponibilité, couverture et tri

**Files:**
- Create: `packages/shared/src/rules/coverage.ts`, `packages/shared/src/rules/coverage.test.ts`
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Consumes: `convertQuantity`, `sameFamily`, `UNIT_FAMILY`, `roundQuantity`, `Unit` de `units.ts`.
- Produces:
```ts
export type IngredientState = 'available' | 'missing' | 'untracked' | 'unverifiable';
export type CoverageGroup = 'ready' | 'almost' | 'excluded';

export interface StockEntry {
  productId: string;
  categoryId: string | null;
  unit: Unit;                 // unité de référence du produit
  quantity: number;           // somme des lots retenus, dans `unit`
  netContent: number | null;
  netContentUnit: Unit | null;
  nearExpiry: boolean;        // au moins un lot proche de sa date
}

export interface StockSnapshot {
  byProduct: ReadonlyMap<string, StockEntry>;
  byCategory: ReadonlyMap<string, readonly StockEntry[]>;
}

export interface CoverageIngredient {
  id: string;
  productId: string | null;
  categoryId: string | null;
  quantity: number | null;
  unit: Unit | null;
  essential: boolean;
  substitutable: boolean;
}

export interface IngredientOutcome { id: string; state: IngredientState; nearExpiry: boolean }

export interface RecipeCoverage {
  coverage: number;                      // 0 à 1, arrondi au centième
  group: CoverageGroup;
  bonus: number;
  missingIds: string[];
  outcomes: IngredientOutcome[];
}

export function buildStockSnapshot(entries: readonly StockEntry[]): StockSnapshot;
export function availableInUnit(entry: StockEntry, unit: Unit): number | null;
export function ingredientOutcome(ingredient: CoverageIngredient, snapshot: StockSnapshot): IngredientOutcome;
export function recipeCoverage(ingredients: readonly CoverageIngredient[], snapshot: StockSnapshot): RecipeCoverage;
export function compareByCoverage(a: RecipeCoverage & { title: string }, b: RecipeCoverage & { title: string }): number;
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { availableInUnit, buildStockSnapshot, compareByCoverage, ingredientOutcome, recipeCoverage, type CoverageIngredient, type StockEntry } from './coverage.js';

const entry = (over: Partial<StockEntry> = {}): StockEntry => ({
  productId: 'p1', categoryId: 'c1', unit: 'GRAM', quantity: 500,
  netContent: null, netContentUnit: null, nearExpiry: false, ...over,
});
const ing = (over: Partial<CoverageIngredient> = {}): CoverageIngredient => ({
  id: 'i1', productId: 'p1', categoryId: null, quantity: 200, unit: 'GRAM',
  essential: true, substitutable: false, ...over,
});

describe('availableInUnit', () => {
  it('convertit dans la même famille', () => {
    expect(availableInUnit(entry({ unit: 'KILOGRAM', quantity: 1 }), 'GRAM')).toBe(1000);
  });
  it('fait le pont par la contenance entre paquets et grammes', () => {
    expect(availableInUnit(entry({ unit: 'PACK', quantity: 3, netContent: 500, netContentUnit: 'GRAM' }), 'GRAM')).toBe(1500);
  });
  it('renvoie null quand aucun pont n’existe', () => {
    expect(availableInUnit(entry({ unit: 'PACK', quantity: 3 }), 'GRAM')).toBeNull();
    expect(availableInUnit(entry({ unit: 'GRAM', quantity: 500 }), 'LITER')).toBeNull();
  });
});

describe('ingredientOutcome', () => {
  const snapshot = buildStockSnapshot([entry()]);
  it('marque hors inventaire un ingrédient sans rattachement', () => {
    expect(ingredientOutcome(ing({ productId: null, categoryId: null }), snapshot).state).toBe('untracked');
  });
  it('sans quantité, suffit que le produit soit en stock', () => {
    expect(ingredientOutcome(ing({ quantity: null, unit: null }), snapshot).state).toBe('available');
    expect(ingredientOutcome(ing({ productId: 'absent', quantity: null, unit: null }), snapshot).state).toBe('missing');
  });
  it('compare les quantités après conversion', () => {
    expect(ingredientOutcome(ing({ quantity: 200 }), snapshot).state).toBe('available');
    expect(ingredientOutcome(ing({ quantity: 900 }), snapshot).state).toBe('missing');
  });
  it('signale une quantité non vérifiable plutôt que de trancher', () => {
    const packs = buildStockSnapshot([entry({ unit: 'PACK', quantity: 2 })]);
    expect(ingredientOutcome(ing({ quantity: 200, unit: 'GRAM' }), packs).state).toBe('unverifiable');
  });
  it('satisfait un ingrédient de catégorie par la somme des produits convertibles', () => {
    const snap = buildStockSnapshot([
      entry({ productId: 'a', quantity: 150 }),
      entry({ productId: 'b', quantity: 100 }),
      entry({ productId: 'c', unit: 'PACK', quantity: 9 }),
    ]);
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 200 }), snap).state).toBe('available');
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 400 }), snap).state).toBe('missing');
  });
  it('un ingrédient substituable accepte un autre produit de la catégorie', () => {
    const snap = buildStockSnapshot([entry({ productId: 'autre', quantity: 300 })]);
    expect(ingredientOutcome(ing({ substitutable: true, quantity: 200 }), snap).state).toBe('available');
    expect(ingredientOutcome(ing({ substitutable: false, quantity: 200 }), snap).state).toBe('missing');
  });
  it('reporte la proximité de date du lot qui satisfait l’ingrédient', () => {
    const snap = buildStockSnapshot([entry({ nearExpiry: true })]);
    expect(ingredientOutcome(ing(), snap).nearExpiry).toBe(true);
  });
});

describe('recipeCoverage', () => {
  const snapshot = buildStockSnapshot([entry()]);
  it('classe réalisable une recette entièrement couverte', () => {
    const result = recipeCoverage([ing()], snapshot);
    expect(result).toMatchObject({ coverage: 1, group: 'ready', missingIds: [] });
  });
  it('classe presque réalisable un ou deux manquants non essentiels', () => {
    const result = recipeCoverage([ing(), ing({ id: 'i2', productId: 'absent', essential: false })], snapshot);
    expect(result.group).toBe('almost');
    expect(result.missingIds).toEqual(['i2']);
    expect(result.coverage).toBe(0.5);
  });
  it('écarte une recette dont un ingrédient essentiel manque', () => {
    expect(recipeCoverage([ing(), ing({ id: 'i2', productId: 'absent' })], snapshot).group).toBe('excluded');
  });
  it('écarte une recette au-delà de deux manquants non essentiels', () => {
    const missing = [1, 2, 3].map((n) => ing({ id: `m${n}`, productId: `absent${n}`, essential: false }));
    expect(recipeCoverage([ing(), ...missing], snapshot).group).toBe('excluded');
  });
  it('ignore les ingrédients hors inventaire dans le taux', () => {
    const result = recipeCoverage([ing(), ing({ id: 'sel', productId: null, categoryId: null })], snapshot);
    expect(result.coverage).toBe(1);
    expect(result.group).toBe('ready');
  });
  it('tient pour réalisable une recette sans ingrédient retenu', () => {
    // Cas limite : rien ne manque, donc rien n'empêche de cuisiner.
    expect(recipeCoverage([], snapshot)).toMatchObject({ coverage: 1, group: 'ready', bonus: 0 });
    expect(recipeCoverage([ing({ productId: null, categoryId: null })], snapshot).coverage).toBe(1);
  });
  it('compte un bonus par ingrédient satisfait depuis un lot proche de sa date', () => {
    const snap = buildStockSnapshot([entry({ nearExpiry: true })]);
    expect(recipeCoverage([ing()], snap).bonus).toBe(1);
  });
});

describe('compareByCoverage', () => {
  const base = { coverage: 1, group: 'ready' as const, bonus: 0, missingIds: [], outcomes: [], title: 'A' };
  it('ordonne par groupe, puis bonus, puis couverture, puis titre', () => {
    expect(compareByCoverage(base, { ...base, group: 'almost' })).toBeLessThan(0);
    expect(compareByCoverage(base, { ...base, bonus: 2 })).toBeGreaterThan(0);
    expect(compareByCoverage({ ...base, coverage: 0.9, group: 'almost' }, { ...base, coverage: 0.5, group: 'almost' })).toBeLessThan(0);
    expect(compareByCoverage(base, { ...base, title: 'B' })).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/rules/coverage --root packages/shared`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

```ts
import { convertQuantity, roundQuantity, sameFamily, UNIT_FAMILY, type Unit } from '../units.js';

export type IngredientState = 'available' | 'missing' | 'untracked' | 'unverifiable';
export type CoverageGroup = 'ready' | 'almost' | 'excluded';

export interface StockEntry {
  productId: string;
  categoryId: string | null;
  unit: Unit;
  quantity: number;
  netContent: number | null;
  netContentUnit: Unit | null;
  nearExpiry: boolean;
}

export interface StockSnapshot {
  byProduct: ReadonlyMap<string, StockEntry>;
  byCategory: ReadonlyMap<string, readonly StockEntry[]>;
}

export interface CoverageIngredient {
  id: string;
  productId: string | null;
  categoryId: string | null;
  quantity: number | null;
  unit: Unit | null;
  essential: boolean;
  substitutable: boolean;
}

export interface IngredientOutcome {
  id: string;
  state: IngredientState;
  nearExpiry: boolean;
}

export interface RecipeCoverage {
  coverage: number;
  group: CoverageGroup;
  bonus: number;
  missingIds: string[];
  outcomes: IngredientOutcome[];
}

export function buildStockSnapshot(entries: readonly StockEntry[]): StockSnapshot {
  const byProduct = new Map<string, StockEntry>();
  const byCategory = new Map<string, StockEntry[]>();
  for (const entry of entries) {
    byProduct.set(entry.productId, entry);
    if (entry.categoryId) {
      const bucket = byCategory.get(entry.categoryId) ?? [];
      bucket.push(entry);
      byCategory.set(entry.categoryId, bucket);
    }
  }
  return { byProduct, byCategory };
}

/** Mesure le stock d'un produit dans l'unité demandée, ou null si rien ne permet de comparer. */
export function availableInUnit(entry: StockEntry, unit: Unit): number | null {
  if (sameFamily(entry.unit, unit)) return convertQuantity(entry.quantity, entry.unit, unit);
  // Pont par la contenance : seules les unités de conditionnement en bénéficient,
  // un stock en grammes ne devient jamais un volume.
  const packaging = UNIT_FAMILY[entry.unit];
  const bridgeable = packaging !== 'mass' && packaging !== 'volume';
  if (bridgeable && entry.netContent !== null && entry.netContentUnit !== null && sameFamily(entry.netContentUnit, unit)) {
    return convertQuantity(entry.quantity * entry.netContent, entry.netContentUnit, unit);
  }
  return null;
}

function targets(ingredient: CoverageIngredient, snapshot: StockSnapshot): readonly StockEntry[] {
  if (ingredient.productId && !ingredient.substitutable) {
    const direct = snapshot.byProduct.get(ingredient.productId);
    return direct ? [direct] : [];
  }
  // Catégorie visée, ou produit substituable : toute la catégorie convient.
  const categoryId = ingredient.categoryId ?? snapshot.byProduct.get(ingredient.productId ?? '')?.categoryId ?? null;
  if (categoryId) return snapshot.byCategory.get(categoryId) ?? [];
  const direct = ingredient.productId ? snapshot.byProduct.get(ingredient.productId) : undefined;
  return direct ? [direct] : [];
}

export function ingredientOutcome(ingredient: CoverageIngredient, snapshot: StockSnapshot): IngredientOutcome {
  if (!ingredient.productId && !ingredient.categoryId) return { id: ingredient.id, state: 'untracked', nearExpiry: false };

  const candidates = targets(ingredient, snapshot);
  if (candidates.length === 0) return { id: ingredient.id, state: 'missing', nearExpiry: false };
  const nearExpiry = candidates.some((entry) => entry.nearExpiry);

  if (ingredient.quantity === null || ingredient.unit === null) {
    return { id: ingredient.id, state: 'available', nearExpiry };
  }

  let total = 0;
  let comparable = false;
  for (const entry of candidates) {
    const measured = availableInUnit(entry, ingredient.unit);
    if (measured === null) continue;
    comparable = true;
    total += measured;
  }
  if (!comparable) return { id: ingredient.id, state: 'unverifiable', nearExpiry };
  return { id: ingredient.id, state: roundQuantity(total) >= ingredient.quantity ? 'available' : 'missing', nearExpiry };
}

const SATISFIED: readonly IngredientState[] = ['available', 'unverifiable'];

export function recipeCoverage(ingredients: readonly CoverageIngredient[], snapshot: StockSnapshot): RecipeCoverage {
  const outcomes = ingredients.map((ingredient) => ingredientOutcome(ingredient, snapshot));
  const tracked = ingredients.filter((_, index) => outcomes[index]!.state !== 'untracked');
  const trackedOutcomes = outcomes.filter((outcome) => outcome.state !== 'untracked');

  const missing = trackedOutcomes.filter((outcome) => !SATISFIED.includes(outcome.state));
  const missingIds = missing.map((outcome) => outcome.id);
  const essentialMissing = tracked.some((ingredient, index) => ingredient.essential && !SATISFIED.includes(trackedOutcomes[index]!.state));

  // Une recette dont rien n'est suivi ne manque de rien : le taux vaut 1.
  const coverage = trackedOutcomes.length === 0 ? 1 : roundQuantity((trackedOutcomes.length - missing.length) / trackedOutcomes.length);
  const group: CoverageGroup =
    missing.length === 0 ? 'ready' : essentialMissing || missing.length > 2 ? 'excluded' : 'almost';
  const bonus = trackedOutcomes.filter((outcome) => outcome.nearExpiry && SATISFIED.includes(outcome.state)).length;

  return { coverage, group, bonus, missingIds, outcomes };
}

const GROUP_ORDER: Record<CoverageGroup, number> = { ready: 0, almost: 1, excluded: 2 };

export function compareByCoverage(a: RecipeCoverage & { title: string }, b: RecipeCoverage & { title: string }): number {
  return (
    GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
    b.bonus - a.bonus ||
    b.coverage - a.coverage ||
    a.title.localeCompare(b.title, 'fr')
  );
}
```

Ajouter `export * from './coverage.js';` à `rules/index.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/rules/coverage --root packages/shared && npx vitest run --coverage --root packages/shared`
Expected: PASS, et couverture des règles toujours au-dessus de 80 %.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rules/coverage.ts packages/shared/src/rules/coverage.test.ts packages/shared/src/rules/index.ts
git commit -m "feat(shared): couverture des recettes par le stock réel (EF-17, EF-23, EF-27)"
```

---

### Task 3: Schémas Zod et types d'API

**Files:**
- Create: `packages/shared/src/schemas/recipes.ts`, `packages/shared/src/schemas/recipes.test.ts`
- Modify: `packages/shared/src/schemas/index.ts`

**Interfaces:**
- Consumes: `unitSchema`, `idSchema`, `paginationQuerySchema`, `clientOpIdSchema` de `schemas/common.ts`.
- Produces: `difficultySchema`, `dishTypeSchema`, `dietSchema`, `DIETS`, `recipeIngredientInputSchema`, `createRecipeSchema`, `updateRecipeSchema`, `recipeListQuerySchema`, `cookRecipeSchema`, `createCuisineSchema`, `recipeFiltersSchema`, et les types `RecipeDto`, `RecipeSummaryDto`, `RecipeIngredientDto`, `CookResult`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { cookRecipeSchema, createRecipeSchema, recipeListQuerySchema } from './recipes.js';

const valid = { title: 'Ramen', servings: 2, steps: ['Bouillir', 'Servir'], ingredients: [{ label: 'Nouilles', productId: 'p1', quantity: 200, unit: 'GRAM' }] };

describe('createRecipeSchema', () => {
  it('accepte une recette minimale et applique les défauts', () => {
    const parsed = createRecipeSchema.parse(valid);
    expect(parsed.ingredients[0]).toMatchObject({ essential: true, substitutable: false });
    expect(parsed.diets).toEqual([]);
  });
  it('exige au moins une étape et un titre', () => {
    expect(createRecipeSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false);
  });
  it('refuse une quantité d’ingrédient nulle ou négative', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', quantity: 0, unit: 'GRAM' }] }).success).toBe(false);
  });
  it('refuse une quantité sans unité, et l’inverse', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', quantity: 200 }] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', unit: 'GRAM' }] }).success).toBe(false);
  });
  it('refuse un ingrédient visant à la fois un produit et une catégorie', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', productId: 'p', categoryId: 'c' }] }).success).toBe(false);
  });
});

describe('recipeListQuerySchema', () => {
  it('accepte les filtres en répétition et convertit les nombres', () => {
    const parsed = recipeListQuerySchema.parse({ difficulty: ['EASY', 'HARD'], maxTime: '30', page: '2' });
    expect(parsed).toMatchObject({ difficulty: ['EASY', 'HARD'], maxTime: 30, page: 2, includeExcluded: false });
  });
  it('accepte un filtre unique transmis sans tableau', () => {
    expect(recipeListQuerySchema.parse({ cuisine: 'c1' }).cuisine).toEqual(['c1']);
  });
});

describe('cookRecipeSchema', () => {
  it('exige un nombre de portions positif', () => {
    expect(cookRecipeSchema.safeParse({ servingsCooked: 0, lines: [] }).success).toBe(false);
    expect(cookRecipeSchema.parse({ servingsCooked: 4, lines: [{ ingredientId: 'i1' }] }).lines[0]).toMatchObject({ ingredientId: 'i1' });
  });
  it('borne la note entre 1 et 5', () => {
    expect(cookRecipeSchema.safeParse({ servingsCooked: 2, lines: [], rating: 6 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/schemas/recipes --root packages/shared`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

```ts
import { z } from 'zod';
import { clientOpIdSchema, idSchema, paginationQuerySchema, positiveQuantitySchema, unitSchema } from './common.js';

export const difficultySchema = z.enum(['VERY_EASY', 'EASY', 'INTERMEDIATE', 'HARD']);
export const dishTypeSchema = z.enum(['STARTER', 'MAIN', 'SIDE', 'DESSERT', 'SAUCE', 'DRINK']);

/** Régimes de la section 12 ; filtre d'exclusion, jamais d'inclusion. */
export const DIETS = ['vegetarian', 'vegan', 'no-pork', 'gluten-free', 'lactose-free'] as const;
export const dietSchema = z.enum(DIETS);

export const DIFFICULTY_LABELS_FR: Record<z.infer<typeof difficultySchema>, string> = {
  VERY_EASY: 'Très facile', EASY: 'Facile', INTERMEDIATE: 'Intermédiaire', HARD: 'Difficile',
};
export const DISH_TYPE_LABELS_FR: Record<z.infer<typeof dishTypeSchema>, string> = {
  STARTER: 'Entrée', MAIN: 'Plat', SIDE: 'Accompagnement', DESSERT: 'Dessert', SAUCE: 'Sauce', DRINK: 'Boisson',
};
export const DIET_LABELS_FR: Record<(typeof DIETS)[number], string> = {
  vegetarian: 'Végétarien', vegan: 'Végétalien', 'no-pork': 'Sans porc', 'gluten-free': 'Sans gluten', 'lactose-free': 'Sans lactose',
};

export const recipeIngredientInputSchema = z
  .object({
    label: z.string().trim().min(1, { message: 'Libellé requis' }).max(160),
    productId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    quantity: positiveQuantitySchema.nullable().optional(),
    unit: unitSchema.nullable().optional(),
    essential: z.boolean().default(true),
    substitutable: z.boolean().default(false),
  })
  .refine((i) => !(i.productId && i.categoryId), { message: 'Un ingrédient vise un produit ou une catégorie, pas les deux' })
  .refine((i) => (i.quantity ?? null) === null || (i.unit ?? null) !== null, { message: 'Une quantité exige une unité' })
  .refine((i) => (i.unit ?? null) === null || (i.quantity ?? null) !== null, { message: 'Une unité exige une quantité' });

export const createRecipeSchema = z.object({
  title: z.string().trim().min(1, { message: 'Titre requis' }).max(160),
  cuisineId: idSchema.nullable().optional(),
  dishType: dishTypeSchema.nullable().optional(),
  prepMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  cookMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  servings: z.number().int().min(1).max(50).default(4),
  steps: z.array(z.string().trim().min(1)).min(1, { message: 'Au moins une étape' }).max(60),
  diets: z.array(dietSchema).default([]),
  /** Renseignée seulement pour corriger le calcul ; pose alors difficultyOverride. */
  difficulty: difficultySchema.optional(),
  ingredients: z.array(recipeIngredientInputSchema).max(60).default([]),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial();
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

/** Un filtre peut arriver une fois (`?cuisine=a`) ou plusieurs (`?cuisine=a&cuisine=b`). */
const repeatable = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]), z.array(inner));

export const recipeListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  difficulty: repeatable(difficultySchema).optional(),
  cuisine: repeatable(idSchema).optional(),
  dishType: repeatable(dishTypeSchema).optional(),
  diet: repeatable(dietSchema).optional(),
  maxTime: z.coerce.number().int().min(1).max(1440).optional(),
  coverageMin: z.coerce.number().min(0).max(1).optional(),
  includeExcluded: z.coerce.boolean().default(false),
});
export type RecipeListQuery = z.infer<typeof recipeListQuerySchema>;

export const recipeFiltersSchema = recipeListQuerySchema.pick({
  difficulty: true, cuisine: true, dishType: true, diet: true, maxTime: true, includeExcluded: true,
});
export type RecipeFilters = z.infer<typeof recipeFiltersSchema>;

export const cookRecipeSchema = z.object({
  servingsCooked: z.number().int().min(1).max(50),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  /** Seules les lignes présentes sont décrémentées : décocher, c'est omettre. */
  lines: z.array(z.object({ ingredientId: idSchema })).max(60),
  clientOpId: clientOpIdSchema.optional(),
});
export type CookRecipeInput = z.infer<typeof cookRecipeSchema>;

export const createCuisineSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(60),
  region: z.string().trim().max(60).nullable().optional(),
});
export type CreateCuisineInput = z.infer<typeof createCuisineSchema>;

export interface RecipeIngredientDto {
  id: string;
  label: string;
  productId: string | null;
  productName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  quantity: number | null;
  unit: z.infer<typeof unitSchema> | null;
  essential: boolean;
  substitutable: boolean;
  state: 'available' | 'missing' | 'untracked' | 'unverifiable';
  nearExpiry: boolean;
}

export interface RecipeSummaryDto {
  id: string;
  title: string;
  difficulty: z.infer<typeof difficultySchema>;
  cuisineName: string | null;
  dishType: z.infer<typeof dishTypeSchema> | null;
  totalMinutes: number | null;
  servings: number;
  diets: string[];
  imagePath: string | null;
  rating: number | null;
  coverage: number;
  group: 'ready' | 'almost' | 'excluded';
  bonus: number;
  missingLabels: string[];
}

export interface RecipeDto extends RecipeSummaryDto {
  cuisineId: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  steps: string[];
  difficultyOverride: boolean;
  source: 'HOUSEHOLD' | 'IMPORTED' | 'GENERATED';
  sourceUrl: string | null;
  createdAt: string;
  cookedCount: number;
  ingredients: RecipeIngredientDto[];
}

export interface CookResultLine {
  ingredientId: string;
  label: string;
  requested: number | null;
  applied: number;
  unit: z.infer<typeof unitSchema> | null;
  capped: boolean;
}

export interface CookResult {
  logId: string;
  lines: CookResultLine[];
  message: string | null;
}
```

Ajouter `export * from './recipes.js';` à `schemas/index.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/schemas/recipes --root packages/shared && npm run typecheck -w @kitchen/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/recipes.ts packages/shared/src/schemas/recipes.test.ts packages/shared/src/schemas/index.ts
git commit -m "feat(shared): schémas Zod du module recettes (EF-17, EF-21, EF-22)"
```

---

### Task 4: Migration — préférences par utilisateur et index

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0003_user_preference/migration.sql`
- Test: `apps/api/test/db.test.ts` (ajout)

**Interfaces:**
- Produces: modèle Prisma `UserPreference`, relation `User.preferences`, index `RecipeIngredient.categoryId`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `apps/api/test/db.test.ts` :

```ts
it('a la table des préférences par utilisateur et son unicité', async () => {
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'UserPreference'`;
  expect(columns.map((c) => c.column_name).sort()).toEqual(['key', 'updatedAt', 'userId', 'value']);
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'RecipeIngredient'`;
  expect(indexes.map((i) => i.indexname)).toContain('RecipeIngredient_categoryId_idx');
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run test/db --root apps/api`
Expected: FAIL, tableau vide.

- [ ] **Step 3: Modifier le schéma et générer la migration**

Dans `prisma/schema.prisma`, ajouter le modèle et la relation, puis l'index :

```prisma
// Réglages propres à un utilisateur, là où « Setting » vaut pour l'instance.
// La section 12 exige que les filtres de recettes soient mémorisés par
// utilisateur, chacun ayant ses habitudes.
model UserPreference {
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  key       String
  value     Json
  updatedAt DateTime @updatedAt

  @@id([userId, key])
}
```

Ajouter `preferences UserPreference[]` au modèle `User`, et `@@index([categoryId])` au modèle `RecipeIngredient`.

```bash
mkdir -p prisma/migrations/0003_user_preference
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$DATABASE_URL_SHADOW" --script > prisma/migrations/0003_user_preference/migration.sql
```

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run test/db --root apps/api`
Expected: PASS. Vérifier aussi l'absence de dérive : `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL_SHADOW" --exit-code` sort en 0.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0003_user_preference apps/api/test/db.test.ts
git commit -m "feat(prisma): préférences par utilisateur et index des ingrédients (EF-22)"
```

---

### Task 5: API — cuisines et préférences

**Files:**
- Create: `apps/api/src/cuisines/cuisines.controller.ts`, `cuisines.module.ts`
- Create: `apps/api/src/preferences/preferences.controller.ts`, `preferences.service.ts`, `preferences.module.ts`
- Create: `apps/api/src/cuisines/cuisines.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `CurrentUser`, `ZodBody`, `createCuisineSchema`, `recipeFiltersSchema`.
- Produces: `GET /cuisines`, `POST /cuisines`, `GET /preferences/recipe-filters`, `PUT /preferences/recipe-filters` ; `PreferencesService.get(userId, key)` et `.set(userId, key, value)`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('cuisines et préférences (EF-22)', () => {
  let t: TestApp;
  let agent: TestAgent;
  beforeAll(async () => { t = await createTestApp(); });
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });
  afterAll(() => t.close());

  it('expose les douze cuisines de la section 22, triées', async () => {
    const res = await agent.get('/api/v1/cuisines').expect(200);
    expect(res.body).toHaveLength(12);
    expect(res.body[0].name).toBe('Autre');
  });

  it('accepte une cuisine supplémentaire et refuse le doublon', async () => {
    await agent.post('/api/v1/cuisines').send({ name: 'Péruvienne' }).expect(201);
    const dup = await agent.post('/api/v1/cuisines').send({ name: 'Péruvienne' }).expect(409);
    expect(dup.body.error.code).toBe('conflict');
  });

  it('mémorise les filtres par utilisateur, chacun les siens', async () => {
    expect((await agent.get('/api/v1/preferences/recipe-filters').expect(200)).body).toEqual({});
    await agent.put('/api/v1/preferences/recipe-filters').send({ difficulty: ['EASY'], maxTime: 30 }).expect(200);
    expect((await agent.get('/api/v1/preferences/recipe-filters').expect(200)).body).toMatchObject({ difficulty: ['EASY'], maxTime: 30 });

    await agent.post('/api/v1/users').send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201);
    const marie = t.agent();
    await marie.post('/api/v1/auth/login').send({ email: 'marie@example.org', password: 'encore-un-mot-de-passe' }).expect(204);
    expect((await marie.get('/api/v1/preferences/recipe-filters').expect(200)).body).toEqual({});
  });

  it('refuse un filtre inconnu', async () => {
    const res = await agent.put('/api/v1/preferences/recipe-filters').send({ difficulty: ['IMPOSSIBLE'] }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/cuisines --root apps/api`
Expected: FAIL, 404 sur `/api/v1/cuisines`.

- [ ] **Step 3: Implémenter**

`preferences.service.ts` :

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, key: string): Promise<unknown> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } });
    return row?.value ?? {};
  }

  async set(userId: string, key: string, value: Prisma.InputJsonValue): Promise<unknown> {
    const row = await this.prisma.userPreference.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
    });
    return row.value;
  }
}
```

`preferences.controller.ts` expose `GET` et `PUT /preferences/recipe-filters`, valide avec `recipeFiltersSchema` et refuse pour un jeton de service, la garde s'en chargeant déjà puisque `PUT` n'est pas `GET`.

`cuisines.controller.ts` : `GET` trie par nom avec `orderBy: { name: 'asc' }` ; `POST` renvoie `ApiError.conflict('Cette cuisine existe déjà')` quand le nom est pris.

Déclarer les deux modules dans `app.module.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/cuisines --root apps/api`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cuisines apps/api/src/preferences apps/api/src/app.module.ts
git commit -m "feat(recipes): cuisines extensibles et filtres mémorisés par utilisateur (EF-22)"
```

---

### Fonctions d'aide des tests d'intégration

Les tâches 6 à 8 partagent ces aides, à écrire une fois dans
`apps/api/src/recipes/recipes.e2e-spec.ts`, au-dessus des cas de test.

```ts
const isoIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Crée un produit et renvoie son identifiant. */
const createProduct = async (name: string, defaultUnit = 'GRAM'): Promise<string> =>
  (await agent.post('/api/v1/products').send({ name, defaultUnit }).expect(201)).body.id;

/** Pose un lot dans le placard et renvoie son identifiant. */
const createStock = async (productId: string, quantity: number, unit: string, extra: Record<string, unknown> = {}): Promise<string> =>
  (await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity, unit, ...extra }).expect(201)).body.item.id;

/** Crée une recette et renvoie le corps complet, ingrédients compris. */
const createRecipe = async (title: string, ingredients: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  (
    await agent
      .post('/api/v1/recipes')
      .send({ title, steps: ['Préparer'], servings: 4, ingredients: ingredients.map((i, n) => ({ label: `ingrédient ${n}`, ...i })), ...extra })
      .expect(201)
  ).body;
```

### Task 6: API — création, lecture et modification d'une recette

**Files:**
- Create: `apps/api/src/recipes/recipes.service.ts`, `recipe.mapper.ts`, `recipes.controller.ts`, `recipes.module.ts`, `recipes.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `computeDifficulty` (tâche 1), `createRecipeSchema`, `updateRecipeSchema` (tâche 3), `PrismaService`, `ApiError`.
- Produces:
```ts
export class RecipesService {
  create(input: CreateRecipeInput, userId: string | null): Promise<RecipeDto>;
  get(id: string): Promise<RecipeDto>;                       // couverture calculée par la tâche 7
  update(id: string, input: UpdateRecipeInput): Promise<RecipeDto>;
  remove(id: string): Promise<void>;
  requireRecipe(id: string): Promise<RecipeWithRelations>;
}
export function parseSteps(value: unknown): string[];        // recipe.mapper.ts
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('crée une recette, calcule sa difficulté et la renvoie complète', async () => {
  const res = await agent.post('/api/v1/recipes').send({
    title: 'Ramen maison', servings: 2, prepMinutes: 30, cookMinutes: 15,
    steps: ['Faire revenir le porc', 'Déglacer', 'Pocher les œufs', 'Monter le bol', 'Servir'],
    ingredients: [{ label: 'Nouilles', productId: nouillesId, quantity: 200, unit: 'GRAM' }],
  }).expect(201);
  expect(res.body).toMatchObject({ title: 'Ramen maison', difficulty: 'INTERMEDIATE', difficultyOverride: false, source: 'HOUSEHOLD', cookedCount: 0 });
  expect(res.body.totalMinutes).toBe(45);
  expect(res.body.ingredients[0]).toMatchObject({ label: 'Nouilles', productName: 'Nouilles udon' });
});

it('respecte une difficulté corrigée à la main et ne la recalcule plus', async () => {
  const created = await agent.post('/api/v1/recipes').send({ title: 'Salade', steps: ['Mélanger'], difficulty: 'HARD' }).expect(201);
  expect(created.body).toMatchObject({ difficulty: 'HARD', difficultyOverride: true });
  const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).expect(200);
  expect(updated.body.difficulty).toBe('HARD');
});

it('recalcule la difficulté tant qu’elle n’a pas été corrigée', async () => {
  const created = await agent.post('/api/v1/recipes').send({ title: 'Salade', steps: ['Mélanger'] }).expect(201);
  expect(created.body.difficulty).toBe('VERY_EASY');
  const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ prepMinutes: 60, steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).expect(200);
  expect(updated.body.difficulty).toBe('HARD');
});

it('refuse un produit ou une cuisine inconnus', async () => {
  await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], cuisineId: 'inconnu' }).expect(404);
  await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], ingredients: [{ label: 'y', productId: 'inconnu' }] }).expect(404);
});

it('remplace les ingrédients à la modification sans laisser d’orphelin', async () => {
  const created = await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], ingredients: [{ label: 'un' }, { label: 'deux' }] }).expect(201);
  const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ ingredients: [{ label: 'trois' }] }).expect(200);
  expect(updated.body.ingredients.map((i: { label: string }) => i.label)).toEqual(['trois']);
  expect(await t.prisma.recipeIngredient.count()).toBe(1);
});

it('lit une recette dont les étapes sont corrompues sans échouer', async () => {
  // Donnée héritée : « steps » n'est pas un tableau de chaînes.
  const created = await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'] }).expect(201);
  await t.prisma.recipe.update({ where: { id: created.body.id }, data: { steps: { bloc: 'texte libre' } } });
  const res = await agent.get(`/api/v1/recipes/${created.body.id}`).expect(200);
  expect(res.body.steps).toEqual([]);
});

it('supprime une recette jamais cuisinée', async () => {
  const created = await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'] }).expect(201);
  await agent.delete(`/api/v1/recipes/${created.body.id}`).expect(204);
  await agent.get(`/api/v1/recipes/${created.body.id}`).expect(404);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, 404 sur `/api/v1/recipes`.

- [ ] **Step 3: Implémenter**

`recipe.mapper.ts` contient la lecture défensive des étapes :

```ts
/** `steps` est un Json : une donnée héritée ou corrompue ne doit pas casser la fiche. */
export function parseSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
}
```

`recipes.service.ts` : `create` calcule la difficulté par `computeDifficulty({ steps, prepMinutes })` sauf si `input.difficulty` est fourni, auquel cas `difficultyOverride` passe à vrai. `update` recalcule seulement si `difficultyOverride` est faux et qu'une des entrées du calcul change ; une `difficulty` explicite pose le drapeau. Les ingrédients sont remplacés en bloc dans une transaction : `deleteMany` puis `createMany`. Les existences de cuisine, produit et catégorie sont vérifiées avant écriture, avec `ApiError.notFound`.

`remove` compte les `RecipeLog` : au-delà de zéro, `ApiError.conflict('Cette recette a déjà été cuisinée', { cookedCount })`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes apps/api/src/app.module.ts
git commit -m "feat(recipes): saisie des recettes du foyer et difficulté calculée (EF-17, EF-21)"
```

---

### Task 7: API — liste filtrée et triée par couverture

**Files:**
- Create: `apps/api/src/recipes/recipes.coverage.ts`
- Modify: `apps/api/src/recipes/recipes.service.ts`, `recipes.controller.ts`, `recipes.e2e-spec.ts`

**Interfaces:**
- Consumes: `buildStockSnapshot`, `recipeCoverage`, `compareByCoverage`, `expiryStatus`, `excludedFromRecipes`, `convertQuantity`, `SettingsService`.
- Produces:
```ts
export class RecipesCoverageService {
  snapshot(): Promise<StockSnapshot>;                                  // deux requêtes, agrégation en mémoire
  decorate(recipes: RecipeWithRelations[], snapshot: StockSnapshot): RecipeSummaryDto[];
}
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('classe les recettes en trois groupes et masque les écartées par défaut', async () => {
  // riz en stock, crème absente
  await createRecipe('Riz nature', [{ productId: rizId, quantity: 100, unit: 'GRAM' }]);
  await createRecipe('Riz à la crème', [{ productId: rizId, quantity: 100, unit: 'GRAM' }, { productId: cremeId, quantity: 20, unit: 'MILLILITER', essential: false }]);
  await createRecipe('Gratin', [{ productId: cremeId, quantity: 200, unit: 'MILLILITER' }]);

  const res = await agent.get('/api/v1/recipes').expect(200);
  expect(res.body.items.map((r: { title: string; group: string }) => [r.title, r.group])).toEqual([
    ['Riz nature', 'ready'],
    ['Riz à la crème', 'almost'],
  ]);
  expect(res.body.items[1].missingLabels).toEqual(['Crème fraîche']);

  const all = await agent.get('/api/v1/recipes?includeExcluded=true').expect(200);
  expect(all.body.items).toHaveLength(3);
  expect(all.body.items[2].group).toBe('excluded');
});

it('exclut du calcul un lot dont la DLC est dépassée', async () => {
  await createStock(cremeId, 500, 'MILLILITER', { expiryDate: isoIn(-2), dateType: 'USE_BY' });
  await createRecipe('Gratin', [{ productId: cremeId, quantity: 200, unit: 'MILLILITER' }]);
  const res = await agent.get('/api/v1/recipes?includeExcluded=true').expect(200);
  expect(res.body.items[0].group).toBe('excluded');
});

it('suit la fusion de produits', async () => {
  // La recette vise l'ancien produit, le stock est sur la cible de fusion.
  await createRecipe('Soja', [{ productId: ancienId, quantity: 10, unit: 'MILLILITER' }]);
  await agent.post(`/api/v1/products/${ancienId}/merge`).send({ targetId: cibleId }).expect(200);
  await createStock(cibleId, 500, 'MILLILITER');
  const res = await agent.get('/api/v1/recipes').expect(200);
  expect(res.body.items[0].group).toBe('ready');
});

it('remonte les recettes qui consomment un article proche de sa date', async () => {
  await createStock(rizId, 1000, 'GRAM');
  await createStock(tofuId, 400, 'GRAM', { expiryDate: isoIn(2), dateType: 'USE_BY' });
  await createRecipe('Riz nature', [{ productId: rizId, quantity: 100, unit: 'GRAM' }]);
  await createRecipe('Tofu sauté', [{ productId: tofuId, quantity: 200, unit: 'GRAM' }]);
  const res = await agent.get('/api/v1/recipes').expect(200);
  expect(res.body.items[0].title).toBe('Tofu sauté');
  expect(res.body.items[0].bonus).toBe(1);
});

it('applique les filtres de la section 12', async () => {
  const faciles = await agent.get('/api/v1/recipes?difficulty=VERY_EASY&includeExcluded=true').expect(200);
  expect(faciles.body.items.every((r: { difficulty: string }) => r.difficulty === 'VERY_EASY')).toBe(true);
  const rapides = await agent.get('/api/v1/recipes?maxTime=20&includeExcluded=true').expect(200);
  expect(rapides.body.items.every((r: { totalMinutes: number | null }) => (r.totalMinutes ?? 0) <= 20)).toBe(true);
});

it('exclut d’un filtre de régime les recettes qui ne le déclarent pas', async () => {
  await createRecipe('Steak', [], { diets: [] });
  await createRecipe('Dahl', [], { diets: ['vegetarian'] });
  const res = await agent.get('/api/v1/recipes?diet=vegetarian&includeExcluded=true').expect(200);
  expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Dahl']);
});

it('répond sous deux secondes pour 300 recettes et 1 500 lots', async () => {
  await seedLoad(300, 1500);
  const started = Date.now();
  await agent.get('/api/v1/recipes?includeExcluded=true&limit=50').expect(200);
  expect(Date.now() - started).toBeLessThan(2000);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, la liste n'est pas triée et `group` est absent.

- [ ] **Step 3: Implémenter**

`recipes.coverage.ts` construit l'instantané en deux requêtes, puis agrège en mémoire pour pouvoir appliquer `expiryStatus`, qui est une règle pure et n'a pas d'équivalent SQL :

```ts
const [lots, alertDays] = await Promise.all([
  this.prisma.stockItem.findMany({
    where: { archivedAt: null, quantity: { gt: 0 } },
    select: {
      quantity: true, unit: true, effectiveExpiry: true, dateType: true, dateEstimated: true,
      product: { select: { id: true, categoryId: true, defaultUnit: true, netContent: true, netContentUnit: true, mergedIntoId: true } },
    },
  }),
  this.settings.expiryAlertDays(),
]);
```

Pour chaque lot : résoudre `mergedIntoId` vers le produit cible, calculer `expiryStatus`, écarter si `excludedFromRecipes`, convertir la quantité dans `product.defaultUnit`, additionner par produit, et poser `nearExpiry` quand le statut vaut `soon` ou `expired_best_before`.

Le test de charge s'appuie sur une aide locale à écrire dans le fichier de
test, qui sème directement par Prisma pour rester rapide :

```ts
/** Sème des volumes réalistes : une recette sur trois est réalisable. */
async function seedLoad(recipes: number, lots: number): Promise<void> {
  const products = await Promise.all(
    Array.from({ length: 60 }, (_, n) => t.prisma.product.create({ data: { name: `Produit ${n}`, defaultUnit: 'GRAM' } })),
  );
  await t.prisma.stockItem.createMany({
    data: Array.from({ length: lots }, (_, n) => ({
      productId: products[n % products.length]!.id, locationId: placardId, quantity: 500, unit: 'GRAM',
    })),
  });
  for (let n = 0; n < recipes; n++) {
    await t.prisma.recipe.create({
      data: {
        title: `Recette ${n}`, difficulty: 'EASY', servings: 4, steps: ['Préparer'], diets: [],
        ingredients: {
          create: Array.from({ length: 8 }, (_, k) => ({
            label: `ingrédient ${k}`, productId: products[(n + k) % products.length]!.id, quantity: 100, unit: 'GRAM', essential: k < 2,
          })),
        },
      },
    });
  }
}
```

Les filtres prédicats partent en `where` Prisma : `difficulty: { in }`, `cuisineId: { in }`, `dishType: { in }`, `diets: { hasEvery: diet }`, et pour le temps `OR` sur la somme `prepMinutes + cookMinutes` calculée en mémoire faute de champ dérivé, ce qui reste acceptable puisque le jeu est déjà réduit par les autres filtres. La couverture, le groupe et le tri sont appliqués ensuite, puis la pagination.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api`
Expected: PASS, y compris le test de charge.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes
git commit -m "feat(recipes): suggestions classées par couverture du stock (EF-17, EF-23, EF-27)"
```

---

### Task 8: API — cuisson et décrément

**Files:**
- Create: `apps/api/src/recipes/recipes.cook.ts`
- Modify: `apps/api/src/recipes/recipes.controller.ts`, `recipes.e2e-spec.ts`

**Interfaces:**
- Consumes: `applyMovement` de `stock/stock.quantity.ts`, `capConsumption`, `convertQuantity`, `cookRecipeSchema`.
- Produces: `POST /recipes/{id}/cook` renvoyant `CookResult`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('décrémente au prorata des portions et journalise la cuisson', async () => {
  await createStock(rizId, 1000, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
  const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 2, lines: [{ ingredientId: recipe.ingredients[0].id }], rating: 4 }).expect(200);
  expect(res.body.lines[0]).toMatchObject({ applied: 100, unit: 'GRAM', capped: false });
  const lot = await t.prisma.stockItem.findFirstOrThrow({ where: { productId: rizId } });
  expect(lot.quantity.toNumber()).toBe(900);
  const movement = await t.prisma.stockMovement.findFirstOrThrow({ where: { type: 'RECIPE' } });
  expect(movement.recipeLogId).toBe(res.body.logId);
  const log = await t.prisma.recipeLog.findUniqueOrThrow({ where: { id: res.body.logId } });
  expect(log).toMatchObject({ servingsCooked: 2, rating: 4, stockApplied: true });
});

it('ne touche pas au stock d’une ligne décochée', async () => {
  await createStock(rizId, 1000, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }]);
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 4, lines: [] }).expect(200);
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1000);
  expect(await t.prisma.stockMovement.count({ where: { type: 'RECIPE' } })).toBe(0);
});

it('plafonne au stock disponible et le signale', async () => {
  await createStock(rizId, 150, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 2 });
  const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }] }).expect(200);
  expect(res.body.lines[0]).toMatchObject({ requested: 400, applied: 150, capped: true });
  expect(res.body.message).toContain('ramenée');
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(0);
});

it('prend d’abord les lots dont la date est la plus proche', async () => {
  const proche = await createStock(rizId, 300, 'GRAM', { expiryDate: isoIn(3), dateType: 'USE_BY' });
  const loin = await createStock(rizId, 300, 'GRAM', { expiryDate: isoIn(90), dateType: 'USE_BY' });
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }] }).expect(200);
  expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: proche } })).quantity.toNumber()).toBe(100);
  expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: loin } })).quantity.toNumber()).toBe(300);
});

it('rejoue une cuisson sans doubler le décrément', async () => {
  await createStock(rizId, 1000, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
  const body = { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }], clientOpId: 'op-cuisson-0001' };
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send(body).expect(200);
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send(body).expect(200);
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(800);
  expect(await t.prisma.recipeLog.count()).toBe(1);
});

it('refuse la suppression d’une recette déjà cuisinée', async () => {
  const recipe = await createRecipe('Riz', []);
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 2, lines: [] }).expect(200);
  const res = await agent.delete(`/api/v1/recipes/${recipe.id}`).expect(409);
  expect(res.body.error.details).toMatchObject({ cookedCount: 1 });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, 404 sur la route de cuisson.

- [ ] **Step 3: Implémenter**

`recipes.cook.ts`, dans une seule transaction : créer le `RecipeLog`, puis pour chaque ligne retenue calculer `requested = quantity * servingsCooked / recipe.servings`, choisir les lots du produit triés par `effectiveExpiry` croissante en plaçant les sans-date en dernier, et consommer lot par lot avec `applyMovement` de type `RECIPE`, en rattachant `recipeLogId`. Le plafonnement reprend `capConsumption`. Le `clientOpId` est suffixé par l'identifiant de l'ingrédient pour rester unique par mouvement, tout en gardant l'idempotence de l'ensemble : `${clientOpId}:${ingredientId}:${index}`. Avant toute écriture, si un `RecipeLog` existe déjà pour ce `clientOpId`, la réponse précédente est renvoyée telle quelle, ce qui suppose d'ajouter `clientOpId String? @unique` au modèle `RecipeLog` et donc une migration, à inclure dans cette tâche.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api && npx vitest run --root apps/api`
Expected: PASS, suite complète verte.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes prisma/schema.prisma prisma/migrations
git commit -m "feat(recipes): cuisson avec décrément au prorata des portions (EF-18, EF-28)"
```

---

### Task 9: Semence de développement

**Files:**
- Modify: `prisma/seed/dev.ts`

**Interfaces:**
- Consumes: les produits déjà semés.
- Produces: 8 recettes couvrant les quatre difficultés et cinq cuisines (section 19).

- [ ] **Step 1: Écrire les recettes**

Huit recettes rattachées aux produits existants de la semence, avec leurs ingrédients, dont au moins deux visant une catégorie et un marqué substituable, et une recette volontairement incomplète pour illustrer le groupe `almost`. Cuisines : japonaise, coréenne, italienne, française, thaïlandaise.

- [ ] **Step 2: Vérifier**

Run: `npm run seed:dev -w @kitchen/api` sur une base de développement, puis `GET /api/v1/recipes` et vérifier qu'au moins trois recettes ressortent en `ready`, ce qui est la recette du lot 2.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed/dev.ts
git commit -m "test(recipes): huit recettes dans le jeu de développement (section 19)"
```

---

### Task 10: Front — écran Recettes et filtres

**Files:**
- Create: `apps/web/src/screens/recipes/recipes-screen.tsx`, `recipe-filters.tsx`, `recipe-card.tsx`, `recipe-filters.test.tsx`
- Create: `apps/web/src/lib/recipes-api.ts`
- Modify: `apps/web/src/lib/queries.ts`, `apps/web/src/app.tsx`

**Interfaces:**
- Consumes: `recipeListQuerySchema`, `RecipeSummaryDto`, `DIFFICULTY_LABELS_FR`, `DISH_TYPE_LABELS_FR`, `DIET_LABELS_FR`.
- Produces: route `/recettes`, `useRecipesQuery(filters)`, `useRecipeFiltersPreference()`.

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecipeFiltersBar } from './recipe-filters';

const empty = { difficulty: [], cuisine: [], dishType: [], diet: [], includeExcluded: false };

describe('RecipeFiltersBar', () => {
  it('ajoute et retire une difficulté sans toucher aux autres filtres', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, difficulty: ['EASY'] });
  });

  it('compte les filtres actifs', () => {
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], maxTime: 30 }} cuisines={[]} onChange={vi.fn()} />);
    expect(screen.getByText('2 filtres')).toBeTruthy();
  });

  it('remet tout à zéro', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'] }} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(onChange).toHaveBeenCalledWith(empty);
  });

  it('bascule l’affichage des recettes incomplètes', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /recettes incomplètes/ }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, includeExcluded: true });
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

La liste réutilise le motif de pagination de l'écran Stock. Chaque carte porte le titre, la pastille de couverture, la cuisine, le temps total, la difficulté, et la mention des manquants. L'état vide invite à créer une première recette. Les filtres sont chargés depuis les préférences au montage et enregistrés à chaque changement, avec un délai pour ne pas écrire à chaque frappe.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipes apps/web/src/lib/recipes-api.ts apps/web/src/lib/queries.ts apps/web/src/app.tsx
git commit -m "feat(web): écran Recettes, filtres persistants et taux de couverture (EF-21, EF-22, EF-23)"
```

---

### Task 11: Front — fiche recette

**Files:**
- Create: `apps/web/src/screens/recipe/recipe-screen.tsx`, `ingredient-row.tsx`, `ingredient-row.test.tsx`
- Modify: `apps/web/src/app.tsx`

**Interfaces:**
- Consumes: `RecipeDto`, `RecipeIngredientDto`.
- Produces: route `/recettes/:id`.

- [ ] **Step 1: Écrire le test qui échoue**

Test de présentation d'une ligne d'ingrédient pour les quatre états : disponible, manquant, hors inventaire en gris, quantité non vérifiable avec son explication. Vérifier que la mention de péremption proche apparaît quand `nearExpiry` est vrai.

- [ ] **Step 2 à 4: Échec, implémentation, succès**

La fiche affiche les ingrédients, les étapes numérotées, la difficulté, les temps, les portions, et les actions cuisiner, modifier, supprimer. La suppression refusée affiche le message du serveur avec le nombre de cuissons. Aucun bouton d'ajout aux courses : la liste n'existe pas, et une mention discrète l'explique.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipe apps/web/src/app.tsx
git commit -m "feat(web): fiche recette avec l'état de chaque ingrédient (EF-23)"
```

---

### Task 12: Front — formulaire de saisie

**Files:**
- Create: `apps/web/src/screens/recipe-form/recipe-form-screen.tsx`, `ingredient-editor.tsx`, `recipe-form.test.tsx`
- Modify: `apps/web/src/app.tsx`

**Interfaces:**
- Consumes: `createRecipeSchema`, `updateRecipeSchema`, recherche de produits existante.
- Produces: routes `/recettes/nouvelle` et `/recettes/:id/modifier`.

- [ ] **Step 1: Écrire le test qui échoue**

Test : la difficulté proposée se met à jour quand on ajoute des étapes, et cesse de bouger dès que l'utilisateur la corrige à la main.

- [ ] **Step 2 à 4: Échec, implémentation, succès**

Les ingrédients se rattachent par la recherche de produits, ou restent en texte libre. Chaque ligne porte quantité, unité, essentiel et substituable. Les étapes sont une liste ordonnable.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipe-form apps/web/src/app.tsx
git commit -m "feat(web): saisie et modification d'une recette (EF-17)"
```

---

### Task 13: Front — tiroir de cuisson

**Files:**
- Create: `apps/web/src/screens/recipe/cook-sheet.tsx`, `cook-sheet.test.tsx`

**Interfaces:**
- Consumes: `cookRecipeSchema`, `CookResult`.
- Produces: tiroir appelé depuis la fiche.

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CookSheetView } from './cook-sheet';

const recipe = {
  id: 'r1', title: 'Riz', servings: 4,
  ingredients: [
    { id: 'i1', label: 'Riz', quantity: 200, unit: 'GRAM', state: 'available' },
    { id: 'i2', label: 'Sel', quantity: null, unit: null, state: 'untracked' },
  ],
};

describe('CookSheetView', () => {
  it('recalcule les quantités au prorata des portions', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('200 g')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Portions réalisées'), { target: { value: '2' } });
    expect(screen.getByText('100 g')).toBeTruthy();
  });

  it('n’envoie que les lignes cochées, et rien avant validation', () => {
    const onConfirm = vi.fn();
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Riz/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm).toHaveBeenCalledWith({ servingsCooked: 4, lines: [], rating: null });
  });

  it('laisse la note facultative', () => {
    const onConfirm = vi.fn();
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm.mock.calls[0][0].rating).toBeNull();
    expect(onConfirm.mock.calls[0][0].lines).toEqual([{ ingredientId: 'i1' }]);
  });

  it('ne propose pas de décrémenter un ingrédient hors inventaire', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('checkbox', { name: /Sel/ })).toBeNull();
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

Même esprit que le tiroir de validation du scan. Après succès, une notification indique ce qui a été décrémenté, et mentionne les lignes plafonnées le cas échéant.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipe
git commit -m "feat(web): cuisson d'une recette depuis la fiche (EF-18, EF-28)"
```

---

### Task 14: Documentation et publication

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/decisions/2026-09-20-choix-implementation-lot-1.md`

- [ ] **Step 1: Mettre à jour le README**

Décrire le module dans les fonctionnalités, en français : suggestions classées par couverture, filtres, cuisson avec décrément, et la limite connue de l'absence d'ajout aux courses. Ajouter la ligne de version dans « Derniers changements ».

- [ ] **Step 2: Consigner les décisions**

Noter dans les décisions la formule de difficulté, le traitement des ingrédients hors inventaire, le pont par la contenance, et la remontée de EF-25 et EF-26 au périmètre du lot 2 à la demande de Franck.

- [ ] **Step 3: Vérification complète**

```bash
npm run build -w @kitchen/shared && npm run lint && npm run typecheck --workspaces --if-present && npm test --workspaces --if-present && npm run build -w @kitchen/web
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs
git commit -m "docs: module recettes dans le README et décisions associées"
```
