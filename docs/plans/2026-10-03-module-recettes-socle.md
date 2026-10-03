# Module recettes, socle — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le socle du module recettes selon la révision 2 de la spécification : saisie par le foyer, couverture calculée sur le stock réel, historique et notation par membre, filtres et tris mémorisés, archivage, cuisson avec décrément.

**Architecture:** Les règles de difficulté, de disponibilité, d'indicateurs et de tri sont des fonctions pures de `packages/shared`, testées isolément. L'API applique les filtres prédicats en SQL, charge un instantané du stock et les indicateurs agrégés, puis appelle ces fonctions pures en mémoire ; le tri et la pagination suivent, dans cet ordre. Le front réutilise la coque, les composants et les conventions du lot 1.

**Tech Stack:** Node 22, TypeScript 5.9 strict, NestJS 12, Prisma 6, PostgreSQL 16, Zod 4, Vitest 4, React 19, Vite 8, Tailwind 4, TanStack Query 5.

**Spec:** `docs/specs/2026-10-03-module-recettes-socle.md`, révision 2 du 2026-10-03, arbitrages A1 à A27. Le cahier `docs/cahier-des-charges.md` a été amendé le même jour pour le classement des suggestions, voir sa section 26.

## Global Constraints

- `StockItem.quantity` est matérialisée : toute écriture insère un `StockMovement` puis recalcule `quantity = Σ delta` dans la même transaction. Jamais d'écriture directe.
- Chaque écriture de stock accepte `clientOpId` ; un identifiant déjà vu renvoie le résultat précédent.
- Les règles métier vivent dans `packages/shared`, jamais recopiées dans un contrôleur ni dans un composant.
- Anglais pour le code et les identifiants, français pour les libellés d'interface et les messages d'erreur.
- TypeScript strict, `any` interdit hors tests.
- Validation par Zod, schémas définis une seule fois dans `packages/shared` et réutilisés côté front.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- Aucun test ne dépend du réseau.
- Erreurs : `{error: {code, message, details?}}`, codes de la section 16 du cahier.
- Pagination : `{items, total, page, limit}`, limite par défaut 50, maximum 200. Pour les recettes, elle est appliquée **après** le tri en mémoire (A18).
- Tous les membres du foyer ont les mêmes droits sur les recettes, les cuisines et l'archivage (A21). Un utilisateur ne modifie que sa propre note.
- Chaque évolution met à jour `README.md` en français dans le même commit, et la section « Derniers changements » reçoit sa ligne.
- Commits en Conventional Commits avec la référence de l'exigence : `feat(recipes): … (EF-17)`.

## Review Focus

Cinq cas que la spécification implique sans qu'un test évident les couvre, le plus probable en premier. Chacun reçoit son test dans la tâche qui détient le code.

1. **Cuisson de plus de portions que le stock ne permet** — le prorata dépasse la quantité disponible. Attendu : plafonnement ligne par ligne, signalement dans la réponse, jamais de quantité négative. Test en tâche 10.
2. **Deux lignes d'ingrédient visant le même produit** — A9 impose de les évaluer séparément, mais la cuisson les décrémente toutes deux sur le même stock. Attendu : les deux paraissent disponibles, et la seconde est plafonnée à la cuisson. Test en tâche 10.
3. **Produit d'un ingrédient fusionné depuis la saisie de la recette** — `Product.mergedIntoId` pointe ailleurs. Attendu : l'instantané suit la fusion et le stock du produit cible compte. Test en tâche 9.
4. **Notation d'une réalisation par un membre supprimé ensuite** — la contrainte d'unicité porte sur l'utilisateur. Attendu : la suppression du compte emporte ses notes sans fausser la moyenne des autres. Test en tâche 11.
5. **`steps` qui n'est pas un tableau de chaînes** — donnée héritée ou corrompue en base. Attendu : la lecture ne lève pas, la fiche affiche une recette sans étape plutôt qu'un écran blanc. Test en tâche 8.

---

## Structure des fichiers

```
packages/shared/src/rules/difficulty.ts        score, techniques, formes explicites
packages/shared/src/rules/coverage.ts          instantané, disponibilité, couverture
packages/shared/src/rules/recipe-stats.ts      indicateurs, étiquettes, fenêtre de notation
packages/shared/src/rules/recipe-sort.ts       les cinq tris
packages/shared/src/schemas/recipes.ts         schémas Zod, énumérations, DTO
prisma/migrations/0003_recipes_socle/          toutes les évolutions de schéma du socle
apps/api/src/recipes/recipes.module.ts         module
apps/api/src/recipes/recipes.controller.ts     routes recettes
apps/api/src/recipes/recipes.service.ts        CRUD, archivage
apps/api/src/recipes/recipes.coverage.ts       instantané de stock
apps/api/src/recipes/recipes.stats.ts          agrégats d'historique
apps/api/src/recipes/recipes.cook.ts           cuisson et mouvements
apps/api/src/recipes/recipe-logs.controller.ts réalisations et notation
apps/api/src/recipes/recipe.mapper.ts          entités Prisma vers DTO
apps/api/src/cuisines/                         cuisines, unicité normalisée
apps/api/src/preferences/                      filtres et tri par utilisateur
apps/web/src/screens/recipes/                  liste, filtres, tri, cartes, rappel
apps/web/src/screens/recipe/                   fiche, historique, tiroir de cuisson
apps/web/src/screens/recipe-form/              formulaire de saisie
```

## Fonctions d'aide des tests d'intégration

Les tâches 8 à 12 les partagent, à écrire une fois en tête de `apps/api/src/recipes/recipes.e2e-spec.ts`.

```ts
const isoIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const createProduct = async (name: string, defaultUnit = 'GRAM', categoryId?: string): Promise<string> =>
  (await agent.post('/api/v1/products').send({ name, defaultUnit, categoryId }).expect(201)).body.id;

const createStock = async (productId: string, quantity: number, unit: string, extra: Record<string, unknown> = {}): Promise<string> =>
  (await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity, unit, ...extra }).expect(201)).body.item.id;

const createRecipe = async (title: string, ingredients: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  (
    await agent
      .post('/api/v1/recipes')
      .send({ title, steps: ['Préparer'], servings: 4, ingredients: ingredients.map((i, n) => ({ label: `ingrédient ${n}`, ...i })), ...extra })
      .expect(201)
  ).body;

/** Réalisation sans décrément, pour fabriquer un historique. */
const logCooked = async (recipeId: string, extra: Record<string, unknown> = {}) =>
  (await agent.post(`/api/v1/recipes/${recipeId}/logs`).send({ servingsCooked: 4, ...extra }).expect(201)).body;

/** Crée un second membre du foyer et renvoie son agent connecté. */
const createMember = async (email: string) => {
  const password = 'encore-un-mot-de-passe';
  await agent.post('/api/v1/users').send({ email, name: email.split('@')[0], password }).expect(201);
  const member = t.agent();
  await member.post('/api/v1/auth/login').send({ email, password }).expect(204);
  return member;
};
```

---

### Task 1: Règle pure — difficulté calculée

**Files:**
- Create: `packages/shared/src/rules/difficulty.ts`, `difficulty.test.ts`
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Consumes: `normalizeProductName` de `rules/duplicates.ts`.
- Produces:
```ts
export type Difficulty = 'VERY_EASY' | 'EASY' | 'INTERMEDIATE' | 'HARD';
export const TECHNIQUE_FORMS: Readonly<Record<string, readonly string[]>>;
export const TECHNIQUE_EXCEPTIONS: readonly string[];
export function detectTechniques(steps: readonly string[]): string[];
export function difficultyScore(input: { steps: readonly string[]; activeTime: number | null; prepMinutes: number | null }): number;
export function computeDifficulty(input: { steps: readonly string[]; activeTime: number | null; prepMinutes: number | null }): Difficulty;
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { computeDifficulty, detectTechniques, difficultyScore } from './difficulty.js';

describe('detectTechniques', () => {
  it('repère une technique sous chacune de ses formes', () => {
    expect(detectTechniques(['Réduire la sauce'])).toEqual(['reduire']);
    expect(detectTechniques(['Faites réduire de moitié'])).toEqual(['reduire']);
    expect(detectTechniques(['Sauce réduite à feu doux'])).toEqual(['reduire']);
  });
  it('ne compte une technique qu’une fois par recette', () => {
    expect(detectTechniques(['Réduire la sauce', 'Réduire encore'])).toEqual(['reduire']);
  });
  it('exige des mots entiers (A11)', () => {
    expect(detectTechniques(['Soulever délicatement', 'Se dessaisir du moule'])).toEqual([]);
  });
  it('ignore les expressions de la liste d’exceptions', () => {
    expect(detectTechniques(['Réduire le feu et couvrir'])).toEqual([]);
    expect(detectTechniques(['Réduire la flamme', 'Réduire la sauce'])).toEqual(['reduire']);
  });
  it('ne repère rien dans une recette sans technique', () => {
    expect(detectTechniques(['Mélanger les ingrédients', 'Servir frais'])).toEqual([]);
  });
});

describe('difficultyScore', () => {
  it('additionne étapes, temps actif et techniques', () => {
    expect(difficultyScore({ steps: ['Ouvrir', 'Servir'], activeTime: 5, prepMinutes: null })).toBe(0);
    expect(difficultyScore({ steps: ['a', 'b', 'c', 'd', 'Déglacer la poêle'], activeTime: 30, prepMinutes: null })).toBe(4);
  });
  it('se replie sur le temps de préparation quand le temps actif manque (A12)', () => {
    expect(difficultyScore({ steps: ['a'], activeTime: null, prepMinutes: 60 })).toBe(3);
    expect(difficultyScore({ steps: ['a'], activeTime: 5, prepMinutes: 60 })).toBe(0);
  });
  it('traite deux temps absents comme nuls', () => {
    expect(difficultyScore({ steps: ['a'], activeTime: null, prepMinutes: null })).toBe(0);
  });
  it('plafonne la contribution des techniques à trois points', () => {
    const steps = ['Pétrir', 'Laisser lever', 'Émulsionner', 'Caraméliser', 'Flamber'];
    expect(difficultyScore({ steps, activeTime: 0, prepMinutes: null })).toBe(4);
  });
});

describe('computeDifficulty', () => {
  it('place chaque score dans son palier', () => {
    expect(computeDifficulty({ steps: ['Ouvrir la boîte'], activeTime: 2, prepMinutes: null })).toBe('VERY_EASY');
    expect(computeDifficulty({ steps: ['a', 'b', 'c', 'd'], activeTime: 20, prepMinutes: null })).toBe('EASY');
    expect(computeDifficulty({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], activeTime: 30, prepMinutes: null })).toBe('INTERMEDIATE');
    expect(
      computeDifficulty({
        steps: ['Pétrir la pâte', 'Laisser lever', 'Émulsionner', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
        activeTime: 90,
        prepMinutes: null,
      }),
    ).toBe('HARD');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/rules/difficulty --root packages/shared`
Expected: FAIL, `detectTechniques is not a function`.

- [ ] **Step 3: Implémenter**

```ts
import { normalizeProductName } from './duplicates.js';

export type Difficulty = 'VERY_EASY' | 'EASY' | 'INTERMEDIATE' | 'HARD';

/**
 * Techniques qui font monter la difficulté (décision 9 du cahier). Chaque forme
 * est écrite explicitement : A11 interdit la racinisation et la correspondance
 * partielle, qui trouvaient « saisir » dans « dessaisir ».
 */
export const TECHNIQUE_FORMS: Readonly<Record<string, readonly string[]>> = {
  emulsionner: ['emulsionner', 'emulsionnez', 'emulsionne', 'emulsionnee', 'emulsion'],
  'monter en neige': ['monter en neige', 'montez en neige'],
  carameliser: ['carameliser', 'caramelisez', 'caramelise', 'caramelisee'],
  flamber: ['flamber', 'flambez', 'flambe', 'flambee'],
  pocher: ['pocher', 'pochez', 'poche', 'pochee', 'pochees'],
  reduire: ['reduire', 'reduisez', 'reduit', 'reduite', 'reduction'],
  clarifier: ['clarifier', 'clarifiez', 'clarifie', 'clarifiee'],
  petrir: ['petrir', 'petrissez', 'petri', 'petrie'],
  lever: ['lever', 'levez', 'levee', 'laisser lever'],
  saisir: ['saisir', 'saisissez', 'saisi', 'saisie'],
  deglacer: ['deglacer', 'deglacez', 'deglace', 'deglacee'],
  temperer: ['temperer', 'temperez', 'tempere', 'temperee'],
  blanchir: ['blanchir', 'blanchissez', 'blanchi', 'blanchie'],
  confire: ['confire', 'confisez', 'confit', 'confite'],
};

/** Expressions retirées du texte avant la recherche : elles ne décrivent pas une technique. */
export const TECHNIQUE_EXCEPTIONS: readonly string[] = [
  'reduire le feu', 'reduisez le feu', 'reduire la flamme', 'reduisez la flamme',
  'baisser la flamme', 'baissez la flamme',
];

/** Vrai si `needle` apparaît dans `haystack` délimité par autre chose qu'une lettre ou un chiffre. */
function containsWord(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? ' ' : haystack[at - 1]!;
    const after = haystack[at + needle.length] ?? ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

export function detectTechniques(steps: readonly string[]): string[] {
  let haystack = normalizeProductName(steps.join(' . '));
  for (const exception of TECHNIQUE_EXCEPTIONS) haystack = haystack.split(exception).join(' ');
  return Object.entries(TECHNIQUE_FORMS)
    .filter(([, forms]) => forms.some((form) => containsWord(haystack, form)))
    .map(([technique]) => technique);
}

function bucket(value: number, thresholds: readonly [number, number, number]): number {
  if (value <= thresholds[0]) return 0;
  if (value <= thresholds[1]) return 1;
  if (value <= thresholds[2]) return 2;
  return 3;
}

interface DifficultyInput {
  steps: readonly string[];
  /** Temps réellement passé aux fourneaux ; à défaut, le temps de préparation (A12). */
  activeTime: number | null;
  prepMinutes: number | null;
}

export function difficultyScore(input: DifficultyInput): number {
  const steps = bucket(input.steps.length, [3, 6, 10]);
  const time = bucket(input.activeTime ?? input.prepMinutes ?? 0, [10, 25, 45]);
  const techniques = Math.min(3, detectTechniques(input.steps).length);
  return steps + time + techniques;
}

export function computeDifficulty(input: DifficultyInput): Difficulty {
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
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rules/difficulty.ts packages/shared/src/rules/difficulty.test.ts packages/shared/src/rules/index.ts
git commit -m "feat(shared): difficulté calculée, techniques par mots entiers (EF-21)"
```

---

### Task 2: Règle pure — disponibilité et couverture

**Files:**
- Create: `packages/shared/src/rules/coverage.ts`, `coverage.test.ts`
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Consumes: `convertQuantity`, `sameFamily`, `UNIT_FAMILY`, `roundQuantity`, `Unit`.
- Produces:
```ts
export type IngredientState = 'available' | 'insufficient' | 'unverifiable' | 'missing' | 'untracked';
export type CoverageGroup = 'ready' | 'almost' | 'excluded';
export const ALMOST_COVERAGE_FLOOR = 0.6;

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
  availableQuantity: number | null;
  requiredQuantity: number | null;
}
export interface RecipeCoverage {
  coverage: number;
  group: CoverageGroup;
  bonus: number;
  missingIds: string[];
  outcomes: IngredientOutcome[];
}

export function buildStockSnapshot(entries: readonly StockEntry[], parentByCategory: ReadonlyMap<string, string | null>): StockSnapshot;
export function availableInUnit(entry: StockEntry, unit: Unit): number | null;
export function ingredientOutcome(ingredient: CoverageIngredient, snapshot: StockSnapshot): IngredientOutcome;
export function recipeCoverage(ingredients: readonly CoverageIngredient[], snapshot: StockSnapshot): RecipeCoverage;
export function countsAsAvailable(state: IngredientState): boolean;
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { availableInUnit, buildStockSnapshot, ingredientOutcome, recipeCoverage, type CoverageIngredient, type StockEntry } from './coverage.js';

const entry = (over: Partial<StockEntry> = {}): StockEntry => ({
  productId: 'p1', categoryId: 'c1', unit: 'GRAM', quantity: 500,
  netContent: null, netContentUnit: null, nearExpiry: false, ...over,
});
const ing = (over: Partial<CoverageIngredient> = {}): CoverageIngredient => ({
  id: 'i1', productId: 'p1', categoryId: null, quantity: 200, unit: 'GRAM',
  essential: false, substitutable: false, ...over,
});
/** c2 est une sous-catégorie de c1. */
const tree = new Map<string, string | null>([['c1', null], ['c2', 'c1']]);
const snap = (entries: StockEntry[]) => buildStockSnapshot(entries, tree);

describe('availableInUnit', () => {
  it('convertit dans la même famille', () => {
    expect(availableInUnit(entry({ unit: 'KILOGRAM', quantity: 1 }), 'GRAM')).toBe(1000);
  });
  it('fait le pont par la contenance entre paquets et grammes', () => {
    expect(availableInUnit(entry({ unit: 'PACK', quantity: 3, netContent: 500, netContentUnit: 'GRAM' }), 'GRAM')).toBe(1500);
  });
  it('refuse de ponter depuis une masse ou un volume', () => {
    expect(availableInUnit(entry({ unit: 'GRAM', netContent: 1, netContentUnit: 'LITER' }), 'LITER')).toBeNull();
  });
  it('renvoie null quand aucun pont n’existe', () => {
    expect(availableInUnit(entry({ unit: 'PACK', quantity: 3 }), 'GRAM')).toBeNull();
  });
});

describe('ingredientOutcome', () => {
  it('marque hors inventaire un ingrédient sans rattachement', () => {
    expect(ingredientOutcome(ing({ productId: null }), snap([entry()])).state).toBe('untracked');
  });
  it('sans quantité, suffit que la cible soit en stock', () => {
    expect(ingredientOutcome(ing({ quantity: null, unit: null }), snap([entry()])).state).toBe('available');
    expect(ingredientOutcome(ing({ productId: 'absent', quantity: null, unit: null }), snap([entry()])).state).toBe('missing');
  });
  it('distingue manquant et quantité insuffisante (A10)', () => {
    expect(ingredientOutcome(ing({ quantity: 200 }), snap([entry()])).state).toBe('available');
    expect(ingredientOutcome(ing({ quantity: 900 }), snap([entry()]))).toMatchObject({
      state: 'insufficient', availableQuantity: 500, requiredQuantity: 900,
    });
    expect(ingredientOutcome(ing({ productId: 'absent' }), snap([entry()])).state).toBe('missing');
  });
  it('signale une quantité non vérifiable plutôt que de trancher', () => {
    expect(ingredientOutcome(ing({ quantity: 200, unit: 'GRAM' }), snap([entry({ unit: 'PACK', quantity: 2 })])).state).toBe('unverifiable');
  });
  it('traite une quantité à la pièce comme non vérifiable (A6)', () => {
    expect(ingredientOutcome(ing({ quantity: 3, unit: 'PIECE' }), snap([entry({ unit: 'PIECE', quantity: 6 })])).state).toBe('unverifiable');
  });
  it('inclut les sous-catégories, récursivement (A3)', () => {
    const s = snap([entry({ productId: 'sous', categoryId: 'c2', quantity: 300 })]);
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 200 }), s).state).toBe('available');
  });
  it('additionne les produits convertibles d’une catégorie et ignore les autres', () => {
    const s = snap([
      entry({ productId: 'a', quantity: 150 }),
      entry({ productId: 'b', quantity: 100 }),
      entry({ productId: 'c', unit: 'PACK', quantity: 9 }),
    ]);
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 200 }), s).state).toBe('available');
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 400 }), s).state).toBe('insufficient');
  });
  it('un substituable accepte un autre produit de la catégorie de son produit', () => {
    const s = snap([entry({ productId: 'autre', quantity: 300 })]);
    expect(ingredientOutcome(ing({ substitutable: true, quantity: 200 }), s).state).toBe('available');
    expect(ingredientOutcome(ing({ substitutable: false, quantity: 200 }), s).state).toBe('missing');
  });
  it('évalue chaque ligne indépendamment (A9)', () => {
    const s = snap([entry({ quantity: 300 })]);
    expect([
      ingredientOutcome(ing({ id: 'a', quantity: 200 }), s).state,
      ingredientOutcome(ing({ id: 'b', quantity: 200 }), s).state,
    ]).toEqual(['available', 'available']);
  });
  it('reporte la proximité de date du lot qui satisfait l’ingrédient', () => {
    expect(ingredientOutcome(ing(), snap([entry({ nearExpiry: true })])).nearExpiry).toBe(true);
  });
});

describe('recipeCoverage', () => {
  const s = snap([entry()]);
  it('classe réalisable une recette entièrement couverte', () => {
    expect(recipeCoverage([ing()], s)).toMatchObject({ coverage: 1, group: 'ready', missingIds: [] });
  });
  it('compte insuffisant et non vérifiable comme disponibles', () => {
    expect(recipeCoverage([ing({ quantity: 900 }), ing({ id: 'i2', quantity: 2, unit: 'PIECE' })], s)).toMatchObject({
      coverage: 1, group: 'ready',
    });
  });
  it('exige une couverture d’au moins 60 % pour « presque » (A8)', () => {
    const present = [1, 2].map((n) => ing({ id: `ok${n}` }));
    const absent = ing({ id: 'ko', productId: 'absent' });
    expect(recipeCoverage([...present, absent], s)).toMatchObject({ group: 'almost', coverage: 0.67 });
    expect(recipeCoverage([ing(), absent, ing({ id: 'ko2', productId: 'absent2' })], s).group).toBe('excluded');
  });
  it('écarte une recette dont un ingrédient essentiel manque', () => {
    expect(recipeCoverage([ing(), ing({ id: 'i2', productId: 'absent', essential: true })], s).group).toBe('excluded');
  });
  it('ignore les ingrédients hors inventaire dans le taux', () => {
    expect(recipeCoverage([ing(), ing({ id: 'sel', productId: null })], s)).toMatchObject({ coverage: 1, group: 'ready' });
  });
  it('tient pour réalisable une recette sans ingrédient retenu (A7)', () => {
    expect(recipeCoverage([], s)).toMatchObject({ coverage: 1, group: 'ready', bonus: 0 });
    expect(recipeCoverage([ing({ productId: null })], s).coverage).toBe(1);
  });
  it('compte un bonus par ingrédient satisfait depuis un lot proche de sa date', () => {
    expect(recipeCoverage([ing()], snap([entry({ nearExpiry: true })])).bonus).toBe(1);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/rules/coverage --root packages/shared`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

```ts
import { convertQuantity, roundQuantity, sameFamily, UNIT_FAMILY, type Unit } from '../units.js';

export type IngredientState = 'available' | 'insufficient' | 'unverifiable' | 'missing' | 'untracked';
export type CoverageGroup = 'ready' | 'almost' | 'excluded';

/** Seuil du groupe « presque » (A8). */
export const ALMOST_COVERAGE_FLOOR = 0.6;

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
  availableQuantity: number | null;
  requiredQuantity: number | null;
}

export interface RecipeCoverage {
  coverage: number;
  group: CoverageGroup;
  bonus: number;
  missingIds: string[];
  outcomes: IngredientOutcome[];
}

/** Insuffisant et non vérifiable comptent comme disponibles (A10, A6). */
export function countsAsAvailable(state: IngredientState): boolean {
  return state === 'available' || state === 'insufficient' || state === 'unverifiable';
}

/**
 * Indexe le stock par produit et par catégorie. Une catégorie porte aussi le
 * stock de ses descendantes (A3) : l'arbre est remonté une fois par entrée,
 * plutôt que parcouru à chaque ingrédient.
 */
export function buildStockSnapshot(
  entries: readonly StockEntry[],
  parentByCategory: ReadonlyMap<string, string | null>,
): StockSnapshot {
  const byProduct = new Map<string, StockEntry>();
  const byCategory = new Map<string, StockEntry[]>();
  for (const entry of entries) {
    byProduct.set(entry.productId, entry);
    let categoryId = entry.categoryId;
    const seen = new Set<string>();
    while (categoryId && !seen.has(categoryId)) {
      seen.add(categoryId);
      const bucket = byCategory.get(categoryId) ?? [];
      bucket.push(entry);
      byCategory.set(categoryId, bucket);
      categoryId = parentByCategory.get(categoryId) ?? null;
    }
  }
  return { byProduct, byCategory };
}

export function availableInUnit(entry: StockEntry, unit: Unit): number | null {
  if (sameFamily(entry.unit, unit)) return convertQuantity(entry.quantity, entry.unit, unit);
  // Le pont par la contenance ne vaut que depuis une unité de conditionnement :
  // un stock en grammes ne devient jamais un volume.
  const family = UNIT_FAMILY[entry.unit];
  const bridgeable = family !== 'mass' && family !== 'volume';
  if (bridgeable && entry.netContent !== null && entry.netContentUnit !== null && sameFamily(entry.netContentUnit, unit)) {
    return convertQuantity(entry.quantity * entry.netContent, entry.netContentUnit, unit);
  }
  return null;
}

function candidates(ingredient: CoverageIngredient, snapshot: StockSnapshot): readonly StockEntry[] {
  if (ingredient.categoryId) return snapshot.byCategory.get(ingredient.categoryId) ?? [];
  if (!ingredient.productId) return [];
  const direct = snapshot.byProduct.get(ingredient.productId);
  if (!ingredient.substitutable) return direct ? [direct] : [];
  // Substituable : toute la catégorie du produit visé convient.
  const categoryId = direct?.categoryId ?? null;
  if (categoryId) return snapshot.byCategory.get(categoryId) ?? [];
  return direct ? [direct] : [];
}

/** Les quantités à la pièce ne se comparent pas au socle (A6). */
function comparable(unit: Unit): boolean {
  const family = UNIT_FAMILY[unit];
  return family === 'mass' || family === 'volume';
}

export function ingredientOutcome(ingredient: CoverageIngredient, snapshot: StockSnapshot): IngredientOutcome {
  const base = { id: ingredient.id, availableQuantity: null, requiredQuantity: null };
  if (!ingredient.productId && !ingredient.categoryId) return { ...base, state: 'untracked', nearExpiry: false };

  const found = candidates(ingredient, snapshot);
  if (found.length === 0) return { ...base, state: 'missing', nearExpiry: false };
  const nearExpiry = found.some((entry) => entry.nearExpiry);

  if (ingredient.quantity === null || ingredient.unit === null) return { ...base, state: 'available', nearExpiry };
  if (!comparable(ingredient.unit)) return { ...base, state: 'unverifiable', nearExpiry };

  let total = 0;
  let measured = false;
  for (const entry of found) {
    const quantity = availableInUnit(entry, ingredient.unit);
    if (quantity === null) continue;
    measured = true;
    total += quantity;
  }
  if (!measured) return { ...base, state: 'unverifiable', nearExpiry };
  const available = roundQuantity(total);
  return available >= ingredient.quantity
    ? { ...base, state: 'available', nearExpiry }
    : { id: ingredient.id, state: 'insufficient', nearExpiry, availableQuantity: available, requiredQuantity: ingredient.quantity };
}

export function recipeCoverage(ingredients: readonly CoverageIngredient[], snapshot: StockSnapshot): RecipeCoverage {
  const outcomes = ingredients.map((ingredient) => ingredientOutcome(ingredient, snapshot));
  const tracked = ingredients
    .map((ingredient, index) => ({ ingredient, outcome: outcomes[index]! }))
    .filter(({ outcome }) => outcome.state !== 'untracked');

  const missing = tracked.filter(({ outcome }) => !countsAsAvailable(outcome.state));
  const essentialMissing = missing.some(({ ingredient }) => ingredient.essential);
  // Une recette dont rien n'est suivi ne manque de rien (A7).
  const coverage = tracked.length === 0 ? 1 : roundQuantity((tracked.length - missing.length) / tracked.length);

  let group: CoverageGroup;
  if (missing.length === 0) group = 'ready';
  else if (!essentialMissing && missing.length <= 2 && coverage >= ALMOST_COVERAGE_FLOOR) group = 'almost';
  else group = 'excluded';

  const bonus = tracked.filter(({ outcome }) => outcome.nearExpiry && countsAsAvailable(outcome.state)).length;
  return { coverage, group, bonus, missingIds: missing.map(({ outcome }) => outcome.id), outcomes };
}
```

Ajouter `export * from './coverage.js';` à `rules/index.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/rules/coverage --root packages/shared`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rules/coverage.ts packages/shared/src/rules/coverage.test.ts packages/shared/src/rules/index.ts
git commit -m "feat(shared): disponibilité et couverture des recettes (EF-17, EF-23, EF-27)"
```

---

### Task 3: Règle pure — indicateurs d'historique et étiquettes

**Files:**
- Create: `packages/shared/src/rules/recipe-stats.ts`, `recipe-stats.test.ts`
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Consumes: `daysUntil` de `rules/expiry.ts`.
- Produces:
```ts
export const RATING_WINDOW_DAYS = 7;
export const FORGOTTEN_AFTER_DAYS = 60;
export type RecipeTag = 'trusted' | 'disliked' | 'never' | 'forgotten';
export type RecentTrend = 'up' | 'stable' | 'down';
export interface CookedLog { id: string; cookedAt: Date; ratings: readonly { userId: string; stars: number }[] }
export interface RecipeStats {
  timesCooked: number;
  lastCookedAt: Date | null;
  averageRating: number | null;
  ratingCount: number;
  recentTrend: RecentTrend | null;
  tags: RecipeTag[];
}
export function computeRecipeStats(logs: readonly CookedLog[], today: Date, forgottenAfterDays?: number): RecipeStats;
export function canRate(log: { cookedAt: Date }, today: Date): boolean;
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { canRate, computeRecipeStats, type CookedLog } from './recipe-stats.js';

const today = new Date('2026-10-03T12:00:00');
const daysAgo = (n: number): Date => new Date(today.getTime() - n * 86_400_000);
const log = (id: string, n: number, stars: number[] = []): CookedLog => ({
  id, cookedAt: daysAgo(n), ratings: stars.map((s, i) => ({ userId: `u${i}`, stars: s })),
});

describe('computeRecipeStats', () => {
  it('rend une recette jamais faite', () => {
    expect(computeRecipeStats([], today)).toMatchObject({
      timesCooked: 0, lastCookedAt: null, averageRating: null, ratingCount: 0, recentTrend: null, tags: ['never'],
    });
  });
  it('moyenne toutes les notes de toutes les réalisations', () => {
    const stats = computeRecipeStats([log('a', 1, [4, 5]), log('b', 10, [3])], today);
    expect(stats).toMatchObject({ timesCooked: 2, averageRating: 4, ratingCount: 3 });
    expect(stats.lastCookedAt).toEqual(daysAgo(1));
  });
  it('arrondit la moyenne au dixième', () => {
    expect(computeRecipeStats([log('a', 1, [4, 5, 5])], today).averageRating).toBe(4.7);
  });
  it('étiquette valeur sûre au-delà de 4 sur au moins deux notes', () => {
    expect(computeRecipeStats([log('a', 1, [4, 5])], today).tags).toContain('trusted');
    expect(computeRecipeStats([log('a', 1, [5])], today).tags).not.toContain('trusted');
  });
  it('étiquette à oublier sous 2 sur au moins deux notes', () => {
    expect(computeRecipeStats([log('a', 1, [1, 2])], today).tags).toContain('disliked');
  });
  it('étiquette oubliée au-delà de soixante jours, seuil réglable', () => {
    expect(computeRecipeStats([log('a', 61)], today).tags).toContain('forgotten');
    expect(computeRecipeStats([log('a', 59)], today).tags).not.toContain('forgotten');
    expect(computeRecipeStats([log('a', 61)], today, 90).tags).not.toContain('forgotten');
  });
  it('ne calcule la tendance qu’à partir de quatre réalisations notées', () => {
    const three = [log('a', 1, [5]), log('b', 2, [5]), log('c', 3, [5])];
    expect(computeRecipeStats(three, today).recentTrend).toBeNull();
    expect(computeRecipeStats([...three, log('d', 4, [1])], today).recentTrend).toBe('up');
  });
  it('qualifie la tendance par l’écart de 0,5', () => {
    const baisse = [log('a', 1, [2]), log('b', 2, [2]), log('c', 3, [2]), log('d', 4, [5]), log('e', 5, [5])];
    expect(computeRecipeStats(baisse, today).recentTrend).toBe('down');
    const stable = [log('a', 1, [4]), log('b', 2, [4]), log('c', 3, [4]), log('d', 4, [4])];
    expect(computeRecipeStats(stable, today).recentTrend).toBe('stable');
  });
  it('ignore les réalisations sans note dans la tendance', () => {
    const logs = [log('a', 1, [5]), log('b', 2), log('c', 3, [5]), log('d', 4, [5]), log('e', 5, [1])];
    expect(computeRecipeStats(logs, today).recentTrend).toBe('up');
  });
});

describe('canRate', () => {
  it('ouvre la notation pendant sept jours (A25)', () => {
    expect(canRate({ cookedAt: daysAgo(0) }, today)).toBe(true);
    expect(canRate({ cookedAt: daysAgo(7) }, today)).toBe(true);
    expect(canRate({ cookedAt: daysAgo(8) }, today)).toBe(false);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/rules/recipe-stats --root packages/shared`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

```ts
import { daysUntil } from './expiry.js';

/** Fenêtre pendant laquelle une réalisation reste notable (A25). */
export const RATING_WINDOW_DAYS = 7;
/** Au-delà, une recette est « pas faite depuis longtemps ». Réglable par Setting. */
export const FORGOTTEN_AFTER_DAYS = 60;
/** Écart minimal pour qualifier une tendance. */
const TREND_DELTA = 0.5;
/** Nombre de réalisations notées sous lequel la tendance n'a pas de sens. */
const TREND_MIN_LOGS = 4;

export type RecipeTag = 'trusted' | 'disliked' | 'never' | 'forgotten';
export type RecentTrend = 'up' | 'stable' | 'down';

export interface CookedLog {
  id: string;
  cookedAt: Date;
  ratings: readonly { userId: string; stars: number }[];
}

export interface RecipeStats {
  timesCooked: number;
  lastCookedAt: Date | null;
  averageRating: number | null;
  ratingCount: number;
  recentTrend: RecentTrend | null;
  tags: RecipeTag[];
}

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
const round1 = (value: number): number => Math.round(value * 10) / 10;
/** Jours écoulés depuis une date passée. */
const daysSince = (date: Date, today: Date): number => -daysUntil(date, today);

export function computeRecipeStats(
  logs: readonly CookedLog[],
  today: Date,
  forgottenAfterDays = FORGOTTEN_AFTER_DAYS,
): RecipeStats {
  const sorted = [...logs].sort((a, b) => b.cookedAt.getTime() - a.cookedAt.getTime());
  const allStars = sorted.flatMap((log) => log.ratings.map((rating) => rating.stars));
  const averageRating = allStars.length > 0 ? round1(mean(allStars)) : null;

  const rated = sorted.filter((log) => log.ratings.length > 0);
  let recentTrend: RecentTrend | null = null;
  if (rated.length >= TREND_MIN_LOGS && averageRating !== null) {
    const recent = mean(rated.slice(0, 3).flatMap((log) => log.ratings.map((r) => r.stars)));
    const delta = recent - averageRating;
    recentTrend = delta >= TREND_DELTA ? 'up' : delta <= -TREND_DELTA ? 'down' : 'stable';
  }

  const lastCookedAt = sorted[0]?.cookedAt ?? null;
  const tags: RecipeTag[] = [];
  if (averageRating !== null && allStars.length >= 2 && averageRating >= 4) tags.push('trusted');
  if (averageRating !== null && allStars.length >= 2 && averageRating <= 2) tags.push('disliked');
  if (lastCookedAt === null) tags.push('never');
  else if (daysSince(lastCookedAt, today) > forgottenAfterDays) tags.push('forgotten');

  return { timesCooked: sorted.length, lastCookedAt, averageRating, ratingCount: allStars.length, recentTrend, tags };
}

export function canRate(log: { cookedAt: Date }, today: Date): boolean {
  return daysSince(log.cookedAt, today) <= RATING_WINDOW_DAYS;
}
```

Ajouter `export * from './recipe-stats.js';` à `rules/index.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/rules/recipe-stats --root packages/shared`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rules/recipe-stats.ts packages/shared/src/rules/recipe-stats.test.ts packages/shared/src/rules/index.ts
git commit -m "feat(shared): indicateurs d'historique et étiquettes de recette (EF-28)"
```

---

### Task 4: Règle pure — les cinq tris

**Files:**
- Create: `packages/shared/src/rules/recipe-sort.ts`, `recipe-sort.test.ts`
- Modify: `packages/shared/src/rules/index.ts`

**Interfaces:**
- Produces:
```ts
export const RECIPE_SORTS = ['rating', 'coverage', 'antiWaste', 'mostCooked', 'leastRecent'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];
export const RECIPE_SORT_LABELS_FR: Record<RecipeSort, string>;
export interface SortableRecipe {
  title: string;
  coverage: number;
  bonus: number;
  averageRating: number | null;
  ratingCount: number;
  timesCooked: number;
  lastCookedAt: Date | null;
}
export function sortRecipes<T extends SortableRecipe>(recipes: readonly T[], sort: RecipeSort): T[];
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { sortRecipes, type SortableRecipe } from './recipe-sort.js';

const r = (title: string, over: Partial<SortableRecipe> = {}): SortableRecipe => ({
  title, coverage: 0.5, bonus: 0, averageRating: null, ratingCount: 0, timesCooked: 0, lastCookedAt: null, ...over,
});
const titles = (list: SortableRecipe[]): string[] => list.map((x) => x.title);

describe('sortRecipes', () => {
  it('par note : notées d’abord, moyenne puis nombre d’avis, puis titre', () => {
    const list = [
      r('Jamais notée'),
      r('Bonne sur un avis', { averageRating: 5, ratingCount: 1 }),
      r('Bonne sur dix avis', { averageRating: 5, ratingCount: 10 }),
      r('Moyenne', { averageRating: 3, ratingCount: 4 }),
    ];
    expect(titles(sortRecipes(list, 'rating'))).toEqual(['Bonne sur dix avis', 'Bonne sur un avis', 'Moyenne', 'Jamais notée']);
  });
  it('départage par le titre, accents compris', () => {
    expect(titles(sortRecipes([r('Éclair'), r('Dessert')], 'rating'))).toEqual(['Dessert', 'Éclair']);
  });
  it('par couverture, puis note, puis titre', () => {
    const list = [r('A', { coverage: 0.5 }), r('B', { coverage: 1 }), r('C', { coverage: 1, averageRating: 5, ratingCount: 1 })];
    expect(titles(sortRecipes(list, 'coverage'))).toEqual(['C', 'B', 'A']);
  });
  it('par anti-gaspillage, puis couverture, puis titre', () => {
    const list = [r('A', { bonus: 0, coverage: 1 }), r('B', { bonus: 2 }), r('C', { bonus: 2, coverage: 0.9 })];
    expect(titles(sortRecipes(list, 'antiWaste'))).toEqual(['C', 'B', 'A']);
  });
  it('par nombre de réalisations', () => {
    expect(titles(sortRecipes([r('A'), r('B', { timesCooked: 3 })], 'mostCooked'))).toEqual(['B', 'A']);
  });
  it('par ancienneté, jamais faites en premier', () => {
    const list = [
      r('Hier', { lastCookedAt: new Date('2026-10-02') }),
      r('Jamais'),
      r('L’an dernier', { lastCookedAt: new Date('2025-10-02') }),
    ];
    expect(titles(sortRecipes(list, 'leastRecent'))).toEqual(['Jamais', 'L’an dernier', 'Hier']);
  });
  it('est stable : deux égales gardent leur ordre d’entrée', () => {
    const list = [r('Même'), r('Même')];
    expect(sortRecipes(list, 'rating')[0]).toBe(list[0]);
  });
  it('ne modifie pas le tableau reçu', () => {
    const list = [r('B'), r('A')];
    sortRecipes(list, 'rating');
    expect(titles(list)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/rules/recipe-sort --root packages/shared`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

```ts
export const RECIPE_SORTS = ['rating', 'coverage', 'antiWaste', 'mostCooked', 'leastRecent'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

export const RECIPE_SORT_LABELS_FR: Record<RecipeSort, string> = {
  rating: 'Les mieux notées',
  coverage: 'Réalisables avec le stock',
  antiWaste: 'Anti-gaspillage',
  mostCooked: 'Les plus faites',
  leastRecent: 'Les moins récentes',
};

export interface SortableRecipe {
  title: string;
  coverage: number;
  bonus: number;
  averageRating: number | null;
  ratingCount: number;
  timesCooked: number;
  lastCookedAt: Date | null;
}

const byTitle = (a: SortableRecipe, b: SortableRecipe): number => a.title.localeCompare(b.title, 'fr');

/** Note : les recettes notées passent devant, puis la moyenne, puis le nombre d'avis. */
const byRating = (a: SortableRecipe, b: SortableRecipe): number =>
  Number(b.averageRating !== null) - Number(a.averageRating !== null) ||
  (b.averageRating ?? 0) - (a.averageRating ?? 0) ||
  b.ratingCount - a.ratingCount ||
  byTitle(a, b);

const COMPARATORS: Record<RecipeSort, (a: SortableRecipe, b: SortableRecipe) => number> = {
  rating: byRating,
  coverage: (a, b) => b.coverage - a.coverage || byRating(a, b),
  antiWaste: (a, b) => b.bonus - a.bonus || b.coverage - a.coverage || byTitle(a, b),
  mostCooked: (a, b) => b.timesCooked - a.timesCooked || byTitle(a, b),
  // Jamais faites en premier : une date absente vaut le passé le plus lointain.
  leastRecent: (a, b) => (a.lastCookedAt?.getTime() ?? -1) - (b.lastCookedAt?.getTime() ?? -1) || byTitle(a, b),
};

export function sortRecipes<T extends SortableRecipe>(recipes: readonly T[], sort: RecipeSort): T[] {
  // Copie avant tri : `Array.sort` modifie en place, et il est stable depuis ES2019.
  return [...recipes].sort(COMPARATORS[sort]);
}
```

Ajouter `export * from './recipe-sort.js';` à `rules/index.ts`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/rules/recipe-sort --root packages/shared && npx vitest run --coverage --root packages/shared`
Expected: PASS, couverture des règles toujours au-dessus de 80 %.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rules/recipe-sort.ts packages/shared/src/rules/recipe-sort.test.ts packages/shared/src/rules/index.ts
git commit -m "feat(shared): les cinq tris de la liste de recettes (EF-23, EF-27, EF-28)"
```

---

### Task 5: Schémas Zod, énumérations et DTO

**Files:**
- Create: `packages/shared/src/schemas/recipes.ts`, `recipes.test.ts`
- Modify: `packages/shared/src/schemas/index.ts`

**Interfaces:**
- Consumes: `RECIPE_SORTS` (tâche 4), `clientOpIdSchema`, `idSchema`, `paginationQuerySchema`, `positiveQuantitySchema`, `unitSchema`.
- Produces: `DISH_TYPES`, `DIETS`, `RECIPE_TAGS`, les schémas d'entrée, et les types `RecipeDto`, `RecipeSummaryDto`, `RecipeIngredientDto`, `RecipeLogDto`, `RecipeStatsDto`, `CookResult`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { cookRecipeSchema, createRecipeSchema, rateLogSchema, recipeListQuerySchema } from './recipes.js';

const valid = { title: 'Ramen', servings: 2, steps: ['Bouillir'], ingredients: [{ label: 'Nouilles', productId: 'p1', quantity: 200, unit: 'GRAM' }] };

describe('createRecipeSchema', () => {
  it('applique les défauts, dont essentiel à faux (A1, A2)', () => {
    const parsed = createRecipeSchema.parse(valid);
    expect(parsed.ingredients[0]).toMatchObject({ essential: false, substitutable: false });
    expect(parsed.diets).toEqual([]);
  });
  it('exige un titre et au moins une étape', () => {
    expect(createRecipeSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false);
  });
  it('refuse une quantité nulle, et une quantité sans unité', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', quantity: 0, unit: 'GRAM' }] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', quantity: 200 }] }).success).toBe(false);
  });
  it('refuse un ingrédient visant à la fois un produit et une catégorie', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', productId: 'p', categoryId: 'c' }] }).success).toBe(false);
  });
  it('n’accepte qu’un type de plat et plusieurs régimes (A4, A5)', () => {
    expect(createRecipeSchema.parse({ ...valid, dishType: 'MAIN', diets: ['VEGAN', 'GLUTEN_FREE'] }).dishType).toBe('MAIN');
    expect(createRecipeSchema.safeParse({ ...valid, dishType: ['MAIN'] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, diets: ['INCONNU'] }).success).toBe(false);
  });
});

describe('recipeListQuerySchema', () => {
  it('accepte un filtre unique ou répété, et convertit les nombres', () => {
    expect(recipeListQuerySchema.parse({ difficulty: ['EASY', 'HARD'], maxTime: '30', page: '2' })).toMatchObject({
      difficulty: ['EASY', 'HARD'], maxTime: 30, page: 2, sort: 'rating', archived: false,
    });
    expect(recipeListQuerySchema.parse({ cuisine: 'c1' }).cuisine).toEqual(['c1']);
  });
  it('refuse un tri inconnu', () => {
    expect(recipeListQuerySchema.safeParse({ sort: 'aleatoire' }).success).toBe(false);
  });
});

describe('cookRecipeSchema et rateLogSchema', () => {
  it('exige des portions positives et accepte le produit choisi par ligne (A15)', () => {
    expect(cookRecipeSchema.safeParse({ servingsCooked: 0, lines: [] }).success).toBe(false);
    expect(cookRecipeSchema.parse({ servingsCooked: 4, lines: [{ ingredientId: 'i1', productId: 'p2' }] }).lines[0]).toMatchObject({
      ingredientId: 'i1', productId: 'p2',
    });
  });
  it('borne la note entre 1 et 5', () => {
    expect(rateLogSchema.safeParse({ stars: 6 }).success).toBe(false);
    expect(rateLogSchema.safeParse({ stars: 0 }).success).toBe(false);
    expect(rateLogSchema.parse({ stars: 4 }).comment).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/schemas/recipes --root packages/shared`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Implémenter**

```ts
import { z } from 'zod';
import { RECIPE_SORTS } from '../rules/recipe-sort.js';
import { clientOpIdSchema, idSchema, paginationQuerySchema, positiveQuantitySchema, unitSchema } from './common.js';

export const difficultySchema = z.enum(['VERY_EASY', 'EASY', 'INTERMEDIATE', 'HARD']);

/** Type de plat : une seule valeur par recette (A4). */
export const DISH_TYPES = ['STARTER', 'MAIN', 'DESSERT', 'SIDE', 'APERITIF', 'BREAKFAST', 'DRINK'] as const;
export const dishTypeSchema = z.enum(DISH_TYPES);

/** Régimes : plusieurs par recette, liste étendue par migration (A5). */
export const DIETS = ['VEGETARIAN', 'VEGAN', 'GLUTEN_FREE', 'LACTOSE_FREE', 'PORK_FREE'] as const;
export const dietSchema = z.enum(DIETS);

export const RECIPE_TAGS = ['trusted', 'disliked', 'never', 'forgotten'] as const;
export const recipeTagSchema = z.enum(RECIPE_TAGS);
export const recipeSortSchema = z.enum(RECIPE_SORTS);
export const coverageGroupSchema = z.enum(['ready', 'almost', 'excluded']);

export const DIFFICULTY_LABELS_FR: Record<z.infer<typeof difficultySchema>, string> = {
  VERY_EASY: 'Très facile', EASY: 'Facile', INTERMEDIATE: 'Intermédiaire', HARD: 'Difficile',
};
export const DISH_TYPE_LABELS_FR: Record<(typeof DISH_TYPES)[number], string> = {
  STARTER: 'Entrée', MAIN: 'Plat', DESSERT: 'Dessert', SIDE: 'Accompagnement',
  APERITIF: 'Apéritif', BREAKFAST: 'Petit-déjeuner', DRINK: 'Boisson',
};
export const DIET_LABELS_FR: Record<(typeof DIETS)[number], string> = {
  VEGETARIAN: 'Végétarien', VEGAN: 'Végétalien', GLUTEN_FREE: 'Sans gluten',
  LACTOSE_FREE: 'Sans lactose', PORK_FREE: 'Sans porc',
};
export const RECIPE_TAG_LABELS_FR: Record<(typeof RECIPE_TAGS)[number], string> = {
  trusted: 'Valeur sûre', disliked: 'À oublier', never: 'Jamais faite', forgotten: 'Pas faite depuis longtemps',
};
export const COVERAGE_GROUP_LABELS_FR: Record<z.infer<typeof coverageGroupSchema>, string> = {
  ready: 'Prête', almost: 'Presque', excluded: 'Incomplète',
};

export const recipeIngredientInputSchema = z
  .object({
    label: z.string().trim().min(1, { message: 'Libellé requis' }).max(160),
    productId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    quantity: positiveQuantitySchema.nullable().optional(),
    unit: unitSchema.nullable().optional(),
    // Décochées par défaut (A1, A2) : l'utilisateur déclare ce qui est vraiment indispensable.
    essential: z.boolean().default(false),
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
  restMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  activeTime: z.number().int().min(0).max(1440).nullable().optional(),
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
  tag: repeatable(recipeTagSchema).optional(),
  group: repeatable(coverageGroupSchema).optional(),
  maxTime: z.coerce.number().int().min(1).max(1440).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  coverageMin: z.coerce.number().min(0).max(1).optional(),
  archived: z.coerce.boolean().default(false),
  sort: recipeSortSchema.default('rating'),
});
export type RecipeListQuery = z.infer<typeof recipeListQuerySchema>;

export const recipeFiltersSchema = recipeListQuerySchema.pick({
  difficulty: true, cuisine: true, dishType: true, diet: true, tag: true, group: true,
  maxTime: true, minRating: true, archived: true, sort: true,
});
export type RecipeFilters = z.infer<typeof recipeFiltersSchema>;

export const cookRecipeSchema = z.object({
  servingsCooked: z.number().int().min(1).max(50),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().trim().max(500).nullable().optional(),
  /** Seules les lignes présentes sont décrémentées : décocher, c'est omettre (A17). */
  lines: z
    .array(
      z.object({
        ingredientId: idSchema,
        /** Produit retenu pour un ingrédient substituable ou visant une catégorie (A15). */
        productId: idSchema.optional(),
        /** Quantité de base de la recette, jamais mise à l'échelle par le client (A14). */
        quantity: positiveQuantitySchema.optional(),
      }),
    )
    .max(60),
  clientOpId: clientOpIdSchema.optional(),
});
export type CookRecipeInput = z.infer<typeof cookRecipeSchema>;

/** Réalisation sans décrément : « J'ai fait cette recette » (A26). */
export const logCookedSchema = z.object({
  servingsCooked: z.number().int().min(1).max(50),
  cookedAt: z.string().datetime().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().trim().max(500).nullable().optional(),
});
export type LogCookedInput = z.infer<typeof logCookedSchema>;

export const rateLogSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).nullable().default(null),
});
export type RateLogInput = z.infer<typeof rateLogSchema>;

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
  state: 'available' | 'insufficient' | 'unverifiable' | 'missing' | 'untracked';
  availableQuantity: number | null;
  nearExpiry: boolean;
  /**
   * Produits en stock qui peuvent satisfaire cette ligne, pour le choix exigé
   * par A15 à la cuisson. Vide pour une ligne visant un produit précis non
   * substituable. Trié par date effective la plus proche d'abord, ce qui donne
   * la présélection du tiroir.
   */
  candidates: { productId: string; name: string; nearestExpiry: string | null }[];
}

export interface RecipeStatsDto {
  timesCooked: number;
  lastCookedAt: string | null;
  averageRating: number | null;
  ratingCount: number;
  recentTrend: 'up' | 'stable' | 'down' | null;
  tags: (typeof RECIPE_TAGS)[number][];
}

export interface RecipeSummaryDto {
  id: string;
  title: string;
  difficulty: z.infer<typeof difficultySchema>;
  cuisineName: string | null;
  dishType: (typeof DISH_TYPES)[number] | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  servings: number;
  diets: (typeof DIETS)[number][];
  imagePath: string | null;
  archivedAt: string | null;
  coverage: number;
  group: z.infer<typeof coverageGroupSchema>;
  bonus: number;
  missingLabels: string[];
  stats: RecipeStatsDto;
}

export interface RecipeRatingDto {
  userId: string;
  userName: string;
  stars: number;
  comment: string | null;
  updatedAt: string;
}

export interface RecipeLogDto {
  id: string;
  cookedAt: string;
  servingsCooked: number;
  stockApplied: boolean;
  cookedByName: string | null;
  canRate: boolean;
  ratings: RecipeRatingDto[];
}

export interface RecipeDto extends RecipeSummaryDto {
  cuisineId: string | null;
  restMinutes: number | null;
  activeTime: number | null;
  steps: string[];
  difficultyOverride: boolean;
  source: 'HOUSEHOLD' | 'IMPORTED' | 'GENERATED';
  sourceUrl: string | null;
  createdAt: string;
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

### Task 6: Migration — toutes les évolutions de schéma du socle

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0003_recipes_socle/migration.sql`
- Modify: `apps/api/test/db.test.ts`

**Interfaces:**
- Produces: `UserPreference`, `RecipeRating`, `Recipe.activeTime`, `Recipe.restMinutes`, `Recipe.archivedAt`, `Cuisine.normalizedName`, `RecipeLog.clientOpId`, `RecipeIngredient.essential` par défaut faux, énumérations `DishType` et `Diet` revues, index `RecipeIngredient.categoryId`.

**Note sur `restMinutes`.** La fiche affiche « préparation, actif, cuisson, repos » et A13 exclut explicitement le repos du filtre de temps : le champ est donc nécessaire et absent du schéma. Il est ajouté ici.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('porte le schéma du module recettes', async () => {
  const columns = async (table: string) =>
    (await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`).map((c) => c.column_name).sort();

  expect(await columns('UserPreference')).toEqual(['key', 'updatedAt', 'userId', 'value']);
  expect(await columns('RecipeRating')).toEqual(['comment', 'createdAt', 'id', 'recipeLogId', 'stars', 'updatedAt', 'userId']);
  expect(await columns('Recipe')).toEqual(expect.arrayContaining(['activeTime', 'restMinutes', 'archivedAt']));
  expect(await columns('Recipe')).not.toContain('rating');
  expect(await columns('Cuisine')).toContain('normalizedName');
  expect(await columns('RecipeLog')).toContain('clientOpId');
  expect(await columns('RecipeLog')).not.toContain('rating');

  const [essential] = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
    SELECT column_default FROM information_schema.columns WHERE table_name = 'RecipeIngredient' AND column_name = 'essential'`;
  expect(essential?.column_default).toBe('false');

  const dishTypes = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'DishType'`;
  expect(dishTypes.map((d) => d.enumlabel).sort()).toEqual(['APERITIF', 'BREAKFAST', 'DESSERT', 'DRINK', 'MAIN', 'SIDE', 'STARTER']);

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'RecipeIngredient'`;
  expect(indexes.map((i) => i.indexname)).toContain('RecipeIngredient_categoryId_idx');
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run test/db --root apps/api`
Expected: FAIL, tables absentes.

- [ ] **Step 3: Modifier le schéma, puis écrire la migration**

Dans `prisma/schema.prisma` :

```prisma
// Réglages propres à un utilisateur, là où « Setting » vaut pour l'instance.
// Les filtres et le tri des recettes sont « mémorisés par utilisateur »
// (section 12 du cahier), chacun ayant ses habitudes.
model UserPreference {
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  key       String
  value     Json
  updatedAt DateTime @updatedAt

  @@id([userId, key])
}

// Une note par membre et par réalisation (A24) : la moyenne d'une recette
// agrège les avis de tout le foyer, au lieu d'une note unique écrasée.
model RecipeRating {
  id          String    @id @default(cuid())
  recipeLogId String
  recipeLog   RecipeLog @relation(fields: [recipeLogId], references: [id], onDelete: Cascade)
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  stars       Int
  comment     String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([recipeLogId, userId])
  @@index([recipeLogId])
}

enum DishType {
  STARTER
  MAIN
  DESSERT
  SIDE
  APERITIF
  BREAKFAST
  DRINK
}

enum Diet {
  VEGETARIAN
  VEGAN
  GLUTEN_FREE
  LACTOSE_FREE
  PORK_FREE
}
```

Sur `Recipe` : ajouter `activeTime Int?`, `restMinutes Int?`, `archivedAt DateTime?`, passer `diets` à `Diet[]`, retirer `rating Int?`, ajouter `@@index([archivedAt])`.
Sur `RecipeIngredient` : `essential Boolean @default(false)` et `@@index([categoryId])`.
Sur `RecipeLog` : ajouter `clientOpId String? @unique` et `ratings RecipeRating[]`, retirer `rating Int?`.
Sur `Cuisine` : ajouter `normalizedName String @unique`.
Sur `User` : ajouter `preferences UserPreference[]` et `recipeRatings RecipeRating[]`.

Générer la migration, puis **compléter à la main** la reprise des données, que `migrate diff` ne devine pas. Ces instructions se placent **avant** la suppression des colonnes dans le fichier SQL.

```sql
-- Reprise des notes existantes vers RecipeRating, attribuées à l'auteur de la
-- réalisation, avant la suppression des colonnes. Sans utilisateur rattaché,
-- la note est perdue : elle n'appartiendrait à personne.
INSERT INTO "RecipeRating" ("id", "recipeLogId", "userId", "stars", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, l."id", l."userId", l."rating", l."cookedAt", l."cookedAt"
FROM "RecipeLog" l
WHERE l."rating" IS NOT NULL AND l."userId" IS NOT NULL;

-- Nom normalisé des cuisines : minuscules et sans accent (A22).
UPDATE "Cuisine" SET "normalizedName" = unaccent_lite("name");

-- SAUCE disparaît du type de plat : les recettes concernées deviennent SIDE.
UPDATE "Recipe" SET "dishType" = 'SIDE' WHERE "dishType" = 'SAUCE';
```

`unaccent_lite` est la fonction posée par la migration `0002`, déjà en minuscules.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run test/db --root apps/api`
Expected: PASS. Vérifier l'absence de dérive : `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL_SHADOW" --exit-code` sort en 0.

- [ ] **Step 5: Commit**

```bash
git add prisma apps/api/test/db.test.ts
git commit -m "feat(prisma): schéma du module recettes, notation par membre et archivage (EF-28)"
```

---

### Task 7: API — cuisines et préférences

**Files:**
- Create: `apps/api/src/cuisines/cuisines.controller.ts`, `cuisines.module.ts`, `cuisines.e2e-spec.ts`
- Create: `apps/api/src/preferences/preferences.controller.ts`, `preferences.service.ts`, `preferences.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/bootstrap/bootstrap.service.ts`

**Interfaces:**
- Produces: `GET`/`POST /cuisines`, `GET`/`PUT /preferences/recipe-filters` ; `PreferencesService.get(userId, key)` et `.set(userId, key, value)`, constante `RECIPE_FILTERS_KEY`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('expose les douze cuisines semées, triées par nom', async () => {
  const res = await agent.get('/api/v1/cuisines').expect(200);
  expect(res.body).toHaveLength(12);
  expect(res.body[0].name).toBe('Autre');
});

it('refuse un doublon de cuisine à la casse et aux accents près (A22)', async () => {
  await agent.post('/api/v1/cuisines').send({ name: 'Créole' }).expect(201);
  const dup = await agent.post('/api/v1/cuisines').send({ name: 'creole' }).expect(409);
  expect(dup.body.error.code).toBe('conflict');
});

it('mémorise filtres et tri par utilisateur, chacun les siens', async () => {
  expect((await agent.get('/api/v1/preferences/recipe-filters').expect(200)).body).toEqual({});
  await agent.put('/api/v1/preferences/recipe-filters').send({ difficulty: ['EASY'], sort: 'antiWaste' }).expect(200);
  expect((await agent.get('/api/v1/preferences/recipe-filters').expect(200)).body).toMatchObject({ difficulty: ['EASY'], sort: 'antiWaste' });

  await agent.post('/api/v1/users').send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201);
  const marie = t.agent();
  await marie.post('/api/v1/auth/login').send({ email: 'marie@example.org', password: 'encore-un-mot-de-passe' }).expect(204);
  expect((await marie.get('/api/v1/preferences/recipe-filters').expect(200)).body).toEqual({});
});

it('refuse un filtre ou un tri inconnu', async () => {
  await agent.put('/api/v1/preferences/recipe-filters').send({ difficulty: ['IMPOSSIBLE'] }).expect(400);
  await agent.put('/api/v1/preferences/recipe-filters').send({ sort: 'aleatoire' }).expect(400);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/cuisines --root apps/api`
Expected: FAIL, 404.

- [ ] **Step 3: Implémenter**

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export const RECIPE_FILTERS_KEY = 'recipeFilters';

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

`cuisines.controller.ts` : `GET` trie par `name` ; `POST` calcule le nom normalisé avec `normalizeProductName` du paquet partagé et renvoie `ApiError.conflict('Cette cuisine existe déjà')` si la clé est prise. Le `bootstrap.service.ts` renseigne `normalizedName` sur les cuisines semées.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/cuisines --root apps/api`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cuisines apps/api/src/preferences apps/api/src/app.module.ts apps/api/src/bootstrap
git commit -m "feat(recipes): cuisines sans doublon et filtres mémorisés par utilisateur (EF-22)"
```

---

### Task 8: API — création, lecture, modification, archivage

**Files:**
- Create: `apps/api/src/recipes/recipes.service.ts`, `recipe.mapper.ts`, `recipes.controller.ts`, `recipes.module.ts`, `recipes.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `computeDifficulty` (tâche 1), schémas (tâche 5).
- Produces:
```ts
export class RecipesService {
  create(input: CreateRecipeInput, userId: string | null): Promise<RecipeDto>;
  get(id: string): Promise<RecipeDto>;
  update(id: string, input: UpdateRecipeInput): Promise<RecipeDto>;
  remove(id: string): Promise<void>;
  archive(id: string): Promise<RecipeDto>;
  restore(id: string): Promise<RecipeDto>;
}
export function parseSteps(value: unknown): string[];
export function totalMinutes(recipe: { prepMinutes: number | null; cookMinutes: number | null }): number | null;
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('crée une recette, calcule sa difficulté et la renvoie complète', async () => {
  const res = await agent.post('/api/v1/recipes').send({
    title: 'Ramen maison', servings: 2, prepMinutes: 30, cookMinutes: 15, restMinutes: 120,
    steps: ['Faire revenir le porc', 'Déglacer', 'Pocher les œufs', 'Monter le bol', 'Servir'],
    dishType: 'MAIN', diets: ['PORK_FREE'],
    ingredients: [{ label: 'Nouilles', productId: nouillesId, quantity: 200, unit: 'GRAM', essential: true }],
  }).expect(201);
  expect(res.body).toMatchObject({ title: 'Ramen maison', difficulty: 'INTERMEDIATE', difficultyOverride: false, source: 'HOUSEHOLD', dishType: 'MAIN' });
  expect(res.body.totalMinutes).toBe(45); // le repos ne compte pas (A13)
  expect(res.body.stats).toMatchObject({ timesCooked: 0, averageRating: null, tags: ['never'] });
});

it('respecte une difficulté corrigée et cesse de la recalculer', async () => {
  const created = await agent.post('/api/v1/recipes').send({ title: 'Salade', steps: ['Mélanger'], difficulty: 'HARD' }).expect(201);
  expect(created.body).toMatchObject({ difficulty: 'HARD', difficultyOverride: true });
  const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).expect(200);
  expect(updated.body.difficulty).toBe('HARD');
});

it('recalcule la difficulté tant qu’elle n’a pas été corrigée', async () => {
  const created = await agent.post('/api/v1/recipes').send({ title: 'Salade', steps: ['Mélanger'] }).expect(201);
  expect(created.body.difficulty).toBe('VERY_EASY');
  const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ activeTime: 60, steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).expect(200);
  expect(updated.body.difficulty).toBe('HARD');
});

it('refuse un produit, une catégorie ou une cuisine inconnus', async () => {
  await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], cuisineId: 'inconnu' }).expect(404);
  await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], ingredients: [{ label: 'y', productId: 'inconnu' }] }).expect(404);
});

it('remplace les ingrédients sans laisser d’orphelin', async () => {
  const created = await createRecipe('X', [{ label: 'un' }, { label: 'deux' }]);
  const updated = await agent.patch(`/api/v1/recipes/${created.id}`).send({ ingredients: [{ label: 'trois' }] }).expect(200);
  expect(updated.body.ingredients.map((i: { label: string }) => i.label)).toEqual(['trois']);
  expect(await t.prisma.recipeIngredient.count()).toBe(1);
});

it('lit une recette dont les étapes sont corrompues sans échouer', async () => {
  const created = await createRecipe('X', []);
  await t.prisma.recipe.update({ where: { id: created.id }, data: { steps: { bloc: 'texte libre' } } });
  expect((await agent.get(`/api/v1/recipes/${created.id}`).expect(200)).body.steps).toEqual([]);
});

it('supprime une recette jamais réalisée, refuse après une réalisation (A20)', async () => {
  const jamais = await createRecipe('Jamais faite', []);
  await agent.delete(`/api/v1/recipes/${jamais.id}`).expect(204);

  const faite = await createRecipe('Déjà faite', []);
  await logCooked(faite.id);
  const refus = await agent.delete(`/api/v1/recipes/${faite.id}`).expect(409);
  expect(refus.body.error.details).toMatchObject({ timesCooked: 1 });
});

it('archive, retire des listes, puis restaure', async () => {
  const recipe = await createRecipe('Archivable', []);
  await agent.post(`/api/v1/recipes/${recipe.id}/archive`).expect(200);
  expect((await agent.get('/api/v1/recipes').expect(200)).body.items).toHaveLength(0);
  expect((await agent.get('/api/v1/recipes?archived=true').expect(200)).body.items).toHaveLength(1);
  await agent.post(`/api/v1/recipes/${recipe.id}/restore`).expect(200);
  expect((await agent.get('/api/v1/recipes').expect(200)).body.items).toHaveLength(1);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, 404 sur `/api/v1/recipes`.

- [ ] **Step 3: Implémenter**

`recipe.mapper.ts` :

```ts
/** `steps` est un Json : une donnée héritée ou corrompue ne doit pas casser la fiche. */
export function parseSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
}

/** Temps affiché et filtré : préparation et cuisson, jamais le repos (A13). */
export function totalMinutes(recipe: { prepMinutes: number | null; cookMinutes: number | null }): number | null {
  if (recipe.prepMinutes === null && recipe.cookMinutes === null) return null;
  return (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
}
```

`recipes.service.ts` : `create` calcule la difficulté par `computeDifficulty({ steps, activeTime, prepMinutes })`, sauf si `input.difficulty` est fourni, auquel cas `difficultyOverride` passe à vrai. `update` ne recalcule que si le drapeau est faux. Les ingrédients sont remplacés en bloc dans une transaction. L'existence de la cuisine, des produits et des catégories est vérifiée avant écriture. `remove` compte les `RecipeLog` et refuse au-delà de zéro. `archive` et `restore` posent ou effacent `archivedAt`.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes apps/api/src/app.module.ts
git commit -m "feat(recipes): saisie, modification et archivage des recettes (EF-17, EF-21)"
```

---

### Task 9: API — liste, instantané de stock, indicateurs et tri

**Files:**
- Create: `apps/api/src/recipes/recipes.coverage.ts`, `recipes.stats.ts`
- Modify: `apps/api/src/recipes/recipes.service.ts`, `recipes.controller.ts`, `recipes.e2e-spec.ts`

**Interfaces:**
- Consumes: `buildStockSnapshot`, `recipeCoverage`, `computeRecipeStats`, `sortRecipes`, `expiryStatus`, `excludedFromRecipes`, `SettingsService`.
- Produces:
```ts
export class RecipesCoverageService { snapshot(): Promise<StockSnapshot> }
export class RecipesStatsService { forRecipes(recipeIds: readonly string[], today: Date): Promise<Map<string, RecipeStats>> }
```

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('trie par note par défaut, sans que le stock intervienne (A27)', async () => {
  const bonne = await createRecipe('Bien notée', [{ productId: absentId, quantity: 100, unit: 'GRAM' }]);
  await createRecipe('Jamais notée', [{ productId: rizId, quantity: 100, unit: 'GRAM' }]);
  const log = await logCooked(bonne.id);
  await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);

  const res = await agent.get('/api/v1/recipes').expect(200);
  expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Bien notée', 'Jamais notée']);
  expect(res.body.items[0]).toMatchObject({ group: 'excluded', stats: { averageRating: 5 } });
});

it('affiche le groupe et les manquants sur chaque carte', async () => {
  await createStock(rizId, 1000, 'GRAM');
  await createRecipe('Riz à la crème', [
    { productId: rizId, quantity: 100, unit: 'GRAM' },
    { productId: cremeId, quantity: 20, unit: 'MILLILITER', label: 'Crème fraîche' },
  ]);
  expect((await agent.get('/api/v1/recipes').expect(200)).body.items[0]).toMatchObject({
    group: 'almost', missingLabels: ['Crème fraîche'],
  });
});

it('exclut du calcul un lot dont la DLC est dépassée', async () => {
  await createStock(cremeId, 500, 'MILLILITER', { expiryDate: isoIn(-2), dateType: 'USE_BY' });
  await createRecipe('Gratin', [{ productId: cremeId, quantity: 200, unit: 'MILLILITER' }]);
  expect((await agent.get('/api/v1/recipes').expect(200)).body.items[0].group).toBe('excluded');
});

it('suit la fusion de produits', async () => {
  const recipe = await createRecipe('Soja', [{ productId: ancienId, quantity: 10, unit: 'MILLILITER' }]);
  await agent.post(`/api/v1/products/${ancienId}/merge`).send({ targetId: cibleId }).expect(200);
  await createStock(cibleId, 500, 'MILLILITER');
  expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.group).toBe('ready');
});

it('applique les filtres, le temps sans le repos, et le tri demandé', async () => {
  const rapides = await agent.get('/api/v1/recipes?maxTime=20').expect(200);
  expect(rapides.body.items.every((r: { totalMinutes: number | null }) => (r.totalMinutes ?? 0) <= 20)).toBe(true);
  const faciles = await agent.get('/api/v1/recipes?difficulty=VERY_EASY').expect(200);
  expect(faciles.body.items.every((r: { difficulty: string }) => r.difficulty === 'VERY_EASY')).toBe(true);
  await agent.get('/api/v1/recipes?sort=antiWaste').expect(200);
});

it('exclut d’un filtre de régime les recettes qui ne le déclarent pas', async () => {
  await createRecipe('Steak', [], { diets: [] });
  await createRecipe('Dahl', [], { diets: ['VEGETARIAN'] });
  const res = await agent.get('/api/v1/recipes?diet=VEGETARIAN').expect(200);
  expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Dahl']);
});

it('filtre sur une étiquette calculée', async () => {
  const sure = await createRecipe('Valeur sûre', []);
  await createRecipe('Jamais faite', []);
  const log = await logCooked(sure.id);
  // Deux notes d'au moins 4 : l'étiquette « valeur sûre » demande deux avis.
  await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
  const marie = await createMember('marie@example.org');
  await marie.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 4 }).expect(200);

  expect((await agent.get('/api/v1/recipes?tag=trusted').expect(200)).body.items.map((r: { title: string }) => r.title)).toEqual(['Valeur sûre']);
  expect((await agent.get('/api/v1/recipes?tag=never').expect(200)).body.items.map((r: { title: string }) => r.title)).toEqual(['Jamais faite']);
});

it('filtre sur une note minimale', async () => {
  const res = await agent.get('/api/v1/recipes?minRating=4.5').expect(200);
  expect(res.body.items.every((r: { stats: { averageRating: number | null } }) => (r.stats.averageRating ?? 0) >= 4.5)).toBe(true);
});

it('pagine après le tri, jamais avant (A18)', async () => {
  for (const [titre, stars] of [['A', 2], ['B', 4], ['C', 5]] as const) {
    const recipe = await createRecipe(titre, []);
    const log = await logCooked(recipe.id);
    await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars }).expect(200);
  }
  const page1 = await agent.get('/api/v1/recipes?limit=2&page=1').expect(200);
  const page2 = await agent.get('/api/v1/recipes?limit=2&page=2').expect(200);
  expect(page1.body.items.map((r: { title: string }) => r.title)).toEqual(['C', 'B']);
  expect(page2.body.items.map((r: { title: string }) => r.title)).toEqual(['A']);
  expect(page2.body.total).toBe(3);
});

it('répond sous deux secondes pour 300 recettes et 1 500 lots', async () => {
  await seedLoad(300, 1500);
  const started = Date.now();
  await agent.get('/api/v1/recipes?limit=50').expect(200);
  expect(Date.now() - started).toBeLessThan(2000);
});
```

Avec l'aide de charge, à écrire dans le fichier de test :

```ts
/** Sème des volumes réalistes en passant par Prisma, pour rester rapide. */
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
            label: `ingrédient ${k}`, productId: products[(n + k) % products.length]!.id,
            quantity: 100, unit: 'GRAM', essential: k < 2,
          })),
        },
      },
    });
  }
}
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, ni `group` ni `stats` dans la réponse.

- [ ] **Step 3: Implémenter**

`recipes.coverage.ts` charge les lots un par un (A19) et applique la règle pure d'exclusion :

```ts
const [lots, categories, alertDays] = await Promise.all([
  this.prisma.stockItem.findMany({
    where: { archivedAt: null, quantity: { gt: 0 } },
    select: {
      quantity: true, unit: true, effectiveExpiry: true, dateType: true, dateEstimated: true,
      product: { select: { id: true, categoryId: true, defaultUnit: true, netContent: true, netContentUnit: true, mergedIntoId: true } },
    },
  }),
  this.prisma.category.findMany({ select: { id: true, parentId: true } }),
  this.settings.expiryAlertDays(),
]);
```

Pour chaque lot : suivre `mergedIntoId` jusqu'au produit cible, calculer `expiryStatus`, écarter si `excludedFromRecipes`, convertir la quantité dans l'unité par défaut du produit, additionner par produit, et poser `nearExpiry` quand le statut vaut `soon` ou `expired_best_before`. L'arbre des catégories alimente `buildStockSnapshot`.

`recipes.stats.ts` charge les réalisations et leurs notes en une requête, puis appelle `computeRecipeStats` par recette, avec le seuil d'oubli lu dans `Setting`.

Dans `recipes.service.ts`, la liste enchaîne : prédicats SQL (`difficulty`, `cuisineId`, `dishType`, `diets` avec `hasEvery`, `archivedAt`), décoration par couverture et indicateurs, filtres calculés (`group`, `tag`, `coverageMin`, `minRating`, `maxTime`, `q`), tri par `sortRecipes`, puis découpe de la page. **Jamais de `skip`/`take` Prisma ici** (A18).

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api`
Expected: PASS, test de charge compris.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes
git commit -m "feat(recipes): liste triée, couverture et indicateurs d'historique (EF-17, EF-23, EF-27)"
```

---

### Task 10: API — cuisson et décrément

**Files:**
- Create: `apps/api/src/recipes/recipes.cook.ts`
- Modify: `apps/api/src/recipes/recipes.controller.ts`, `recipes.e2e-spec.ts`

**Interfaces:**
- Consumes: `applyMovement` de `stock/stock.quantity.ts`, `capConsumption`, `convertQuantity`, `cookRecipeSchema`.
- Produces: `POST /recipes/{id}/cook` renvoyant `CookResult`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('met à l’échelle une seule fois, côté serveur (A14)', async () => {
  await createStock(rizId, 1000, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
  const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 2, lines: [{ ingredientId: recipe.ingredients[0].id }], stars: 4 }).expect(200);
  expect(res.body.lines[0]).toMatchObject({ requested: 100, applied: 100, capped: false });
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(900);
  const log = await t.prisma.recipeLog.findUniqueOrThrow({ where: { id: res.body.logId }, include: { ratings: true } });
  expect(log).toMatchObject({ servingsCooked: 2, stockApplied: true });
  expect(log.ratings[0]).toMatchObject({ stars: 4 });
});

it('n’émet aucun mouvement pour une ligne décochée, sans quantité, ou hors inventaire (A17)', async () => {
  await createStock(rizId, 1000, 'GRAM');
  const recipe = await createRecipe('Riz', [
    { productId: rizId, quantity: 200, unit: 'GRAM' },
    { productId: rizId, label: 'Riz à l’œil' },
    { label: 'Sel' },
  ]);
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: recipe.ingredients.slice(1).map((i: { id: string }) => ({ ingredientId: i.id })) }).expect(200);
  expect(await t.prisma.stockMovement.count({ where: { type: 'RECIPE' } })).toBe(0);
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1000);
});

it('décrémente en fraction de paquet, sans arrondi (A16)', async () => {
  const paquets = await createProduct('Pâtes', 'PACK');
  await t.prisma.product.update({ where: { id: paquets }, data: { netContent: 500, netContentUnit: 'GRAM' } });
  await createStock(paquets, 2, 'PACK');
  const recipe = await createRecipe('Pâtes', [{ productId: paquets, quantity: 200, unit: 'GRAM' }], { servings: 4 });
  const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }] }).expect(200);
  expect(res.body.lines[0]).toMatchObject({ applied: 0.4, unit: 'PACK' });
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1.6);
});

it('plafonne au stock disponible et le signale', async () => {
  await createStock(rizId, 150, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 2 });
  const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }] }).expect(200);
  expect(res.body.lines[0]).toMatchObject({ requested: 400, applied: 150, capped: true });
  expect(res.body.message).toContain('ramenée');
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(0);
});

it('plafonne la seconde ligne quand deux lignes visent le même produit (A9)', async () => {
  await createStock(rizId, 300, 'GRAM');
  const recipe = await createRecipe('Riz deux fois', [
    { productId: rizId, quantity: 200, unit: 'GRAM' },
    { productId: rizId, quantity: 200, unit: 'GRAM' },
  ], { servings: 4 });
  // Les deux lignes paraissaient disponibles : elles sont évaluées séparément.
  expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.group).toBe('ready');
  const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: recipe.ingredients.map((i: { id: string }) => ({ ingredientId: i.id })) }).expect(200);
  expect(res.body.lines.map((l: { applied: number; capped: boolean }) => [l.applied, l.capped])).toEqual([[200, false], [100, true]]);
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(0);
});

it('prend d’abord les lots dont la date est la plus proche', async () => {
  const proche = await createStock(rizId, 300, 'GRAM', { expiryDate: isoIn(3), dateType: 'USE_BY' });
  const loin = await createStock(rizId, 300, 'GRAM', { expiryDate: isoIn(90), dateType: 'USE_BY' });
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }] }).expect(200);
  expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: proche } })).quantity.toNumber()).toBe(100);
  expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: loin } })).quantity.toNumber()).toBe(300);
});

it('décrémente le produit choisi pour une ligne substituable (A15)', async () => {
  const autre = await createProduct('Riz rond', 'GRAM', epicerieId);
  await createStock(autre, 500, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM', substitutable: true }], { servings: 4 });
  await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id, productId: autre }] }).expect(200);
  expect((await t.prisma.stockItem.findFirstOrThrow({ where: { productId: autre } })).quantity.toNumber()).toBe(300);
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
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, 404 sur la route de cuisson.

- [ ] **Step 3: Implémenter**

`recipes.cook.ts`, en une transaction. Si un `RecipeLog` porte déjà le `clientOpId`, la réponse précédente est renvoyée sans rien réécrire. Sinon, créer le `RecipeLog` avec `stockApplied` à vrai, puis pour chaque ligne retenue, dans l'ordre d'envoi :

1. Ignorer les lignes sans quantité et les lignes hors inventaire (A17).
2. `requested = roundQuantity(quantity * servingsCooked / recipe.servings)` — unique mise à l'échelle (A14).
3. Produit retenu : celui de la ligne, sinon celui de l'ingrédient.
4. Lots du produit triés par `effectiveExpiry` croissante, les sans-date en dernier.
5. Pour chaque lot, convertir le besoin restant dans l'unité du lot, pont par la contenance compris, sans arrondi au-delà de deux décimales (A16), appliquer `capConsumption`, puis `applyMovement` de type `RECIPE` avec `recipeLogId` et un `clientOpId` suffixé par l'identifiant d'ingrédient et l'indice de lot.
6. Marquer `capped` quand le besoin n'a pas pu être entièrement servi.

Le `RecipeRating` de l'utilisateur est créé si `stars` est fourni.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api && npx vitest run --root apps/api`
Expected: PASS, suite complète verte.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes
git commit -m "feat(recipes): cuisson avec décrément au prorata des portions (EF-18)"
```

---

### Task 11: API — réalisations et notation

**Files:**
- Create: `apps/api/src/recipes/recipe-logs.controller.ts`
- Modify: `apps/api/src/recipes/recipes.module.ts`, `recipes.e2e-spec.ts`

**Interfaces:**
- Consumes: `canRate` (tâche 3), `logCookedSchema`, `rateLogSchema`.
- Produces: `GET`/`POST /recipes/{id}/logs`, `PUT /recipe-logs/{id}/rating`, `DELETE /recipe-logs/{id}`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('enregistre une réalisation sans toucher au stock (A26)', async () => {
  await createStock(rizId, 1000, 'GRAM');
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }]);
  const log = await logCooked(recipe.id, { stars: 5 });
  expect(log).toMatchObject({ stockApplied: false, servingsCooked: 4 });
  expect(await t.prisma.stockMovement.count({ where: { type: 'RECIPE' } })).toBe(0);
  expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1000);
});

it('accepte une note par membre et moyenne les avis (A24)', async () => {
  const recipe = await createRecipe('Dahl', []);
  const log = await logCooked(recipe.id);
  await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5, comment: 'Parfait' }).expect(200);

  await agent.post('/api/v1/users').send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201);
  const marie = t.agent();
  await marie.post('/api/v1/auth/login').send({ email: 'marie@example.org', password: 'encore-un-mot-de-passe' }).expect(204);
  await marie.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 3 }).expect(200);

  expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats).toMatchObject({ averageRating: 4, ratingCount: 2 });
  expect((await agent.get(`/api/v1/recipes/${recipe.id}/logs`).expect(200)).body.items[0].ratings).toHaveLength(2);
});

it('remplace sa propre note sans en créer une seconde', async () => {
  const recipe = await createRecipe('Dahl', []);
  const log = await logCooked(recipe.id);
  await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 2 }).expect(200);
  await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
  expect(await t.prisma.recipeRating.count()).toBe(1);
  expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats.averageRating).toBe(5);
});

it('ferme la notation après sept jours (A25)', async () => {
  const recipe = await createRecipe('Dahl', []);
  const log = await logCooked(recipe.id);
  await t.prisma.recipeLog.update({ where: { id: log.id }, data: { cookedAt: new Date(Date.now() - 8 * 86_400_000) } });
  const res = await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(409);
  expect(res.body.error.code).toBe('conflict');
  expect((await agent.get(`/api/v1/recipes/${recipe.id}/logs`).expect(200)).body.items[0].canRate).toBe(false);
});

it('supprime une réalisation sans décrément, refuse celles qui en ont un', async () => {
  const recipe = await createRecipe('Riz', [{ productId: rizId, quantity: 200, unit: 'GRAM' }]);
  const sans = await logCooked(recipe.id);
  await agent.delete(`/api/v1/recipe-logs/${sans.id}`).expect(204);

  await createStock(rizId, 1000, 'GRAM');
  const avec = await agent.post(`/api/v1/recipes/${recipe.id}/cook`)
    .send({ servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0].id }] }).expect(200);
  const refus = await agent.delete(`/api/v1/recipe-logs/${avec.body.logId}`).expect(409);
  expect(refus.body.error.message).toContain('correction');
});

it('la suppression d’un compte emporte ses notes sans fausser la moyenne', async () => {
  const recipe = await createRecipe('Dahl', []);
  const log = await logCooked(recipe.id);
  await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
  const marieId = (await agent.post('/api/v1/users')
    .send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201)).body.id;
  await t.prisma.recipeRating.create({ data: { recipeLogId: log.id, userId: marieId, stars: 1 } });
  expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats.averageRating).toBe(3);

  await t.prisma.user.delete({ where: { id: marieId } });
  expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats).toMatchObject({ averageRating: 5, ratingCount: 1 });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run src/recipes --root apps/api`
Expected: FAIL, 404 sur les routes de réalisation.

- [ ] **Step 3: Implémenter**

`recipe-logs.controller.ts` : `POST /recipes/{id}/logs` crée un `RecipeLog` avec `stockApplied` à faux et la note éventuelle. `GET /recipes/{id}/logs` pagine l'historique, notes comprises, et calcule `canRate` par `canRate(log, new Date())` pour l'utilisateur courant. `PUT /recipe-logs/{id}/rating` refuse hors fenêtre avec `ApiError.conflict('La notation est close après sept jours')`, sinon fait un `upsert` sur la clé `(recipeLogId, userId)`. `DELETE /recipe-logs/{id}` refuse quand `stockApplied` est vrai, avec un message qui renvoie vers la correction manuelle du stock depuis la fiche article.

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run src/recipes --root apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/recipes
git commit -m "feat(recipes): historique des réalisations et notation par membre (EF-28)"
```

---

### Task 12: Scénario de réussite figé

**Files:**
- Create: `apps/api/src/recipes/recipes.scenario.e2e-spec.ts`

Le critère de réussite du socle est un scénario écrit d'avance (A23), indépendant de la semence de développement.

- [ ] **Step 1: Écrire le scénario**

```ts
/**
 * Scénario de réussite du socle (A23). Stock et recettes figés, résultat
 * attendu écrit recette par recette. Ce test échoue si une règle de couverture,
 * de groupe ou de tri change sans décision explicite.
 *
 * Stock : riz 1 kg · nouilles 2 paquets de 500 g · sauce soja 500 ml qui périme
 * dans 3 jours · tofu 400 g · crème absente.
 * Recettes : « Ramen » (nouilles, soja, tofu) · « Riz sauté » (riz, soja) ·
 * « Salade » (aucun ingrédient suivi) · « Gratin » (crème essentielle, riz).
 */
describe('scénario de réussite du socle', () => {
  /** Sème exactement le stock et les recettes décrits ci-dessus, et renvoie les recettes par titre. */
  async function seedScenario(): Promise<Map<string, { id: string }>> {
    const riz = await createProduct('Riz basmati', 'GRAM');
    const nouilles = await createProduct('Nouilles', 'PACK');
    await t.prisma.product.update({ where: { id: nouilles }, data: { netContent: 500, netContentUnit: 'GRAM' } });
    const soja = await createProduct('Sauce soja', 'MILLILITER');
    const tofu = await createProduct('Tofu', 'GRAM');
    const creme = await createProduct('Crème fraîche', 'MILLILITER');

    await createStock(riz, 1000, 'GRAM');
    await createStock(nouilles, 2, 'PACK');
    await createStock(soja, 500, 'MILLILITER', { expiryDate: isoIn(3), dateType: 'USE_BY' });
    await createStock(tofu, 400, 'GRAM');

    const recipes = new Map<string, { id: string }>();
    recipes.set('Ramen', await createRecipe('Ramen', [
      { label: 'Nouilles', productId: nouilles, quantity: 200, unit: 'GRAM' },
      { label: 'Sauce soja', productId: soja, quantity: 20, unit: 'MILLILITER' },
      { label: 'Tofu', productId: tofu, quantity: 200, unit: 'GRAM' },
    ]));
    recipes.set('Riz sauté', await createRecipe('Riz sauté', [
      { label: 'Riz', productId: riz, quantity: 150, unit: 'GRAM' },
      { label: 'Sauce soja', productId: soja, quantity: 10, unit: 'MILLILITER' },
    ]));
    recipes.set('Salade', await createRecipe('Salade', [{ label: 'Sel' }, { label: 'Huile' }]));
    recipes.set('Gratin', await createRecipe('Gratin', [
      { label: 'Crème fraîche', productId: creme, quantity: 200, unit: 'MILLILITER', essential: true },
      { label: 'Riz', productId: riz, quantity: 100, unit: 'GRAM' },
    ]));
    return recipes;
  }

  let recipes: Map<string, { id: string }>;
  beforeEach(async () => {
    recipes = await seedScenario();
  });

  it('rend le classement attendu, recette par recette', async () => {
    const expected = [
      { title: 'Ramen', group: 'ready', coverage: 1, bonus: 1, missingLabels: [] },
      { title: 'Riz sauté', group: 'ready', coverage: 1, bonus: 1, missingLabels: [] },
      { title: 'Salade', group: 'ready', coverage: 1, bonus: 0, missingLabels: [] },
      { title: 'Gratin', group: 'excluded', coverage: 0.5, bonus: 0, missingLabels: ['Crème fraîche'] },
    ];
    const res = await agent.get('/api/v1/recipes?sort=antiWaste').expect(200);
    expect(
      res.body.items.map((r: Record<string, unknown>) => ({
        title: r.title, group: r.group, coverage: r.coverage, bonus: r.bonus, missingLabels: r.missingLabels,
      })),
    ).toEqual(expected);
    // Recette du lot 2 : au moins trois recettes réalisables.
    expect(res.body.items.filter((r: { group: string }) => r.group === 'ready')).toHaveLength(3);
  });

  it('bascule le classement sur la note sans changer les groupes', async () => {
    const gratin = recipes.get('Gratin')!;
    const log = await logCooked(gratin.id);
    await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
    const res = await agent.get('/api/v1/recipes').expect(200);
    expect(res.body.items[0]).toMatchObject({ title: 'Gratin', group: 'excluded' });
  });
});
```


- [ ] **Step 2: Vérifier**

Run: `npx vitest run src/recipes/recipes.scenario --root apps/api`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/recipes/recipes.scenario.e2e-spec.ts
git commit -m "test(recipes): scénario de réussite figé du socle (A23)"
```

---

### Task 13: Semence de développement

**Files:**
- Modify: `prisma/seed/dev.ts`

- [ ] **Step 1: Écrire les recettes**

Huit recettes rattachées aux produits déjà semés, couvrant les quatre difficultés et cinq cuisines, dont deux visant une catégorie, une avec un ingrédient substituable, et une volontairement incomplète. Quatre portent un historique de réalisations avec les notes de deux membres, à des dates relatives : hier, il y a 10 jours, et il y a 70 jours pour faire apparaître l'étiquette « pas faite depuis longtemps ».

- [ ] **Step 2: Vérifier**

Run: `npm run seed:dev -w @kitchen/api`, puis `GET /api/v1/recipes` et vérifier qu'au moins trois recettes sont en `ready` et que les étiquettes `trusted`, `never` et `forgotten` apparaissent.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed/dev.ts
git commit -m "test(recipes): huit recettes et leur historique dans le jeu de développement"
```

---

### Task 14: Front — écran Recettes, filtres et tri

**Files:**
- Create: `apps/web/src/screens/recipes/recipes-screen.tsx`, `recipe-filters.tsx`, `recipe-card.tsx`, `recipe-filters.test.tsx`
- Create: `apps/web/src/lib/recipes-api.ts`
- Modify: `apps/web/src/lib/queries.ts`, `apps/web/src/app.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecipeFiltersBar } from './recipe-filters';

const empty = { difficulty: [], cuisine: [], dishType: [], diet: [], tag: [], group: [], archived: false, sort: 'rating' as const };

describe('RecipeFiltersBar', () => {
  it('ajoute une difficulté sans toucher aux autres filtres', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Facile' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, difficulty: ['EASY'] });
  });
  it('change le tri', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Trier par'), { target: { value: 'antiWaste' } });
    expect(onChange).toHaveBeenCalledWith({ ...empty, sort: 'antiWaste' });
  });
  it('traduit les pastilles rapides en filtres', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={empty} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Valeurs sûres' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, tag: ['trusted'] });
    fireEvent.click(screen.getByRole('button', { name: 'Réalisables maintenant' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, group: ['ready'] });
  });
  it('compte les filtres actifs sans compter le tri', () => {
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], maxTime: 30, sort: 'coverage' }} cuisines={[]} onChange={vi.fn()} />);
    expect(screen.getByText('2 filtres')).toBeTruthy();
  });
  it('remet les filtres à zéro en gardant le tri', () => {
    const onChange = vi.fn();
    render(<RecipeFiltersBar value={{ ...empty, difficulty: ['EASY'], sort: 'coverage' }} cuisines={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(onChange).toHaveBeenCalledWith({ ...empty, sort: 'coverage' });
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

La liste reprend la pagination de l'écran Stock. Chaque carte porte le titre, la pastille de groupe et le taux, la cuisine, le temps, la difficulté, la ligne d'historique « Faite 7 fois · il y a 12 jours · ★ 4,3 » ou « Jamais faite », la pastille anti-gaspillage quand le bonus est positif, et la mention des manquants. Les filtres sont chargés depuis les préférences au montage et enregistrés à chaque changement, avec un délai pour ne pas écrire à chaque frappe.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipes apps/web/src/lib apps/web/src/app.tsx
git commit -m "feat(web): écran Recettes, filtres et tris persistants (EF-21, EF-22, EF-23)"
```

---

### Task 15: Front — rappel de notation

**Files:**
- Create: `apps/web/src/screens/recipes/rating-reminder.tsx`, `rating-reminder.test.tsx`
- Modify: `apps/web/src/screens/recipes/recipes-screen.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RatingReminderView } from './rating-reminder';

const pending = { logId: 'l1', recipeId: 'r1', recipeTitle: 'Gratin', cookedAt: new Date().toISOString() };

describe('RatingReminderView', () => {
  afterEach(() => localStorage.clear());

  it('invite à noter la réalisation récente', () => {
    render(<RatingReminderView pending={pending} onRate={vi.fn()} />);
    expect(screen.getByText(/Notez le gratin/i)).toBeTruthy();
  });
  it('ne s’affiche pas sans réalisation en attente', () => {
    const { container } = render(<RatingReminderView pending={null} onRate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it('se ferme et ne revient pas le même jour', () => {
    const { rerender, container } = render(<RatingReminderView pending={pending} onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Masquer' }));
    rerender(<RatingReminderView pending={pending} onRate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it('ouvre la notation au clic', () => {
    const onRate = vi.fn();
    render(<RatingReminderView pending={pending} onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: /Noter/ }));
    expect(onRate).toHaveBeenCalledWith('l1');
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

La réalisation en attente vient d'une requête sur les réalisations récentes sans note de l'utilisateur. Le masquage est mémorisé pour la journée dans `localStorage`, avec la gestion d'erreur habituelle du projet.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipes
git commit -m "feat(web): rappel de notation des réalisations récentes (EF-28)"
```

---

### Task 16: Front — fiche recette et historique

**Files:**
- Create: `apps/web/src/screens/recipe/recipe-screen.tsx`, `ingredient-row.tsx`, `history-panel.tsx`, `ingredient-row.test.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IngredientRow } from './ingredient-row';

const base = {
  id: 'i1', label: 'Riz', productId: 'p1', productName: 'Riz basmati', categoryId: null, categoryName: null,
  quantity: 200, unit: 'GRAM' as const, essential: false, substitutable: false, availableQuantity: null, nearExpiry: false,
};

describe('IngredientRow', () => {
  it('montre une quantité insuffisante avec le détail', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'insufficient', availableQuantity: 100 }} />);
    expect(screen.getByText(/100 g sur 200 g/)).toBeTruthy();
  });
  it('explique une quantité non vérifiable', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'unverifiable' }} />);
    expect(screen.getByText(/non vérifiable/i)).toBeTruthy();
  });
  it('grise un ingrédient hors inventaire', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'untracked', productId: null, productName: null }} />);
    expect(screen.getByText(/hors inventaire/i)).toBeTruthy();
  });
  it('marque les essentiels et les manquants', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'missing', essential: true }} />);
    expect(screen.getByText('Manquant')).toBeTruthy();
    expect(screen.getByLabelText('Ingrédient essentiel')).toBeTruthy();
  });
  it('signale un ingrédient qui périme bientôt', () => {
    render(<IngredientRow ingredient={{ ...base, state: 'available', nearExpiry: true }} />);
    expect(screen.getByText(/périme bientôt/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

La fiche affiche les ingrédients, les étapes numérotées, la difficulté et sa correction, les quatre temps, les portions, puis le bloc Historique : moyenne, nombre de réalisations, tendance, et la liste des réalisations avec leurs notes. La note de l'utilisateur reste modifiable tant que `canRate` est vrai. Les actions sont cuisiner, « J'ai fait cette recette », modifier, supprimer ou archiver selon l'historique, restaurer si archivée. Le refus de suppression renvoie vers la correction manuelle du stock.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipe apps/web/src/app.tsx
git commit -m "feat(web): fiche recette, états des ingrédients et historique (EF-23, EF-28)"
```

---

### Task 17: Front — tiroir de cuisson

**Files:**
- Create: `apps/web/src/screens/recipe/cook-sheet.tsx`, `cook-sheet.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CookSheetView } from './cook-sheet';

const recipe = {
  id: 'r1', title: 'Riz', servings: 4,
  ingredients: [
    { id: 'i1', label: 'Riz', quantity: 200, unit: 'GRAM', state: 'available', substitutable: false, candidates: [] },
    { id: 'i2', label: 'Sel', quantity: null, unit: null, state: 'untracked', substitutable: false, candidates: [] },
    { id: 'i3', label: 'Huile', quantity: 10, unit: 'MILLILITER', state: 'available', substitutable: true,
      candidates: [{ productId: 'p9', name: 'Huile d’olive', nearestExpiry: '2026-10-10' }, { productId: 'p8', name: 'Huile de tournesol', nearestExpiry: null }] },
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
    expect(onConfirm.mock.calls[0][0].lines).toEqual([{ ingredientId: 'i3', productId: 'p9' }]);
  });
  it('ne propose pas de décrémenter un ingrédient hors inventaire', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('checkbox', { name: /Sel/ })).toBeNull();
  });
  it('présélectionne le produit qui périme le plus tôt (A15)', () => {
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByLabelText('Produit pour Huile') as HTMLSelectElement).value).toBe('p9');
  });
  it('envoie la note quand elle est donnée, et rien sinon', () => {
    const onConfirm = vi.fn();
    render(<CookSheetView recipe={recipe} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm.mock.calls[0][0].stars).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '4 étoiles' }));
    fireEvent.click(screen.getByRole('button', { name: /Cuisiner/ }));
    expect(onConfirm.mock.calls[1][0].stars).toBe(4);
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

Le tiroir reprend l'esprit de la validation du scan. Il envoie les quantités de base, jamais mises à l'échelle (A14), le produit retenu pour les lignes substituables, et la note facultative avec la mention des sept jours.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipe
git commit -m "feat(web): tiroir de cuisson avec choix du produit et note (EF-18, EF-28)"
```

---

### Task 18: Front — formulaire de recette

**Files:**
- Create: `apps/web/src/screens/recipe-form/recipe-form-screen.tsx`, `ingredient-editor.tsx`, `recipe-form.test.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DifficultyField } from './recipe-form-screen';

describe('DifficultyField', () => {
  it('suit le calcul tant que l’utilisateur n’a rien corrigé', () => {
    const { rerender } = render(<DifficultyField steps={['a']} activeTime={5} value={null} onChange={vi.fn()} />);
    expect(screen.getByText('Très facile')).toBeTruthy();
    rerender(<DifficultyField steps={['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']} activeTime={90} value={null} onChange={vi.fn()} />);
    expect(screen.getByText('Difficile')).toBeTruthy();
  });
  it('cesse de bouger dès qu’elle est corrigée', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DifficultyField steps={['a']} activeTime={5} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Intermédiaire' }));
    expect(onChange).toHaveBeenCalledWith('INTERMEDIATE');
    rerender(<DifficultyField steps={['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']} activeTime={90} value="INTERMEDIATE" onChange={onChange} />);
    expect(screen.getByText('Intermédiaire')).toBeTruthy();
  });
});
```

- [ ] **Step 2 à 4: Échec, implémentation, succès**

Les ingrédients se rattachent par la recherche de produits existante, ou restent en texte libre. Chaque ligne porte quantité, unité, et les cases « essentiel » et « substituable », décochées par défaut. Le formulaire comporte le type de plat, les régimes, les quatre temps et les portions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/recipe-form apps/web/src/app.tsx
git commit -m "feat(web): saisie et modification d'une recette (EF-17)"
```

---

### Task 19: Documentation et publication

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/decisions/2026-09-20-choix-implementation-lot-1.md`

- [ ] **Step 1: Mettre à jour le README**

Décrire le module en français dans les fonctionnalités : suggestions classées par note, filtres et tris, couverture du stock affichée sur chaque carte, historique et notation par membre, cuisson avec décrément, archivage. Mentionner la limite connue, l'absence d'ajout aux courses. Ajouter la ligne de version dans « Derniers changements ».

- [ ] **Step 2: Consigner les décisions**

Renvoyer, depuis `docs/decisions/`, vers la spécification et ses 27 arbitrages plutôt que de les recopier. Noter la remontée de EF-25 et EF-26 au périmètre du lot 2 à la demande de Franck, et l'amendement du cahier du 2026-10-03.

- [ ] **Step 3: Mettre à jour CLAUDE.md**

Déplacer le module recettes de « prochaine étape » vers « ce qui est déjà fait », en listant ce qui reste du lot 2 : seuils et liste de courses, alertes de péremption, mode hors ligne.

- [ ] **Step 4: Vérification complète**

```bash
npm run build -w @kitchen/shared && npm run lint && npm run typecheck --workspaces --if-present && npm test --workspaces --if-present && npm run build -w @kitchen/web
```

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs
git commit -m "docs: module recettes dans le README et décisions associées"
```
