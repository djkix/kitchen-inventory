# Recettes suggérées à partir du stock — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes
> sont des cases à cocher.

**But :** faire du stock le point de départ du module recettes — Gemini cherche sur le web et
compose, l'application catégorise, Franck oriente et conserve.

**Architecture :** une sélection d'ingrédients composée par une règle pure, un fournisseur de
suggestion derrière une interface (comme le fournisseur de vision), un service qui valide, rapproche
du stock et met en cache, et deux écrans — Suggestions en entrée, Mes recettes en second. Le socle
livré en 0.7.0 est réutilisé sans réécriture : couverture, cuisson, historique, notation.

**Pile :** TypeScript strict de bout en bout. NestJS 12 + Prisma 6 + PostgreSQL 16 (`pg_trgm`,
`unaccent_lite()`), React 19 + Vite + Tailwind 4 + TanStack Query 5, Zod 4, Vitest 4.

**Spécification :** `docs/specs/2026-10-04-recettes-suggerees.md` (révision 2, arbitrages **[B1]** à
**[B17]**). Cahier amendé le 2026-10-04 : section 12, EF-25 et EF-26 en `Must`, EF-27 retirée.

## Contraintes globales

- Les règles métier vivent dans `packages/shared`, en fonctions pures testées. Jamais recopiées dans
  un contrôleur ou un composant.
- Validation par Zod, schémas définis une seule fois dans `packages/shared`. **Toute réponse du
  modèle est validée avant usage [B17]**, au même titre qu'une saisie utilisateur.
- Enveloppe d'erreur `{error: {code, message, details?}}`, codes stables, messages en français.
- Anglais pour les identifiants, français pour les libellés d'interface et les commentaires.
- TypeScript strict, `noUncheckedIndexedAccess`, `any` interdit hors tests.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- **Aucun test ne dépend du réseau :** réponses de Gemini et pages web rejouées depuis des fixtures.
- `StockItem.quantity` est matérialisée : une consommation insère un mouvement puis recalcule.
- Chaque écriture porte un `clientOpId` pour l'idempotence.
- Mobile d'abord : cibles tactiles à `--spacing-touch`, lisible à une main.
- `README.md` et la ligne de changelog sont mis à jour en tâche 15, pas à chaque tâche interne.

## Points de vigilance

Cinq cas que la spécification implique, qu'aucune tâche n'exerce spontanément, et qui mordront :

1. **`responseSchema` et la recherche Google s'excluent dans l'API Gemini.** L'appel ancré sur le web
   ne peut pas contraindre sa sortie par un schéma : le JSON est demandé dans le prompt, extrait du
   texte (clôtures ``` comprises) et validé par Zod, avec **une** reprise sur JSON invalide. L'appel
   de composition, lui, utilise `responseSchema`. Tâches 5 et 6.
2. **Un libellé vide, ou une URL non HTTPS, ou un domaine en IP privée** dans la réponse du modèle.
   Le rapprochement et la récupération de page doivent les écarter sans planter. Tâches 2 et 9.
3. **Un stock qui ne donne pas huit ingrédients** — placard vide, ou tout exclu par les règles.
   L'écran doit le dire au lieu d'appeler le modèle avec une liste vide. Tâches 1 et 10.
4. **La rotation déterministe au passage de minuit.** Deux ouvertures le même jour donnent la même
   sélection ; le lendemain elle change. Le test doit figer la date, jamais lire l'horloge. Tâche 1.
5. **Une page dont le `schema.org/Recipe` existe mais est un tableau, ou imbriqué dans `@graph`.**
   C'est la forme la plus répandue après la forme simple. Tâche 9.

## Structure des fichiers

```
packages/shared/src/rules/seed-selection.ts        sélection du point de départ (pure)
packages/shared/src/rules/ingredient-match.ts      classement d'un rapprochement (pure)
packages/shared/src/schemas/suggestions.ts         schémas Zod et DTO des suggestions
apps/api/src/suggestions/suggestion-provider.ts    interface du fournisseur
apps/api/src/suggestions/gemini-suggestion.provider.ts
apps/api/src/suggestions/recipe-page.fetcher.ts    récupération + schema.org
apps/api/src/suggestions/suggestions.service.ts    composition, cache, rapprochement
apps/api/src/suggestions/suggestions.controller.ts
apps/api/src/suggestions/suggestions.module.ts
apps/api/test/fixtures/suggestions/               réponses Gemini et pages web
apps/web/src/screens/suggestions/                 écran Suggestions
```

---

### Task 1: Règle pure — sélection du point de départ

**Files:**
- Create: `packages/shared/src/rules/seed-selection.ts`, `seed-selection.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces :
```ts
export interface SeedCandidate {
  productId: string;
  name: string;
  /** Chemin de catégorie, de la racine à la feuille, en minuscules sans accent. */
  categoryPath: readonly string[];
}
export const NON_STRUCTURING_CATEGORIES: readonly string[];
export const SEED_MAX = 8;
export const SEED_STABLE = 5;
export function isStructuring(candidate: SeedCandidate): boolean;
export function pickSeedIngredients(candidates: readonly SeedCandidate[], today: Date): SeedCandidate[];
```

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
import { describe, expect, it } from 'vitest';
import { pickSeedIngredients, isStructuring, SEED_MAX, type SeedCandidate } from './seed-selection.js';

const c = (name: string, ...categoryPath: string[]): SeedCandidate => ({ productId: name, name, categoryPath });
const many = (n: number): SeedCandidate[] => Array.from({ length: n }, (_, i) => c(`produit ${i}`, 'feculents'));
const JOUR = new Date('2026-10-04T12:00:00Z');
const LENDEMAIN = new Date('2026-10-05T08:00:00Z');

describe('isStructuring', () => {
  it('écarte les épices, le sel et le poivre (B5)', () => {
    expect(isStructuring(c('Paprika fumé', 'epicerie', 'epices'))).toBe(false);
    expect(isStructuring(c('Sel fin', 'epicerie', 'sel-et-poivre'))).toBe(false);
  });
  it('garde l’huile et le vinaigre, qui font des plats (B5)', () => {
    expect(isStructuring(c('Huile d’olive', 'epicerie', 'huiles-et-vinaigres'))).toBe(true);
  });
  it('garde un aliment sans catégorie plutôt que de l’écarter au hasard', () => {
    expect(isStructuring(c('Reste de poulet'))).toBe(true);
  });
});

describe('pickSeedIngredients', () => {
  it('ne dépasse jamais huit ingrédients (B3)', () => {
    expect(pickSeedIngredients(many(30), JOUR)).toHaveLength(SEED_MAX);
  });
  it('rend tout ce qu’il y a quand le stock est maigre', () => {
    expect(pickSeedIngredients(many(3), JOUR)).toHaveLength(3);
  });
  it('rend une liste vide plutôt que d’inventer, quand tout est exclu', () => {
    expect(pickSeedIngredients([c('Sel', 'epicerie', 'sel-et-poivre')], JOUR)).toEqual([]);
  });
  it('garde les cinq premières places stables d’un jour à l’autre (B4)', () => {
    const stock = many(20);
    const jour = pickSeedIngredients(stock, JOUR).slice(0, 5).map((s) => s.productId);
    const lendemain = pickSeedIngredients(stock, LENDEMAIN).slice(0, 5).map((s) => s.productId);
    expect(lendemain).toEqual(jour);
  });
  it('fait tourner les trois dernières places (B4)', () => {
    const stock = many(20);
    const jour = pickSeedIngredients(stock, JOUR).slice(5).map((s) => s.productId);
    const lendemain = pickSeedIngredients(stock, LENDEMAIN).slice(5).map((s) => s.productId);
    expect(lendemain).not.toEqual(jour);
  });
  it('rend deux fois la même chose le même jour, à heure différente', () => {
    const stock = many(20);
    const matin = pickSeedIngredients(stock, new Date('2026-10-04T07:00:00Z'));
    const soir = pickSeedIngredients(stock, new Date('2026-10-04T21:00:00Z'));
    expect(soir).toEqual(matin);
  });
  it('ne répète jamais un produit entre les places stables et les tournantes', () => {
    const ids = pickSeedIngredients(many(9), JOUR).map((s) => s.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `npx vitest run src/rules/seed-selection --root packages/shared`
Attendu : FAIL, module introuvable.

- [ ] **Step 3 : implémenter**

```ts
/** Catégories qui n'ont jamais à décrire un repas (B5). Comparées sur le chemin normalisé. */
export const NON_STRUCTURING_CATEGORIES: readonly string[] = ['epices', 'sel-et-poivre', 'herbes-aromatiques'];

export const SEED_MAX = 8;
export const SEED_STABLE = 5;

export function isStructuring(candidate: SeedCandidate): boolean {
  return !candidate.categoryPath.some((segment) => NON_STRUCTURING_CATEGORIES.includes(segment));
}

/** Numéro du jour, pour que la rotation ne dépende pas de l'heure. */
function dayIndex(today: Date): number {
  return Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000);
}

/**
 * Cinq places stables, trois tournantes (B4) : les suggestions se renouvellent
 * sans que le stock ait à bouger, tout en gardant un fond reconnaissable. La
 * rotation est fonction du jour et jamais de l'horloge, pour que deux ouvertures
 * le même jour donnent exactement la même fournée.
 */
export function pickSeedIngredients(candidates: readonly SeedCandidate[], today: Date): SeedCandidate[] {
  const eligible = candidates.filter(isStructuring);
  if (eligible.length <= SEED_MAX) return [...eligible];

  const stable = eligible.slice(0, SEED_STABLE);
  const pool = eligible.slice(SEED_STABLE);
  const rotating: SeedCandidate[] = [];
  const offset = dayIndex(today) % pool.length;
  for (let n = 0; n < SEED_MAX - SEED_STABLE; n++) {
    rotating.push(pool[(offset + n) % pool.length]!);
  }
  return [...stable, ...rotating];
}
```

L'ordre d'entrée fait foi : c'est l'appelant (tâche 6) qui trie les candidats par importance avant
d'appeler cette fonction.

- [ ] **Step 4 : vérifier le succès**

Run : `npx vitest run src/rules/seed-selection --root packages/shared`
Attendu : PASS, 10 tests.

- [ ] **Step 5 : commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): sélection du point de départ des suggestions (EF-26)"
```

---

### Task 2: Règle pure — classement d'un rapprochement

**Files:**
- Create: `packages/shared/src/rules/ingredient-match.ts`, `ingredient-match.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces :
```ts
export type MatchState = 'sure' | 'probable' | 'absent';
export const MATCH_SIMILARITY_FLOOR = 0.4;
export interface MatchCandidate { productId: string; name: string; similarity: number }
export interface IngredientMatch { state: MatchState; productId: string | null; productName: string | null }
export function classifyMatch(label: string, candidates: readonly MatchCandidate[]): IngredientMatch;
```

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
import { describe, expect, it } from 'vitest';
import { classifyMatch, MATCH_SIMILARITY_FLOOR } from './ingredient-match.js';

describe('classifyMatch', () => {
  it('rend « sûr » sur une correspondance exacte, accents et casse ignorés', () => {
    expect(classifyMatch('Crème fraîche', [{ productId: 'p1', name: 'creme fraiche', similarity: 0.8 }]))
      .toEqual({ state: 'sure', productId: 'p1', productName: 'creme fraiche' });
  });
  it('rend « probable » au-dessus du seuil (B11)', () => {
    expect(classifyMatch('crème', [{ productId: 'p1', name: 'Crème fraîche épaisse 30%', similarity: 0.55 }]))
      .toMatchObject({ state: 'probable', productId: 'p1' });
  });
  it('rend « absent » en dessous du seuil', () => {
    expect(classifyMatch('safran', [{ productId: 'p1', name: 'Sauce soja', similarity: 0.2 }]))
      .toEqual({ state: 'absent', productId: null, productName: null });
  });
  it('rend « absent » sans candidat', () => {
    expect(classifyMatch('safran', [])).toEqual({ state: 'absent', productId: null, productName: null });
  });
  it('retient le meilleur candidat, pas le premier', () => {
    expect(classifyMatch('crème', [
      { productId: 'p1', name: 'Crème de marrons', similarity: 0.45 },
      { productId: 'p2', name: 'Crème fraîche', similarity: 0.7 },
    ])).toMatchObject({ productId: 'p2' });
  });
  it('préfère une correspondance exacte à un meilleur score trigramme', () => {
    expect(classifyMatch('Crème', [
      { productId: 'p1', name: 'Crème fraîche épaisse', similarity: 0.9 },
      { productId: 'p2', name: 'crème', similarity: 0.5 },
    ])).toMatchObject({ state: 'sure', productId: 'p2' });
  });
  it('rend « absent » sur un libellé vide, sans planter (vigilance 2)', () => {
    expect(classifyMatch('   ', [{ productId: 'p1', name: 'Riz', similarity: 0.9 }]).state).toBe('absent');
  });
  it('expose un seuil de 0,40', () => {
    expect(MATCH_SIMILARITY_FLOOR).toBe(0.4);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `npx vitest run src/rules/ingredient-match --root packages/shared`
Attendu : FAIL.

- [ ] **Step 3 : implémenter**

Réutiliser `normalizeProductName` déjà présent dans `packages/shared`. Une égalité de noms
normalisés l'emporte sur tout score ; sinon le meilleur `similarity` au-dessus de
`MATCH_SIMILARITY_FLOOR` donne `probable` ; sinon `absent`. Un libellé vide après normalisation rend
`absent` sans consulter les candidats.

- [ ] **Step 4 : vérifier le succès**

Run : `npx vitest run src/rules/ingredient-match --root packages/shared`
Attendu : PASS, 8 tests.

- [ ] **Step 5 : commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): classement des rapprochements d'ingrédients (EF-26)"
```

---

### Task 3: Schémas Zod et DTO des suggestions

**Files:**
- Create: `packages/shared/src/schemas/suggestions.ts`, `suggestions.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes : `DIFFICULTIES`, `unitSchema`, `IngredientState`, `CoverageGroup`.
- Produces :
```ts
export const SUGGESTION_REGIONS = ['europeenne','mediterraneenne','asiatique','latino-americaine','moyen-orientale','africaine','nord-americaine'] as const;
export const SUGGESTION_REGION_LABELS_FR: Record<SuggestionRegion, string>;
export const SUGGESTION_DURATIONS = [15, 30, 60] as const;
export const suggestionQuerySchema;   // region?, maxMinutes?, difficulty?, refresh?
export const modelRecipeSchema;       // une recette rendue par le modèle
export const modelBatchSchema;        // { recipes: ModelRecipe[] }
export const keepSuggestionSchema;    // { batchId, suggestionId, clientOpId? }
export interface SuggestionIngredientDto { label, quantity, unit, match: MatchState, productId, productName, state: IngredientState }
export interface SuggestionDto { id, title, origin, region, totalMinutes, difficulty, provenance: 'web'|'ai', sourceUrl, ingredients, coverage, group, missingLabels }
export interface SuggestionBatchDto { batchId, generatedAt, fromCache, items: SuggestionDto[], notice: string | null }
```

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
import { describe, expect, it } from 'vitest';
import { modelRecipeSchema, suggestionQuerySchema, SUGGESTION_REGIONS } from './suggestions.js';

const recette = {
  title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne',
  totalMinutes: 25, difficulty: 'EASY', provenance: 'web',
  sourceUrl: 'https://exemple.test/pates', steps: [],
  ingredients: [{ label: 'spaghettis', quantity: 200, unit: 'GRAM' }],
};

describe('modelRecipeSchema', () => {
  it('accepte une recette web complète', () => {
    expect(modelRecipeSchema.parse(recette).title).toBe('Pâtes à la tomate');
  });
  it('refuse une URL qui n’est pas en HTTPS (vigilance 2)', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: 'http://exemple.test/x' }).success).toBe(false);
  });
  it('exige une URL pour une recette web, jamais pour une composition', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: null }).success).toBe(false);
    expect(modelRecipeSchema.safeParse({ ...recette, provenance: 'ai', sourceUrl: null, steps: ['Cuire'] }).success).toBe(true);
  });
  it('exige des étapes pour une composition, qui en dispose déjà', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, provenance: 'ai', sourceUrl: null, steps: [] }).success).toBe(false);
  });
  it('refuse un libellé d’ingrédient vide', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, ingredients: [{ label: '  ', quantity: null, unit: null }] }).success).toBe(false);
  });
  it('accepte une quantité absente : « une pincée » existe', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, ingredients: [{ label: 'persil', quantity: null, unit: null }] }).success).toBe(true);
  });
});

describe('suggestionQuerySchema', () => {
  it('accepte une orientation vide', () => {
    expect(suggestionQuerySchema.parse({})).toEqual({ refresh: false });
  });
  it('accepte les trois dimensions ensemble (B9)', () => {
    const q = suggestionQuerySchema.parse({ region: 'asiatique', maxMinutes: '30', difficulty: 'EASY' });
    expect(q).toMatchObject({ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });
  it('refuse une durée hors des paliers', () => {
    expect(suggestionQuerySchema.safeParse({ maxMinutes: '42' }).success).toBe(false);
  });
  it('refuse une région inconnue', () => {
    expect(suggestionQuerySchema.safeParse({ region: 'martienne' }).success).toBe(false);
  });
  it('expose sept régions, sans doublon', () => {
    expect(new Set(SUGGESTION_REGIONS).size).toBe(SUGGESTION_REGIONS.length);
  });
});
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

`modelRecipeSchema` porte les deux règles croisées par un `superRefine` : `provenance: 'web'` exige
`sourceUrl` en `https:` ; `provenance: 'ai'` exige au moins une étape et interdit `sourceUrl`. Les
libellés sont `trim()`és et refusés vides.

Run : `npx vitest run src/schemas/suggestions --root packages/shared` → PASS, 11 tests.

- [ ] **Step 5 : commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): schémas Zod des suggestions de recettes (EF-26)"
```

---

### Task 4: Migration Prisma — fournées et journal partagé

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0005_recipe_suggestions/migration.sql`

- [ ] **Step 1 : modèle**

```prisma
enum AiPurpose {
  VISION
  RECIPE_SUGGESTION
}

model SuggestionBatch {
  id        String   @id @default(cuid())
  /** Signature du point de départ et de l'orientation : clé de cache (B12). */
  signature String   @unique
  payload   Json
  model     String
  costCents Decimal? @db.Decimal(10, 4)
  createdAt DateTime @default(now())

  @@index([createdAt])
}
```

et sur `RecognitionLog` : `purpose AiPurpose @default(VISION)` plus `@@index([purpose, createdAt])`.

- [ ] **Step 2 : migration**

`CREATE TYPE "AiPurpose"`, `CREATE TABLE "SuggestionBatch"`, `ALTER TABLE "RecognitionLog" ADD COLUMN
"purpose" "AiPurpose" NOT NULL DEFAULT 'VISION'`, et les deux index. Aucune réécriture de données.

- [ ] **Step 3 : vérifier**

```bash
npx vitest run --root apps/api
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```
Attendu : suite verte (la base embarquée applique la migration), aucune dérive.

- [ ] **Step 4 : commit**

```bash
git add prisma
git commit -m "feat(prisma): fournées de suggestions et journal d'appels partagé (EF-26)"
```

---

### Task 5: Fournisseur de suggestion Gemini

**Files:**
- Create: `apps/api/src/suggestions/suggestion-provider.ts`,
  `apps/api/src/suggestions/gemini-suggestion.provider.ts`,
  `apps/api/src/suggestions/prompt.ts`,
  `apps/api/test/fixtures/suggestions/gemini-batch.json`,
  `gemini-batch-invalide.json`, `gemini-batch-vide.json`
- Create: `apps/api/src/suggestions/gemini-suggestion.provider.spec.ts`

**Interfaces:**
- Produces :
```ts
export interface SuggestionRequest { seeds: readonly string[]; region?: SuggestionRegion; maxMinutes?: number; difficulty?: Difficulty; count: number }
export interface SuggestionOutput { recipes: ModelRecipe[]; raw: unknown; costCents: number | null; model: string }
export interface SuggestionProvider { readonly name: string; readonly enabled: boolean; suggest(req: SuggestionRequest): Promise<SuggestionOutput> }
export const SUGGESTION_PROVIDER: unique symbol;
```

- [ ] **Step 1 : écrire les tests qui échouent**

Tests sur un `HttpClient` bouchonné, alimenté par les fixtures :

```ts
it('rend douze recettes depuis une réponse conforme', async () => { /* fixture gemini-batch.json */ });
it('extrait le JSON encadré par des clôtures ``` (vigilance 1)', async () => { /* … */ });
it('reprend une fois quand le JSON est invalide, puis échoue proprement', async () => {
  // deux appels au plus, puis ProviderError — jamais de troisième tentative
});
it('n’envoie pas responseSchema quand la recherche web est activée (vigilance 1)', async () => {
  // le corps de la requête contient tools[google_search] et pas generationConfig.responseSchema
});
it('porte la région, la durée et la difficulté demandées dans le prompt (B9)', async () => { /* … */ });
it('calcule un coût à partir de usageMetadata', async () => { /* … */ });
it('est désactivé sans clé, et le dit', async () => { /* enabled === false */ });
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Un seul appel `generateContent` demande les deux sources : huit recettes issues de la recherche web
avec leur URL, quatre composées **[B8]**, en précisant que ce dosage s'ajuste si la recherche rend
peu. **Aucune variété n'est exigée [B9].** L'orientation, quand elle est fournie, est portée dans le
prompt — région, durée maximale, niveau de difficulté.

La recherche Google est activée par `tools: [{ google_search: {} }]`. **Elle interdit
`responseSchema`** : le prompt impose donc « réponds par un seul objet JSON, sans texte autour », la
réponse est débarrassée d'éventuelles clôtures ``` et validée par `modelBatchSchema`. Une réponse
invalide donne lieu à **une** reprise avec un rappel du format ; un second échec lève
`ProviderError`.

Le coût se calcule comme dans `gemini.provider.ts`, en réutilisant sa table de prix.

Run : `npx vitest run src/suggestions --root apps/api` → PASS.

- [ ] **Step 5 : commit**

```bash
git add apps/api/src/suggestions apps/api/test/fixtures
git commit -m "feat(recipes): fournisseur de suggestions Gemini avec recherche web (EF-26)"
```

---

### Task 6: Service de suggestion — composition, rapprochement, cache

**Files:**
- Create: `apps/api/src/suggestions/suggestions.service.ts`, `suggestions.module.ts`
- Modify: `apps/api/src/recipes/recipes.coverage.ts` (export du chargement des candidats)
- Create: `apps/api/src/suggestions/suggestions.e2e-spec.ts`

**Interfaces:**
- Consumes : `pickSeedIngredients`, `classifyMatch`, `recipeCoverage`, `RecipesCoverageService`,
  `SuggestionProvider`, `SettingsService`.
- Produces : `SuggestionsService.list(query, user): Promise<SuggestionBatchDto>`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
it('compose la requête depuis le stock, sans les épices ni le sel (B5)', async () => { /* … */ });
it('refuse d’appeler le modèle quand le stock ne donne aucun ingrédient (vigilance 3)', async () => {
  // 409 stock_insuffisant, message français, aucun appel au fournisseur
});
it('rapproche « crème » de « Crème fraîche épaisse 30% » et le marque probable (B11)', async () => { /* … */ });
it('compte un rapprochement probable comme disponible dans la couverture', async () => { /* … */ });
it('sert la fournée en cache tant que la signature est identique (B12)', async () => {
  // deux appels HTTP, un seul appel au fournisseur, fromCache à vrai la seconde fois
});
it('relance une recherche quand l’orientation change (B9)', async () => { /* … */ });
it('relance une recherche quand refresh est demandé', async () => { /* … */ });
it('met en cache séparément chaque orientation', async () => { /* … */ });
it('refuse l’appel au-delà du quota journalier, en servant la dernière fournée', async () => { /* … */ });
it('refuse l’appel au-delà du plafond mensuel, en servant la dernière fournée', async () => { /* … */ });
it('journalise l’appel avec purpose RECIPE_SUGGESTION', async () => { /* … */ });
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Enchaînement : instantané de stock existant → candidats triés par importance (profondeur de
catégorie puis quantité) → `pickSeedIngredients` → signature → cache → fournisseur → validation →
rapprochement → couverture → DTO.

Le rapprochement interroge les produits une seule fois pour tous les libellés de la fournée, par une
requête `pg_trgm` sur `unaccent_lite(name)` qui rend les meilleurs candidats par libellé ; le verdict
vient de `classifyMatch`. **Jamais une requête par ingrédient.**

La signature est `sha256(seeds triés + région + durée + difficulté + version du prompt)`. Une
fournée de plus de 24 heures est ignorée. Quota et plafond sont lus comme dans
`recognition.service.ts`, en comptant les lignes `purpose = RECIPE_SUGGESTION`.

- [ ] **Step 5 : commit**

```bash
git add apps/api/src
git commit -m "feat(recipes): service de suggestion, rapprochement au stock et cache (EF-26)"
```

---

### Task 7: Routes de suggestion

**Files:**
- Create: `apps/api/src/suggestions/suggestions.controller.ts`
- Modify: `apps/api/src/app.module.ts`, `suggestions.e2e-spec.ts`

**Interfaces:**
- Produces : `GET /api/v1/suggestions` (orientation en paramètres de requête),
  `POST /api/v1/suggestions/keep`.

- [ ] **Step 1 : tests**

```ts
it('exige une session', async () => { /* 401 */ });
it('valide l’orientation par le schéma partagé', async () => { /* 400 sur region=martienne */ });
it('rend une fournée avec son identifiant et son horodatage', async () => { /* … */ });
it('dit en français que le fournisseur n’est pas configuré', async () => { /* 409, code provider_disabled */ });
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Contrôleur mince : `@ZodQuery(suggestionQuerySchema)`, délégation au service, enveloppe d'erreur du
projet. `POST /suggestions/keep` est implémenté en tâche 9.

- [ ] **Step 5 : commit**

```bash
git add apps/api/src
git commit -m "feat(recipes): routes de suggestion de recettes (EF-26)"
```

---

### Task 8: Retrait de l'anti-gaspillage et de la création manuelle

**Files:**
- Modify: `packages/shared/src/rules/recipe-sort.ts`, `coverage.ts` et leurs tests,
  `apps/api/src/recipes/recipes.service.ts`, `recipe.mapper.ts`,
  `apps/web/src/screens/recipes/recipe-card.tsx`, `recipe-filters.tsx`, `recipes-screen.tsx`,
  `apps/web/src/screens/recipe/ingredient-row.tsx`

- [ ] **Step 1 : adapter les tests existants**

Retirer `antiWaste` de `RECIPE_SORTS` : quatre tris demeurent (`rating`, `coverage`, `mostCooked`,
`leastRecent`). Les tests de stabilité des tris portent désormais sur quatre tris. Retirer de
`RecipeCoverage` le champ `bonus` et les assertions associées, ainsi que `nearExpiry` de
`IngredientOutcome` et son affichage « périme bientôt » sur la ligne d'ingrédient.

**Point à confirmer avec Franck avant d'exécuter cette tâche :** il a demandé le retrait de la
mention et du tri anti-gaspillage. La mention « périme bientôt » portée par une *ligne d'ingrédient*
de la fiche recette relève de la même notion ; ce plan la retire aussi, pour tenir « plus aucune
notion de péremption dans le module recettes ». Si Franck veut la garder, ne retirer que `bonus`, le
tri et la pastille de carte.

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Supprimer aussi le bouton de création de `recipes-screen.tsx` **[B13]** et la route de création
côté web ; `POST /recipes` reste, utilisé par la conservation d'une suggestion.

Run : `npm run typecheck && npm run lint && npx vitest run --root packages/shared && npx vitest run
--root apps/api && npx vitest run --root apps/web`

- [ ] **Step 5 : commit**

```bash
git add packages/shared apps
git commit -m "refactor(recipes): retirer l'anti-gaspillage et la création manuelle (EF-27 retirée)"
```

---

### Task 9: Conservation — récupération de page et réécriture

**Files:**
- Create: `apps/api/src/suggestions/recipe-page.fetcher.ts`, `recipe-page.fetcher.spec.ts`
- Create fixtures: `page-schema-simple.html`, `page-schema-graph.html`, `page-schema-tableau.html`,
  `page-sans-schema.html`, `page-hors-sujet.html`
- Modify: `suggestions.service.ts`, `suggestions.controller.ts`, `suggestions.e2e-spec.ts`

**Interfaces:**
- Produces : `RecipePageFetcher.fetch(url): Promise<PageRecipe | null>`,
  `SuggestionsService.keep(input, user): Promise<RecipeDto>`.

- [ ] **Step 1 : tests du lecteur de page**

```ts
it('lit un schema.org/Recipe simple', async () => { /* … */ });
it('lit un Recipe imbriqué dans @graph (vigilance 5)', async () => { /* … */ });
it('lit un Recipe rendu dans un tableau JSON-LD (vigilance 5)', async () => { /* … */ });
it('rend null quand la page n’a pas de données structurées', async () => { /* … */ });
it('rend null quand le JSON-LD n’est pas une recette', async () => { /* … */ });
it('rend null au-delà de cinq secondes, sans faire échouer l’appelant', async () => { /* … */ });
it('refuse une URL qui n’est pas en HTTPS', async () => { /* … */ });
it('refuse une URL qui vise une adresse privée (vigilance 2)', async () => { /* … */ });
```

- [ ] **Step 2 : tests de la conservation**

```ts
it('conserve une recette web : page lue, contenu réécrit par Gemini, source IMPORTED', async () => { /* … */ });
it('conserve une composition sans appeler le réseau, source GENERATED', async () => { /* … */ });
it('recalcule la difficulté avec le barème du foyer à la conservation (B15)', async () => {
  // la suggestion annonçait HARD, les étapes conservées donnent INTERMEDIATE
});
it('rattache les ingrédients aux produits rapprochés, laisse les autres en texte libre', async () => { /* … */ });
it('échoue en français quand la page ne répond pas, sans créer de recette', async () => { /* … */ });
it('est idempotente : deux conservations du même clientOpId ne créent qu’une recette', async () => { /* … */ });
```

- [ ] **Step 3 à 5 : implémentation, succès, commit**

À la conservation **[B6]** : pour `provenance: 'web'`, récupérer la page (HTTPS seul, 5 s, refus des
adresses privées), lire `schema.org/Recipe` **[B14]**, puis soumettre ingrédients et étapes à Gemini
pour restitution au format de l'application. Sans données structurées, soumettre le texte nettoyé de
la page. Pour `provenance: 'ai'`, reprendre les étapes déjà rendues sans aucun appel.

Créer la `Recipe` avec `source`, `sourceUrl`, ses ingrédients rattachés, puis **recalculer la
difficulté** par `computeDifficulty` **[B15]**.

```bash
git add apps/api
git commit -m "feat(recipes): conserver une suggestion, page extraite et réécrite (EF-25, EF-26)"
```

---

### Task 10: Front — écran Suggestions

**Files:**
- Create: `apps/web/src/screens/suggestions/suggestions-screen.tsx`, `suggestion-card.tsx`,
  `suggestion-card.test.tsx`
- Create: `apps/web/src/lib/suggestions-api.ts`
- Modify: `apps/web/src/lib/queries.ts`

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuggestionCard } from './suggestion-card';

const base = {
  id: 's1', title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne',
  totalMinutes: 25, difficulty: 'EASY' as const, provenance: 'web' as const,
  sourceUrl: 'https://exemple.test/pates', coverage: 1, group: 'ready' as const,
  missingLabels: [], ingredients: [],
};

describe('SuggestionCard', () => {
  it('affiche le pays même si le choix se fait par région (B10)', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.getByText(/italienne/i)).toBeTruthy();
  });
  it('nomme le site pour une recette web', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.getByText(/exemple\.test/)).toBeTruthy();
  });
  it('annonce une composition par l’IA', () => {
    render(<SuggestionCard suggestion={{ ...base, provenance: 'ai', sourceUrl: null }} />);
    expect(screen.getByText(/proposée par l’IA/i)).toBeTruthy();
  });
  it('n’affiche jamais d’étapes avant conservation (B7)', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.queryByText(/étape/i)).toBeNull();
  });
  it('liste les ingrédients manquants', () => {
    render(<SuggestionCard suggestion={{ ...base, group: 'almost', coverage: 0.75, missingLabels: ['Basilic'] }} />);
    expect(screen.getByText(/Basilic/)).toBeTruthy();
  });
  it('ne porte aucune mention de péremption (B5)', () => {
    render(<SuggestionCard suggestion={base} />);
    expect(screen.queryByText(/périme/i)).toBeNull();
  });
});
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

La liste reprend la facture de l'écran Stock. Six états, chacun avec son message français :
fournisseur non configuré, stock insuffisant, attente, échec du modèle, quota ou plafond atteint,
aucun résultat pour l'orientation. L'attente est explicite — la recherche prend plusieurs secondes.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src
git commit -m "feat(web): écran Suggestions de recettes (EF-26)"
```

---

### Task 11: Front — orientation par région, durée et facilité

**Files:**
- Create: `apps/web/src/screens/suggestions/orientation-bar.tsx`, `orientation-bar.test.tsx`
- Modify: `suggestions-screen.tsx`, `apps/web/src/lib/queries.ts`

- [ ] **Step 1 : tests**

```tsx
it('propose les régions, pas les pays (B10)', () => { /* « Asiatique » présent, « Japonaise » absent */ });
it('relance une recherche au choix d’une région (B9)', () => { /* la clé de requête change */ });
it('relance une recherche au choix d’une durée', () => { /* … */ });
it('relance une recherche au choix d’une difficulté', () => { /* … */ });
it('cumule les trois dimensions', () => { /* … */ });
it('revient à la fournée de base d’un seul geste', () => { /* « Tout effacer » */ });
it('respecte la cible tactile du projet', () => { /* min-h-touch */ });
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Chaque dimension fait partie de la clé TanStack Query : changer d'orientation déclenche une requête,
et revenir sur une orientation déjà vue est servi par le cache client **puis** par le cache serveur.
Un indicateur d'attente s'affiche pendant la recherche, sans vider la liste précédente.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src
git commit -m "feat(web): orientation des suggestions par région, durée et facilité (EF-26)"
```

---

### Task 12: Front — fiche de suggestion et conservation

**Files:**
- Create: `apps/web/src/screens/suggestions/suggestion-sheet.tsx`, `suggestion-sheet.test.tsx`
- Modify: `suggestions-screen.tsx`, `apps/web/src/lib/suggestions-api.ts`

- [ ] **Step 1 : tests**

```tsx
it('détaille les ingrédients et leur état', () => { /* … */ });
it('signale un rapprochement probable (B11)', () => { /* « crème → Crème fraîche épaisse 30% » */ });
it('n’affiche pas d’étapes (B7)', () => { /* … */ });
it('conserve la recette et annonce l’attente pendant l’extraction', () => { /* … */ });
it('affiche le message français de l’API quand la conservation échoue', () => { /* … */ });
it('ne conserve pas deux fois sur un double appui', () => { /* même clientOpId, bouton désactivé */ });
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Au succès : invalider la liste des recettes et la fournée, puis ouvrir la fiche de la recette
conservée — c'est là que Franck lira enfin les étapes.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src
git commit -m "feat(web): fiche de suggestion et conservation en bibliothèque (EF-26)"
```

---

### Task 13: Front — navigation, Suggestions en entrée

**Files:**
- Modify: `apps/web/src/app.tsx`, `apps/web/src/components/shell/` (barre de navigation),
  `apps/web/src/screens/recipes/recipes-screen.tsx`

- [ ] **Step 1 : tests**

```tsx
it('ouvre Suggestions quand on touche Recettes (B12)', () => { /* … */ });
it('donne accès à Mes recettes depuis Suggestions', () => { /* … */ });
it('n’offre plus de création de recette (B13)', () => { /* pas de bouton « + » */ });
```

- [ ] **Step 2 à 4 : échec, implémentation, succès**

Route `/recettes` → Suggestions ; `/recettes/bibliotheque` → Mes recettes ; `/recettes/:id` inchangée.

- [ ] **Step 5 : commit**

```bash
git add apps/web/src
git commit -m "feat(web): Suggestions devient l'écran d'entrée du module recettes (EF-26)"
```

---

### Task 14: Scénario de réussite figé

**Files:**
- Create: `apps/api/src/suggestions/suggestions.scenario.e2e-spec.ts`

- [ ] **Step 1 : écrire le scénario**

Stock figé : spaghettis 500 g · sauce tomate 400 g · parmesan 200 g · huile d'olive 500 ml · sel ·
paprika · riz 1 kg. Fixture de réponse Gemini figée, douze recettes dont huit web.

Résultat attendu, écrit d'avance :
- la sélection envoyée contient spaghettis, sauce tomate, parmesan, huile d'olive et riz ;
- elle ne contient **ni le sel ni le paprika** ;
- « crème » d'une recette est rapprochée en `absent`, « parmesan râpé » en `probable` ;
- chaque recette reçoit son groupe et son taux de couverture, recette par recette ;
- conserver la première recette crée une `Recipe` `IMPORTED` dont la difficulté est celle du barème
  du foyer, et non celle annoncée par la fixture.

- [ ] **Step 2 à 3 : vérifier, commit**

```bash
git add apps/api
git commit -m "test(recipes): scénario de réussite figé des suggestions (B16)"
```

---

### Task 15: Documentation et publication

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- Create: `docs/decisions/2026-10-04-recettes-suggerees.md`

- [ ] **Step 1 : README**

Décrire le module tel qu'il est : écran Suggestions en entrée, recettes trouvées sur le web ou
composées par Gemini, orientation par région, durée et facilité, conservation au format unique de
l'application, bibliothèque avec cuisson, historique et notation. Documenter
`RECIPE_SUGGESTION_DAILY_QUOTA` et le fait que `VISION_MONTHLY_CAP_CENTS` plafonne désormais
l'ensemble des appels au modèle, **5 € recommandés**. Dire la limite connue : pas d'ajout aux
courses, pas de recette de famille saisie à la main. Ajouter la ligne de version à
« Derniers changements ».

- [ ] **Step 2 : décisions**

Renvoyer vers la spécification et ses dix-sept arbitrages plutôt que les recopier. Noter l'amendement
du cahier du 2026-10-04 et le motif.

- [ ] **Step 3 : CLAUDE.md**

Déplacer les suggestions vers « ce qui est déjà fait ». Ce qui reste du lot 2 : seuils et liste de
courses, alertes de péremption, mode hors ligne, export enrichi, EF-24. Garder en attente la DLC
dans le tiroir de scan, les parcours Playwright et le jeu de non-régression photo.

- [ ] **Step 4 : vérification complète**

```bash
npm run build -w @kitchen/shared && npm run lint && npm run typecheck --workspaces --if-present \
  && npm test --workspaces --if-present && npm run build -w @kitchen/api && npm run build -w @kitchen/web
```

Noter que `npm run build -w @kitchen/api` fait partie des contrôles : son absence a laissé passer une
CI rouge lors de l'incrément précédent.

- [ ] **Step 5 : commit**

```bash
git add README.md CLAUDE.md docs
git commit -m "docs: suggestions de recettes dans le README et décisions associées"
```
