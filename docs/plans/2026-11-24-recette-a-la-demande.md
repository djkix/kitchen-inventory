# Recette à la demande — plan d'exécution

> **Pour un exécutant agentique :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les
> étapes sont des cases à cocher (`- [ ]`).

**But :** une demande en langage naturel, parlée ou écrite, rend une recette
unique détaillée accompagnée de remarques sur le stock réel ; les fournées
filtrées gardent leur forme mais s'enrichissent des mêmes remarques.

**Architecture :** le modèle reçoit désormais la liste complète des produits du
foyer (sans quantités ni dates) au lieu de huit graines, et rend un champ
`notes` par recette. Un nouveau chemin « une recette » (route écrite neuve,
route parlée convertie) appelle le modèle sans passer par le réservoir ni la
signature d'orientation, force `provenance: 'ai'`, et rend un `SuggestionDto`
ordinaire pour que la carte, le tiroir et la conservation fonctionnent tels
quels. L'équivalent ménager (« 45 ml (3 c. à soupe) ») est calculé à
l'affichage par une fonction pure, jamais stocké.

**Pile :** TypeScript strict de bout en bout. NestJS + Prisma + PostgreSQL 16,
React + Vite + Tailwind, Zod et règles pures dans `packages/shared`, Vitest,
Playwright pour les parcours bout en bout.

**Spécification :** `docs/specs/2026-11-24-recette-a-la-demande.md` — à lire
avec ce plan, il en est l'argumentaire.

## Contraintes globales

- Règles métier en fonctions pures testées dans `packages/shared` (section 15) ;
  jamais recopiées dans un composant ou un contrôleur.
- Schémas Zod définis une seule fois dans `packages/shared`, réutilisés côté front.
- Anglais pour le code et les identifiants, français pour les libellés
  d'interface et les messages d'erreur.
- TypeScript strict, `any` interdit hors tests.
- Aucun test ne dépend du réseau : Gemini et Open Food Facts rejoués depuis des
  fixtures.
- Tout appel au modèle passe par `GeminiService.call`.
- Quota journalier `RECIPE_SUGGESTION_DAILY_QUOTA` (20) et plafond mensuel
  `VISION_MONTHLY_CAP_CENTS` (5 €), partagés avec le scan.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- `README.md` est mis à jour en français dans le commit de la tâche qui change
  ce que l'utilisateur voit.
- Les messages de commit citent l'exigence : `feat(suggestions): … (EF-25)`.
- **Rien n'est envoyé au modèle sur les quantités en stock ni sur les dates de
  péremption** (décision du propriétaire, 2026-11-24).

## Points de vigilance pour la revue

Cinq cas que la spec implique sans qu'aucune tâche ne les exerce
naturellement. Chacun reçoit son test dans la tâche qui porte le code.

1. **Une phrase qui ne demande pas une recette** (« bonjour ») : refus en
   français, jamais une recette de remplissage, jamais un 500. → tâche 4.
2. **Un foyer vide** : les trois chemins le disent avant d'appeler le modèle.
   → tâche 3.
3. **Une recette du réservoir sans `notes`** (les ~400 existantes) : se lit, se
   valide et s'affiche. → tâche 2.
4. **Un résultat différé écrit avant la livraison** (ancienne forme
   `VoiceSuggestionBatchDto`, avec `items`) relu après : l'écran ne casse pas.
   → tâche 5.
5. **Une quantité pile aux seuils** de l'équivalent ménager (2,5 / 15 / 120) :
   arrondi et choix de cuillère déterministes. → tâche 1.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `packages/shared/src/rules/kitchen-equivalent.ts` | **créé** — conversion d'une quantité en cuillères, règle pure |
| `packages/shared/src/rules/household-inventory.ts` | **créé** — mise en forme de la liste du foyer pour le prompt, règle pure |
| `packages/shared/src/schemas/suggestions.ts` | `notes` sur `modelRecipeSchema` et `SuggestionDto` ; `singleRecipeModelSchema` ; retrait de `suggestionIngredientsSchema` |
| `packages/shared/src/rules/ai-requests.ts` | nouveau genre `RECIPE_REQUEST` |
| `packages/shared/src/rules/seed-selection.ts` | **supprimé** |
| `packages/shared/src/rules/suggestion-ingredients.ts` | **supprimé** |
| `apps/api/src/suggestions/prompt.ts` | consignes : `notes`, inventaire du foyer, recette unique |
| `apps/api/src/suggestions/gemini-suggestion.provider.ts` | `suggestOne` (écrit) ; `suggestFromVoice` rend une recette |
| `apps/api/src/suggestions/suggestions.service.ts` | `requestOne`, inventaire du foyer, `listFromVoice` converti |
| `apps/api/src/suggestions/suggestions.controller.ts` | `POST /suggestions/request`, rejoueur `RECIPE_REQUEST` |
| `apps/api/src/recipes/recipes.coverage.ts` | retrait de `loadSeedCandidates` ; `loadHouseholdProducts` |
| `apps/web/src/screens/suggestions/request-field.tsx` | **créé** — champ de texte libre, remplace `ingredients-field.tsx` |
| `apps/web/src/screens/suggestions/single-recipe-screen.tsx` | **créé** — l'écran de réponse, partagé par les deux entrées |
| `apps/web/src/lib/kitchen-equivalent-ui.ts` | **créé** — libellé français de l'équivalent, au-dessus de la règle pure |
| `prisma/migrations/0018_recipe_request/` | **créée** — valeur d'enum `RECIPE_REQUEST` |

---

## Task 1 — l'équivalent ménager

Indépendante de tout le reste : livrable et testable seule.

**Fichiers :**
- Créer : `packages/shared/src/rules/kitchen-equivalent.ts`
- Créer : `packages/shared/src/rules/kitchen-equivalent.test.ts`
- Créer : `apps/web/src/lib/kitchen-equivalent-ui.ts`
- Créer : `apps/web/src/lib/kitchen-equivalent-ui.test.ts`
- Modifier : `packages/shared/src/rules/index.ts` (export)
- Modifier : `apps/web/src/screens/recipe/ingredient-row.tsx:54-56`
- Modifier : `apps/web/src/screens/recipe/cook-sheet.tsx`
- Modifier : `apps/web/src/screens/suggestions/suggestion-sheet.tsx:190`

**Interfaces :**
- Produit : `kitchenEquivalent(quantity: number, unit: Unit): { spoons: number; spoon: 'tablespoon' | 'teaspoon' } | null`
  dans `packages/shared`, et `formatKitchenEquivalent(quantity: number, unit: Unit): string | null`
  dans `apps/web/src/lib/kitchen-equivalent-ui.ts`, qui rend le libellé français
  ou `null`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// packages/shared/src/rules/kitchen-equivalent.test.ts
it.each(['PIECE', 'PACK', 'BOX', 'SACHET'] as const)('ne convertit pas %s', (unit) => {
  expect(kitchenEquivalent(3, unit)).toBeNull();
});

it('convertit un volume en cuillères à soupe', () => {
  expect(kitchenEquivalent(45, 'MILLILITER')).toEqual({ spoons: 3, spoon: 'tablespoon' });
});

it('convertit une masse avec les mêmes équivalences', () => {
  expect(kitchenEquivalent(30, 'GRAM')).toEqual({ spoons: 2, spoon: 'tablespoon' });
});

it('ramène les grandes unités à leur base', () => {
  expect(kitchenEquivalent(0.06, 'LITER')).toEqual({ spoons: 4, spoon: 'tablespoon' });
});

// Vigilance 5 : les trois seuils, pile dessus.
it('bascule sur la cuillère à café en dessous de 15', () => {
  expect(kitchenEquivalent(14, 'GRAM')).toEqual({ spoons: 3, spoon: 'teaspoon' });
  expect(kitchenEquivalent(15, 'GRAM')).toEqual({ spoons: 1, spoon: 'tablespoon' });
});

it('ne rend rien sous une demi-cuillère à café', () => {
  expect(kitchenEquivalent(2.4, 'MILLILITER')).toBeNull();
  expect(kitchenEquivalent(2.5, 'MILLILITER')).toEqual({ spoons: 0.5, spoon: 'teaspoon' });
});

it('ne rend rien au-delà de huit cuillères à soupe', () => {
  expect(kitchenEquivalent(120, 'GRAM')).toEqual({ spoons: 8, spoon: 'tablespoon' });
  expect(kitchenEquivalent(121, 'GRAM')).toBeNull();
});

it('arrondit au demi', () => {
  expect(kitchenEquivalent(20, 'MILLILITER')).toEqual({ spoons: 1.5, spoon: 'tablespoon' });
});
```

```ts
// apps/web/src/lib/kitchen-equivalent-ui.test.ts
it('écrit le libellé en français', () => {
  expect(formatKitchenEquivalent(45, 'MILLILITER')).toBe('3 c. à soupe');
  expect(formatKitchenEquivalent(20, 'MILLILITER')).toBe('1,5 c. à soupe');
  expect(formatKitchenEquivalent(10, 'GRAM')).toBe('2 c. à café');
});

it('ne rend rien quand il n’y a rien à dire', () => {
  expect(formatKitchenEquivalent(2, 'PIECE')).toBeNull();
  expect(formatKitchenEquivalent(250, 'GRAM')).toBeNull();
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Commande : `npm test -w @kitchen/shared -- kitchen-equivalent`
Attendu : ÉCHEC, `kitchenEquivalent is not defined`.

- [ ] **Étape 3 : implémenter `kitchenEquivalent` dans `packages/shared/src/rules/kitchen-equivalent.ts`**

Bases : 15 pour la cuillère à soupe, 5 pour la cuillère à café, appliquées à la
quantité ramenée à l'unité de base de sa famille (g pour la masse, ml pour le
volume — `UNIT_FAMILY` et le facteur de base existent déjà dans
`packages/shared/src/units.ts`). Plancher à 2,5 unités de base, plafond à 120.
Arrondi au demi après le choix de la cuillère.

- [ ] **Étape 4 : implémenter `formatKitchenEquivalent`**

Au-dessus de la règle pure, avec `Intl.NumberFormat('fr-FR')` comme
`formatQuantity` (`apps/web/src/lib/quantity-ui.ts`) pour la virgule décimale.
`formatQuantity` n'est **pas** modifiée : elle est partagée avec les écrans
Stock, Article, Scan et Périme bientôt, qui n'ont que faire de cuillères.

- [ ] **Étape 5 : afficher l'équivalent dans les trois vues recette**

À côté de la quantité déjà affichée, entre parenthèses et dans le même ton
discret, dans `ingredient-row.tsx`, `cook-sheet.tsx` et `suggestion-sheet.tsx`.
Rien ailleurs.

- [ ] **Étape 6 : vérifier**

Commandes : `npm test -w @kitchen/shared` puis `npm test -w @kitchen/web`
Attendu : SUCCÈS.

- [ ] **Étape 7 : README** — la section recettes mentionne l'équivalent ménager.

- [ ] **Étape 8 : commit**

```bash
git add packages/shared/src/rules/kitchen-equivalent.ts packages/shared/src/rules/kitchen-equivalent.test.ts packages/shared/src/rules/index.ts apps/web/src/lib/kitchen-equivalent-ui.ts apps/web/src/lib/kitchen-equivalent-ui.test.ts apps/web/src/screens/recipe/ingredient-row.tsx apps/web/src/screens/recipe/cook-sheet.tsx apps/web/src/screens/suggestions/suggestion-sheet.tsx README.md
git commit -m "feat(recettes): l'équivalent en cuillères à côté des grammes (EF-26)"
```

---

## Task 2 — les remarques du modèle (`notes`)

**Fichiers :**
- Modifier : `packages/shared/src/schemas/suggestions.ts` (`modelRecipeBaseSchema:205`, `SuggestionIngredientDto`/`SuggestionDto:338-368`)
- Modifier : `apps/api/src/suggestions/prompt.ts` (`QUALITY_RULES`, `recipeFieldsLine()`)
- Modifier : `apps/api/src/suggestions/suggestions.service.ts` (`toSuggestionDtos:799`)
- Modifier : `apps/web/src/screens/suggestions/suggestion-sheet.tsx`
- Test : `packages/shared/src/schemas/suggestions.test.ts`, `apps/api/src/suggestions/gemini-suggestion.provider.spec.ts`, `apps/web/src/screens/suggestions/suggestion-sheet.test.tsx`

**Interfaces :**
- Produit : `modelRecipeSchema` et `SuggestionDto` portent `notes: string | null`.
  Les tâches 4 et 5 s'appuient dessus.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// packages/shared/src/schemas/suggestions.test.ts
it('accepte les remarques du modèle', () => {
  expect(modelRecipeSchema.parse({ ...recetteValide, notes: 'Pas d’ail frais : ail semoule.' }).notes)
    .toBe('Pas d’ail frais : ail semoule.');
});

// Vigilance 3 : les ~400 recettes déjà au réservoir n'ont pas ce champ.
it('accepte une recette sans remarques et rend null', () => {
  expect(modelRecipeSchema.parse(recetteValide).notes).toBeNull();
});
```

```ts
// apps/api/src/suggestions/gemini-suggestion.provider.spec.ts — dans le describe existant
it.each(variantes)('demande des remarques sur le stock réel (%s)', (_, prompt) => {
  expect(prompt).toContain('notes');
  expect(prompt).toContain('jamais de date de péremption');
});
```

```ts
// apps/web/src/screens/suggestions/suggestion-sheet.test.tsx
it('affiche les remarques quand il y en a', () => { /* notes rendues dans le tiroir */ });
it('n’affiche rien quand notes vaut null', () => { /* aucun bloc de remarques */ });
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Commandes : `npm test -w @kitchen/shared -- suggestions`, `npm test -w @kitchen/api -- gemini-suggestion`, `npm test -w @kitchen/web -- suggestion-sheet`

- [ ] **Étape 3 : ajouter `notes` au schéma**

`notes: z.string().trim().max(1200).nullable().default(null)` sur
`modelRecipeBaseSchema`. Le champ vit dans `payload Json` de
`SuggestionPoolRecipe` : **aucune migration**. `.default(null)` est ce qui fait
passer les lignes existantes à la revalidation (`toPoolRecipe`).

- [ ] **Étape 4 : le demander au modèle**

Dans `recipeFieldsLine()` : `notes` décrit comme quelques phrases en français
sur cette recette face au stock du foyer — substitutions faites et pourquoi, où
un ingrédient est rangé s'il surprend, une variante si elle vaut la peine ;
**jamais de date de péremption** ; `null` s'il n'y a rien à dire. Partagé par
les trois chemins puisque la fonction l'est déjà.

- [ ] **Étape 5 : porter `notes` jusqu'à l'écran**

`notes` sur `SuggestionDto`, rempli par `toSuggestionDtos` depuis la recette du
réservoir, affiché dans le tiroir au-dessus des ingrédients.

- [ ] **Étape 6 : vérifier**

Commandes : `npm test -w @kitchen/shared && npm test -w @kitchen/api && npm test -w @kitchen/web`

- [ ] **Étape 7 : README** — la liste de Suggestions porte désormais des remarques par recette, et les recettes déjà au réservoir n'en ont pas.

- [ ] **Étape 8 : commit**

```bash
git commit -am "feat(suggestions): des remarques du modèle sur chaque recette (EF-25)"
```

---

## Task 3 — la liste du foyer au modèle

**Fichiers :**
- Créer : `packages/shared/src/rules/household-inventory.ts` + `.test.ts`
- Modifier : `apps/api/src/recipes/recipes.coverage.ts` (`loadSeedCandidates:295` → `loadHouseholdProducts`)
- Modifier : `apps/api/src/suggestions/suggestions.service.ts:330-380`, `:460-490`, `:695-720`
- Modifier : `apps/api/src/suggestions/suggestion-provider.ts` (`SuggestionRequest.seeds` → `household`)
- Modifier : `apps/api/src/suggestions/prompt.ts` (`buildSuggestionPrompt`, `buildVoicePrompt`)
- Supprimer : `packages/shared/src/rules/seed-selection.ts` + `.test.ts`
- Test : `apps/api/src/suggestions/suggestions.e2e-spec.ts`

**Interfaces :**
- Consomme : rien des tâches précédentes.
- Produit : `formatHouseholdInventory(rows: readonly HouseholdProduct[]): string`
  dans `packages/shared`, où `HouseholdProduct = { name: string; locations: readonly string[] }`.
  `loadHouseholdProducts(prisma: PrismaService): Promise<HouseholdProduct[]>`
  dans `recipes.coverage.ts`. `SuggestionRequest.household: string` remplace
  `seeds: readonly string[]` — les tâches 4 et 5 l'emploient.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// packages/shared/src/rules/household-inventory.test.ts
it('cite chaque produit avec son emplacement', () => {
  expect(formatHouseholdInventory([{ name: 'Farine de riz', locations: ['Placard'] }]))
    .toContain('Farine de riz (Placard)');
});

it('cite les deux emplacements d’un produit rangé à deux endroits', () => {
  expect(formatHouseholdInventory([{ name: 'Beurre', locations: ['Réfrigérateur', 'Congélateur'] }]))
    .toContain('Beurre (Réfrigérateur, Congélateur)');
});

it('ne porte ni quantité ni date', () => {
  const texte = formatHouseholdInventory([{ name: 'Lait de coco', locations: ['Placard'] }]);
  expect(texte).not.toMatch(/\d+\s*(g|ml|kg|l)\b/);
  expect(texte).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

it('rend une phrase explicite sur un foyer vide', () => {
  expect(formatHouseholdInventory([])).toBe('aucun');
});
```

```ts
// apps/api/src/suggestions/suggestions.e2e-spec.ts — vigilance 2
it('refuse une recherche quand le foyer est vide, sans appeler le modèle', async () => {
  // aucun lot en stock
  await agent.post('/api/v1/suggestions').send({ dishType: 'MAIN' }).expect(422);
  expect(geminiStub.calls).toHaveLength(0);
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Commandes : `npm test -w @kitchen/shared -- household-inventory`, `npm test -w @kitchen/api -- suggestions.e2e`

- [ ] **Étape 3 : implémenter `loadHouseholdProducts`**

Une requête Prisma sur les lots **actifs** (non archivés, `quantity > 0`),
jointe à `Product` et `Location`, rendant un produit par ligne, dédoublonné par
produit, emplacements triés et dédoublonnés. **Aucun filtre sur la péremption** :
les dates n'interviennent pas dans le module recettes (cahier, section 12,
amendement du 2026-10-04), et la spec interdit de les envoyer. Tri par nom de
produit, `localeCompare('fr')`, pour que deux appels successifs envoient le même
texte.

- [ ] **Étape 4 : implémenter `formatHouseholdInventory`**

Une ligne par produit, `Nom (Emplacement, Emplacement)`. `'aucun'` pour une
liste vide.

- [ ] **Étape 5 : brancher les deux chemins existants**

`SuggestionRequest.seeds` devient `household: string`. `buildSuggestionPrompt`
et `buildVoicePrompt` annoncent « Produits présents dans le foyer » et précisent
que les quantités disponibles ne sont pas fournies — le modèle ne doit donc
jamais dire qu'il en manque. La garde du foyer vide remplace
`insufficientStock` sur `pickSeedIngredients`, et vaut pour `list` comme pour
`listFromVoice` (où un placard vide était toléré : il ne l'est plus, la phrase
seule ne suffit pas à cette livraison).

- [ ] **Étape 6 : supprimer la sélection de graines**

`pickSeedIngredients`, `isStructuring`, `NON_STRUCTURING_CATEGORIES`,
`NON_STRUCTURING_PRODUCT_WORDS`, `SEED_MAX`, `SeedCandidate`,
`loadSeedCandidates`, leurs exports et leurs tests. Vérifier qu'aucun appelant
ne reste : `grep -rn "pickSeedIngredients\|SEED_MAX\|loadSeedCandidates" .`

- [ ] **Étape 7 : vérifier**

Commandes : `npm run typecheck && npm test -w @kitchen/shared && npm test -w @kitchen/api`

- [ ] **Étape 8 : README** — le modèle reçoit la liste des produits du foyer, sans quantités ni dates, au lieu de huit ingrédients choisis automatiquement.

- [ ] **Étape 9 : commit**

```bash
git commit -am "feat(suggestions): tout le placard au modèle, sans quantités ni dates (EF-26)"
```

---

## Task 4 — la route « une recette »

**Fichiers :**
- Modifier : `packages/shared/src/schemas/suggestions.ts` (`singleRecipeModelSchema`, `recipeRequestSchema`, `SingleRecipeDto`)
- Modifier : `packages/shared/src/rules/ai-requests.ts` (`AI_REQUEST_KINDS`, `SCREENS`, `BODIES`, `CARRIES_ID`, `title()`)
- Créer : `prisma/migrations/0018_recipe_request/migration.sql`
- Modifier : `prisma/schema.prisma` (enum `AiRequestKind`)
- Modifier : `apps/api/src/suggestions/prompt.ts` (`buildSingleRecipePrompt`)
- Modifier : `apps/api/src/suggestions/gemini-suggestion.provider.ts` (`suggestOne`)
- Modifier : `apps/api/src/suggestions/suggestions.service.ts` (`requestOne`)
- Modifier : `apps/api/src/suggestions/suggestions.controller.ts`
- Modifier : `e2e/fixtures/stub-server.ts` + `e2e/fixtures/suggestions/gemini-one.json`
- Test : `apps/api/src/suggestions/suggestions.e2e-spec.ts`, `gemini-suggestion.provider.spec.ts`

**Interfaces :**
- Consomme : `notes` (tâche 2), `SuggestionRequest.household` et
  `formatHouseholdInventory` (tâche 3).
- Produit : `POST /suggestions/request`, corps
  `{ text: string; requestId?: string }` validé par `recipeRequestSchema`,
  réponse `SingleRecipeDto = { heard: VoiceHeard; recipe: SuggestionDto }`.
  `SuggestionsService.requestOne(text: string): Promise<SingleRecipeDto>`.
  La tâche 5 réemploie la même réponse, la tâche 6 appelle la route.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// apps/api/src/suggestions/suggestions.e2e-spec.ts
it('rend une seule recette, composée, avec ses remarques', async () => {
  const res = await agent.post('/api/v1/suggestions/request')
    .send({ text: 'une recette asiatique avec de la cacahuète et de l’ail' }).expect(200);
  expect(res.body.recipe.provenance).toBe('ai');
  expect(res.body.recipe.sourceUrl).toBeNull();
  expect(res.body.recipe.notes).toBeTruthy();
  expect(res.body.heard.ingredients).toContain('cacahuète');
});

it('conserve la recette rendue sans rappeler le modèle', async () => {
  const res = await agent.post('/api/v1/suggestions/request').send({ text: 'un gratin' }).expect(200);
  await agent.post('/api/v1/suggestions/keep').send({ suggestionId: res.body.recipe.id }).expect(201);
});

// Vigilance 1 : une phrase qui ne demande pas une recette.
it('refuse en français une phrase dont rien n’est tiré', async () => {
  const res = await agent.post('/api/v1/suggestions/request').send({ text: 'bonjour' }).expect(422);
  expect(res.body.message).toMatch(/pas (été )?comprise/i);
});

it('refuse sans session', async () => {
  await t.api.post('/api/v1/suggestions/request').send({ text: 'un gratin' }).expect(401);
});
```

```ts
// apps/api/src/suggestions/gemini-suggestion.provider.spec.ts
it('n’autorise pas la recherche web sur une demande unique', () => {
  const prompt = buildSingleRecipePrompt({ text: 'un gratin', household: 'Beurre (Réfrigérateur)' });
  expect(prompt).toContain('composée par toi');
  expect(prompt).not.toContain('recherche web');
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Commande : `npm test -w @kitchen/api -- suggestions`

- [ ] **Étape 3 : migration Prisma pour le nouveau genre de demande**

`ALTER TYPE "AiRequestKind" ADD VALUE 'RECIPE_REQUEST';` dans
`prisma/migrations/0018_recipe_request/migration.sql`, et la valeur dans
`prisma/schema.prisma:648`. Réutiliser `SUGGESTIONS` était tentant, mais son
rejoueur (`suggestions.controller.ts`, `onModuleInit`) appelle
`suggestions.list()` et rendrait une fournée au rejeu d'une demande différée.

- [ ] **Étape 4 : le genre dans `packages/shared/src/rules/ai-requests.ts`**

`RECIPE_REQUEST` dans `AI_REQUEST_KINDS`, `SCREENS` (l'écran de réponse),
`BODIES` (« Touchez pour la voir. »), `CARRIES_ID` (comme `VOICE` : le résultat
n'est pas retrouvable au réservoir par l'orientation), et `title()` au
singulier — « Votre recette est prête ».

- [ ] **Étape 5 : le schéma de la réponse du modèle**

`singleRecipeModelSchema` : `{ heard: voiceHeardSchema, recipe: unknown }`,
la recette validée par `modelRecipeSchema`, un échec devenant
`InvalidBatchJsonError` comme pour `voiceModelBatchSchema`. `recipeRequestSchema`
pour le corps de la requête : `text` borné (160 caractères), `requestId`
facultatif.

- [ ] **Étape 6 : la consigne**

`buildSingleRecipePrompt(req: { text: string; household: string })` :
l'inventaire du foyer, la phrase telle quelle, **une seule** recette, toujours
`provenance: 'ai'` et `sourceUrl: null`, `heard` relevé de la phrase, et
`QUALITY_RULES` partagé avec les fournées. Pas de `SUGGESTION_DIVERSITY_RULE`,
pas de `knownTitles` : il n'y a qu'une recette.

- [ ] **Étape 7 : `suggestOne` et `requestOne`**

`suggestOne` sur le fournisseur, calqué sur `suggestFromVoice` mais sans audio
et sans recherche web. `requestOne` sur le service, calqué sur `listFromVoice`
(`:460-525`) : quota vérifié avant l'appel, `GeminiService.call`, tentatives
journalisées, ingestion au réservoir, relecture par `findByIdentity`, `declared`
alimenté par `heard`. **Aucun plancher de réservoir, aucun TTL d'orientation,
aucune ligne `SuggestionBatch`** : une question posée appelle le modèle,
toujours.

**`provenance: 'ai'` est forcé** : une recette `web` est jetée par
`SuggestionPoolService.ingestOne` quand sa page est illisible, et jetée sans
lecture quand `suggestionWebSearch` est éteint — ce qui est le cas en
production. Avec une seule recette, l'appel payé ne laisserait rien à l'écran.

- [ ] **Étape 8 : la route**

`POST /suggestions/request`, `@HttpCode(200)`, `DeferralService.track` avec le
genre `RECIPE_REQUEST` et son rejoueur dans `onModuleInit`. **Le même
`@Throttle({ default: { limit: 5, ttl: 60_000 } })` que `POST /suggestions/voice`**,
dans le même compartiment : deux compartiments séparés feraient dix appels par
minute.

- [ ] **Étape 9 : la doublure Gemini**

`e2e/fixtures/stub-server.ts:183` route aujourd'hui sur
`isSuggestionRequest = !isVisionRequest` et sert toujours
`suggestions/gemini-batch.json`. Ajouter un discriminant sur la consigne de la
demande unique, et une fixture `suggestions/gemini-one.json` portant une recette
et ses `notes`.

- [ ] **Étape 10 : vérifier**

Commandes : `npm run typecheck && npm test -w @kitchen/api && npm run prisma -- migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`
Attendu : tests SUCCÈS, aucune dérive de migration.

- [ ] **Étape 11 : commit**

```bash
git commit -am "feat(suggestions): une recette à la demande écrite (EF-25)"
```

---

## Task 5 — la voix rend une recette

**Fichiers :**
- Modifier : `packages/shared/src/schemas/suggestions.ts` (`voiceModelBatchSchema` → une recette ; `VoiceSuggestionBatchDto` retiré)
- Modifier : `apps/api/src/suggestions/suggestion-provider.ts` (`VoiceSuggestionOutput`)
- Modifier : `apps/api/src/suggestions/gemini-suggestion.provider.ts`, `prompt.ts` (`buildVoicePrompt`)
- Modifier : `apps/api/src/suggestions/suggestions.service.ts` (`listFromVoice` → `requestOneFromVoice`)
- Modifier : `apps/api/src/suggestions/suggestions.controller.ts:105`
- Créer : `apps/web/src/screens/suggestions/single-recipe-screen.tsx` + test
- Modifier : `apps/web/src/screens/suggestions/voice-request-screen.tsx`, `apps/web/src/lib/suggestions-api.ts`
- Test : `apps/api/src/suggestions/suggestions.e2e-spec.ts`, `voice-request-screen.test.tsx`

**Interfaces :**
- Consomme : `SingleRecipeDto` et `requestOne` (tâche 4).
- Produit : `POST /suggestions/voice` rend `SingleRecipeDto`.
  `SingleRecipeScreen` affiche une recette et ses remarques, partagé par les
  deux entrées — la tâche 6 l'emploie pour l'entrée écrite.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
// apps/api/src/suggestions/suggestions.e2e-spec.ts
it('la demande parlée rend une seule recette', async () => {
  const res = await agent.post('/api/v1/suggestions/voice')
    .attach('audio', audioFixture, { contentType: 'audio/webm' }).expect(200);
  expect(res.body.recipe.provenance).toBe('ai');
  expect(res.body.items).toBeUndefined();
});
```

```tsx
// apps/web/src/screens/suggestions/voice-request-screen.test.tsx — vigilance 4
it('relit un résultat différé de l’ancienne forme sans casser', () => {
  // status.result porte { heard, items: [...] } : l'écran affiche un message
  // de demande expirée plutôt que de planter sur recipe.title.
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Commandes : `npm test -w @kitchen/api -- suggestions.e2e`, `npm test -w @kitchen/web -- voice-request`

- [ ] **Étape 3 : une recette au lieu d'une fournée côté modèle**

`voiceModelBatchSchema` devient `{ heard, recipe }` sur le modèle de
`singleRecipeModelSchema` (tâche 4). `buildVoicePrompt` demande une seule
recette composée, sans recherche web, avec l'inventaire du foyer. Le refus
existant (`heard` vide des deux côtés) est conservé tel quel.

- [ ] **Étape 4 : le service et la route**

`listFromVoice` devient `requestOneFromVoice(audio, mimeType)` et partage avec
`requestOne` tout ce qui suit l'appel : ingestion, relecture, `declared`, rendu.
`VoiceSuggestionBatchDto` disparaît au profit de `SingleRecipeDto`.

- [ ] **Étape 5 : l'écran de réponse**

`SingleRecipeScreen` : les remarques, puis la recette (réemployant le tiroir de
suggestion existant pour les ingrédients, les étapes et la conservation).
`voice-request-screen.tsx` l'affiche en montrant en plus ce qui a été entendu.
**Le bouton « Proposer d'autres recettes » disparaît** : il était bâti sur
`heard.ingredients` + `suggestionsApi.list({ ingredients })`, supprimés en
tâche 6.

- [ ] **Étape 6 : les résultats différés de l'ancienne forme**

`status.result` lu en base peut porter `{ heard, items: [...] }`, écrit avant
cette livraison. L'écran le détecte (absence de `recipe`) et affiche une phrase
en français invitant à refaire la demande, au lieu de lire `recipe.title` sur
`undefined`.

- [ ] **Étape 7 : vérifier**

Commandes : `npm run typecheck && npm test -w @kitchen/api && npm test -w @kitchen/web`

- [ ] **Étape 8 : README** — la demande parlée rend une recette et non une liste.

- [ ] **Étape 9 : commit**

```bash
git commit -am "feat(suggestions): la demande parlée rend une recette détaillée (EF-25)"
```

---

## Task 6 — le champ de texte libre

**Fichiers :**
- Créer : `apps/web/src/screens/suggestions/request-field.tsx` + test
- Supprimer : `apps/web/src/screens/suggestions/ingredients-field.tsx` + test
- Modifier : `apps/web/src/screens/suggestions/suggestions-screen.tsx`
- Modifier : `apps/web/src/lib/suggestions-api.ts` (`SuggestionOrientation.ingredients` retiré, `request()` ajouté)
- Supprimer : `packages/shared/src/rules/suggestion-ingredients.ts` + test
- Modifier : `packages/shared/src/schemas/suggestions.ts` (`suggestionIngredientsSchema:77`, `SuggestionQuery.ingredients:144`)
- Modifier : `apps/api/src/suggestions/suggestions.service.ts` (`PoolFilter.ingredients`, `recipeUsesAllTerms`, signature)
- Modifier : `apps/api/src/suggestions/prompt.ts` (ingrédients imposés)
- Test : `apps/web/src/screens/suggestions/suggestions-screen.test.tsx`

**Interfaces :**
- Consomme : `POST /suggestions/request` (tâche 4), `SingleRecipeScreen` (tâche 5).

- [ ] **Étape 1 : écrire les tests qui échouent**

```tsx
// apps/web/src/screens/suggestions/suggestions-screen.test.tsx
it('une phrase tapée part vers la route « une recette »', async () => {
  // saisie « un gratin de courgettes » + Chercher → POST /suggestions/request
});

it('un champ vide lance la fournée filtrée', async () => {
  // Chercher sans texte → POST /suggestions
});
```

- [ ] **Étape 2 : vérifier qu'ils échouent**

Commande : `npm test -w @kitchen/web -- suggestions-screen`

- [ ] **Étape 3 : le champ**

`RequestField` : un champ de texte libre, la phrase part telle quelle. Ni
pastilles, ni autocomplétion, ni `splitIngredientTerms`. Il garde la place du
contrôle `trailing` (le bouton « Filtres ») et le `enterKeyHint="search"`.

- [ ] **Étape 4 : l'arbitrage des deux chemins**

« Chercher » part vers `POST /suggestions/request` **si le champ porte du
texte**, et vers `POST /suggestions` s'il est vide. La barre d'orientation
déclenche la fournée comme aujourd'hui.

- [ ] **Étape 5 : supprimer les ingrédients imposés**

`suggestionIngredientsSchema`, `SuggestionQuery.ingredients`,
`SuggestionOrientation.ingredients`, `PoolFilter.ingredients`,
`recipeUsesAllTerms`, `packages/shared/src/rules/suggestion-ingredients.ts`,
la notion d'« ingrédients imposés » de `buildSuggestionPrompt` et
`SuggestionRequest.ingredients`. **`declared` reste** sur
`SuggestionIngredientDto` : il est désormais alimenté par `heard`.

- [ ] **Étape 6 : `SUGGESTION_SIGNATURE_VERSION` passe de `v5` à `v6`**

`v5` avait été créée pour inclure ces ingrédients dans la signature
d'orientation. Sans changement de version, les lignes `SuggestionBatch`
existantes désigneraient une orientation qui n'existe plus.

- [ ] **Étape 7 : vérifier**

Commandes : `npm run typecheck && npm run lint && npm test`
Attendu : SUCCÈS, et aucun appelant restant —
`grep -rn "suggestionIngredientsSchema\|recipeUsesAllTerms\|splitIngredientTerms" .`

- [ ] **Étape 8 : README** — le champ de Suggestions attend une phrase, plus une liste d'ingrédients.

- [ ] **Étape 9 : commit**

```bash
git commit -am "feat(suggestions): une phrase au lieu d'une liste d'ingrédients (EF-25)"
```

---

## Task 7 — le cahier des charges et le parcours bout en bout

**Fichiers :**
- Modifier : `docs/cahier-des-charges.md` (sections 12, 26, EF-26)
- Modifier : `README.md` (section « Derniers changements »)
- Créer : `e2e/p8-recette-a-la-demande.spec.ts`

- [ ] **Étape 1 : amender le cahier des charges**

Section 26, daté du 2026-11-24, et les sections concernées :

- **Section 12 et EF-26** : « À partir d'une sélection d'ingrédients composée
  automatiquement depuis le stock » devient : à partir de la liste des produits
  présents dans le foyer, sans quantités ni dates.
- **Section 12, amendement du 2026-10-04 sur la péremption** : confirmé, pas
  touché. Les dates restent hors du module recettes.
- **Section 12** : la demande en langage naturel, parlée ou écrite, rend une
  recette unique et non une fournée.

- [ ] **Étape 2 : écrire le parcours P8**

Une phrase tapée, une recette rendue avec ses remarques, sa conservation dans
« Mes recettes », et l'équivalent ménager visible sur la fiche. Doublure Gemini
locale (tâche 4), jamais de réseau réel.

- [ ] **Étape 3 : jouer le parcours**

Commande : `npm run e2e -- p8-recette-a-la-demande`
Attendu : SUCCÈS. (CI uniquement si aucun moteur de conteneurs n'est
disponible localement — voir `docs/specs/2026-10-04-tests-bout-en-bout.md`.)

- [ ] **Étape 4 : la ligne de changelog du README**

Une ligne dans « Derniers changements », la plus récente en tête, avec le lien
vers `CHANGELOG.md`.

- [ ] **Étape 5 : vérifier l'ensemble**

Commandes : `npm run typecheck && npm run lint && npm test && npm test -w @kitchen/api`

- [ ] **Étape 6 : commit**

```bash
git commit -am "docs(recettes): la recette à la demande au cahier des charges (EF-25, EF-26)"
```
