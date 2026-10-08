# Recettes : complétude et usage — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rendre les recettes exploitables en cuisine — informations de cuisson complètes, ingrédients identifiables et localisables, notes retrouvables, quantités à l'échelle du nombre de parts.

**Architecture:** aucune nouvelle brique. On enrichit `ModelRecipe` et les DTO d'ingrédient existants, on ajoute une règle pure de mise à l'échelle dans `packages/shared`, et on modifie quatre écrans. Une seule migration Prisma, pour rien : aucun champ nouveau en base, `prepMinutes` et `cookMinutes` existent déjà.

**Tech Stack:** NestJS 12 + Prisma 6 + PostgreSQL 16, React 19 + Vite + Tailwind 4, Zod 4, Vitest 4.

**Spec:** `docs/specs/2026-10-08-recettes-completude-et-usage.md`

## Global Constraints

- TypeScript strict, `any` interdit hors tests. `noUncheckedIndexedAccess` est actif.
- Anglais pour le code et les identifiants, français pour les libellés d'interface et les messages d'erreur.
- Les règles métier vivent dans des fonctions pures testées de `packages/shared/src/rules/`, jamais recopiées dans un composant ou un contrôleur.
- Schémas Zod définis une seule fois dans `packages/shared`, réutilisés côté front.
- Aucun test ne dépend du réseau : réponses de Gemini rejouées depuis `apps/api/test/fixtures/`.
- Toute cible tactile fait au moins `min-h-touch`. La couleur ne porte jamais seule une information.
- `npm run build -w @kitchen/shared` après toute modification de `packages/shared`, avant de relancer les tests des autres paquets.
- Chaque tâche finit par un commit en français citant son exigence (`feat(recipes): … (EF-25)`).
- `README.md` et la ligne de changelog sont mis à jour par la DERNIÈRE tâche seulement, pas par chacune.

## Review Focus

Classes d'entrée que la spec implique mais qu'aucune tâche n'exerce spontanément :

1. Un ingrédient sans produit rapproché (`productId: null`) dans toutes les nouvelles colonnes : photo, emplacement, mise à l'échelle. C'est le cas le plus fréquent d'une suggestion. → tâches 2, 3, 7.
2. Une quantité `null` (« une pincée ») passée à la mise à l'échelle : doit rester `null`, jamais `0` ni `NaN`. → tâche 7.
3. Un nombre de parts à 1 et à 50 (bornes du schéma), et la valeur 0 ou négative refusée. → tâches 7, 8.
4. Un produit rapproché dont le lot est dans un emplacement sans température renseignée (`null`). → tâches 2, 3.
5. Une recette jamais réalisée (`timesCooked: 0`, note `null`) sur une carte. → tâche 4.

---

### Task 1 : durées séparées et complétude des étapes (A1–A4)

**Files:**
- Modify: `packages/shared/src/schemas/suggestions.ts` (`modelRecipeBaseSchema`, `SuggestionDto`)
- Modify: `apps/api/src/suggestions/prompt.ts` (`SUGGESTION_SYSTEM_PROMPT`, `SUGGESTION_SYSTEM_PROMPT_NO_SEARCH`, `buildSuggestionPrompt`)
- Modify: `apps/api/src/suggestions/gemini-recipe-rewriter.ts` (prompt de réécriture)
- Modify: `apps/api/src/suggestions/suggestions.service.ts` (`SUGGESTION_SIGNATURE_VERSION` → `'v3'`, mapping DTO, draft de conservation)
- Modify: toutes les fixtures `apps/api/test/fixtures/suggestions/gemini-batch*.json`
- Test: `packages/shared/src/schemas/suggestions.test.ts`, `apps/api/src/suggestions/suggestions.e2e-spec.ts`

**Interfaces:**
- Produces: `ModelRecipe.prepMinutes: number | null`, `ModelRecipe.cookMinutes: number | null`, `SuggestionDto.prepMinutes`, `SuggestionDto.cookMinutes`. `totalMinutes` reste et demeure la durée affichée sur les cartes.

- [ ] **Step 1 : écrire le test de schéma qui échoue**

Dans `packages/shared/src/schemas/suggestions.test.ts` :

```ts
it('accepte des durées de préparation et de cuisson séparées', () => {
  const recipe = { ...validWebRecipe, prepMinutes: 10, cookMinutes: 25 };
  expect(modelRecipeSchema.parse(recipe).cookMinutes).toBe(25);
});

it('accepte une recette sans détail de durée : seul le total est exigé', () => {
  // Une salade n'a pas de cuisson ; le modèle doit pouvoir le dire par `null`
  // plutôt que d'inventer un zéro qui se lirait « cuisson : 0 minute ».
  const recipe = { ...validWebRecipe, prepMinutes: null, cookMinutes: null };
  expect(modelRecipeSchema.safeParse(recipe).success).toBe(true);
});
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

`npx vitest run --root packages/shared src/schemas/suggestions.test.ts`
Attendu : ÉCHEC, `prepMinutes` inconnu du schéma.

- [ ] **Step 3 : ajouter les champs au schéma**

Dans `modelRecipeBaseSchema`, après `totalMinutes` :

```ts
  /**
   * Préparation et cuisson séparées, `null` quand la recette n'en a pas (une
   * salade n'a pas de cuisson) ou quand le modèle ne les distingue pas. Jamais
   * `0` : zéro minute de cuisson et pas de cuisson ne se lisent pas pareil.
   * `totalMinutes` reste la durée de référence affichée sur les cartes.
   */
  prepMinutes: z.number().int().positive().max(1440).nullable(),
  cookMinutes: z.number().int().positive().max(1440).nullable(),
```

- [ ] **Step 4 : relancer, vérifier que les tests passent**

- [ ] **Step 5 : exiger la complétude dans le prompt système**

Ajouter aux DEUX prompts système (`SUGGESTION_SYSTEM_PROMPT` et `SUGGESTION_SYSTEM_PROMPT_NO_SEARCH`) la phrase :

```
Chaque étape doit être réalisable sans rien deviner : indique la température du four en degrés Celsius, l'intensité du feu (doux, moyen, vif) et la durée de l'étape chaque fois que la cuisson l'exige. Une étape de cuisson sans température ni durée est inutilisable.
```

Et dans `buildSuggestionPrompt`, compléter la ligne décrivant le format JSON :
`prepMinutes` et `cookMinutes` (entiers en minutes, ou null).

- [ ] **Step 6 : exiger la même chose à la réécriture d'une page web (A4)**

Même phrase dans le prompt de `gemini-recipe-rewriter.ts`, et `prepMinutes` / `cookMinutes` dans son schéma de sortie si celui-ci les porte ; sinon conserver la durée telle qu'extraite.

- [ ] **Step 7 : mettre les fixtures à jour**

Ajouter `"prepMinutes"` et `"cookMinutes"` à chaque recette des fixtures `gemini-batch*.json`, avec des valeurs cohérentes avec `totalMinutes` (leur somme ne doit pas le dépasser). Au moins une recette garde `null` sur les deux, pour couvrir le cas sans cuisson.

- [ ] **Step 8 : porter les durées jusqu'au DTO et à la recette conservée**

Dans `suggestions.service.ts` : ajouter `prepMinutes` et `cookMinutes` au `SuggestionDto` construit, et au `draft` de `buildCreateInput` (la recette conservée a déjà ces deux champs en base, aujourd'hui laissés vides). Passer `SUGGESTION_SIGNATURE_VERSION` à `'v3'`.

- [ ] **Step 9 : test de bout en bout de la conservation**

Dans `suggestions.e2e-spec.ts`, au test « conserve une composition sans appeler le réseau » :

```ts
expect(recipe.prepMinutes).toBe(AI_RECIPE.prepMinutes);
expect(recipe.cookMinutes).toBe(AI_RECIPE.cookMinutes);
```

- [ ] **Step 10 : types, lint, tests, commit**

```bash
npm run build -w @kitchen/shared && npm run typecheck && npm run lint && npm test
git commit -am "feat(suggestions): durées de préparation et de cuisson séparées, étapes complètes (EF-25)"
```

---

### Task 2 : photo et emplacement dans les ingrédients, côté API (B, C)

**Files:**
- Modify: `packages/shared/src/schemas/suggestions.ts` (`SuggestionIngredientDto`)
- Modify: `packages/shared/src/schemas/recipes.ts` (`RecipeIngredientDto`)
- Modify: `apps/api/src/suggestions/suggestions.service.ts` (construction des lignes)
- Modify: `apps/api/src/recipes/recipes.service.ts` (idem)
- Modify: `apps/api/src/recipes/recipes.coverage.ts` si l'emplacement n'est pas déjà dans `StockEntry`
- Test: `apps/api/src/suggestions/suggestions.e2e-spec.ts`, `apps/api/src/recipes/recipes.e2e-spec.ts`

**Interfaces:**
- Consumes: `ModelRecipe` de la tâche 1 (aucun couplage, tâches indépendantes).
- Produces: sur `SuggestionIngredientDto` ET `RecipeIngredientDto` :
```ts
  /** Photo du produit rapproché, pour identifier le contenant d'un coup d'œil ; `null` sans produit. */
  productImagePath: string | null;
  /** Emplacement du lot qui sera consommé en premier ; `null` si l'ingrédient n'est pas en stock. */
  locationName: string | null;
  /** Clé de couleur de la pastille : la température de cet emplacement, `null` si non renseignée. */
  locationTemperature: 'ambient' | 'chilled' | 'frozen' | null;
```

- [ ] **Step 1 : écrire le test d'API qui échoue**

Dans `suggestions.e2e-spec.ts` :

```ts
it('donne la photo et l’emplacement du produit rapproché à chaque ingrédient', async () => {
  const { service, db } = await createService();
  const locationId = await seedLocation(db); // doit porter temperature: 'chilled'
  await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE', imagePath: 'scans/tomate.jpg' });
  http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

  const result = await service.list(QUERY, USER);
  const tomate = result.items.flatMap((i) => i.ingredients).find((i) => i.productName === 'Tomate');
  expect(tomate?.productImagePath).toBe('scans/tomate.jpg');
  expect(tomate?.locationName).toBeTruthy();
  expect(tomate?.locationTemperature).toBe('chilled');
});

it('laisse photo et emplacement à null pour un ingrédient hors stock', async () => {
  // Cas le plus fréquent d'une suggestion : l'ingrédient n'est pas au placard.
  const { service, db } = await createService();
  const locationId = await seedLocation(db);
  await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
  http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

  const result = await service.list(QUERY, USER);
  const absent = result.items.flatMap((i) => i.ingredients).find((i) => i.productId === null);
  expect(absent?.productImagePath).toBeNull();
  expect(absent?.locationName).toBeNull();
  expect(absent?.locationTemperature).toBeNull();
});
```

Adapter `seedLocation` / `seedProduct` si leurs signatures ne portent pas encore `temperature` et `imagePath`.

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : étendre les deux DTO partagés**

Ajouter les trois champs ci-dessus à `SuggestionIngredientDto` et `RecipeIngredientDto`, avec leurs commentaires.

- [ ] **Step 4 : remonter l'information depuis le stock**

`StockEntry` (dans `packages/shared/src/rules/coverage.ts`) porte déjà de quoi désigner le lot retenu. Si l'emplacement n'y figure pas, l'ajouter : `locationId`, `locationName`, `locationTemperature`, renseignés par `RecipesCoverageService.snapshot()` depuis la requête Prisma (inclure `location` dans le `include`).

Règle C4 : l'emplacement affiché est celui du lot qui sera consommé en premier. L'ordre de consommation est déjà celui du tri appliqué dans `snapshot()` — prendre le premier lot de la liste, ne pas réinventer un tri.

- [ ] **Step 5 : remplir les champs dans les deux services**

`suggestions.service.ts` et `recipes.service.ts`, là où les lignes d'ingrédient sont construites.

- [ ] **Step 6 : relancer les tests, vérifier qu'ils passent**

- [ ] **Step 7 : types, lint, tests, commit**

```bash
npm run build -w @kitchen/shared && npm run typecheck && npm run lint && npm test
git commit -am "feat(recipes): photo et emplacement du produit sur chaque ingrédient (EF-23)"
```

---

### Task 3 : ligne d'ingrédient — photo à droite et pastille d'emplacement (B, C)

**Files:**
- Modify: `apps/web/src/screens/recipe/ingredient-row.tsx`
- Modify: `apps/web/src/screens/suggestions/suggestion-sheet.tsx` (lignes d'ingrédient de la fiche)
- Create: `apps/web/src/components/ui/location-chip.tsx`
- Test: `apps/web/src/screens/recipe/ingredient-row.test.tsx`, `apps/web/src/components/ui/location-chip.test.tsx`

**Interfaces:**
- Consumes: `productImagePath`, `locationName`, `locationTemperature` de la tâche 2.
- Produces: `<LocationChip name={string} temperature={'ambient' | 'chilled' | 'frozen' | null} />`

- [ ] **Step 1 : écrire les tests de la pastille**

```ts
it('écrit le nom de l’emplacement, la couleur ne porte jamais seule l’information', () => {
  render(<LocationChip name="Réfrigérateur" temperature="chilled" />);
  expect(screen.getByText('Réfrigérateur')).toBeTruthy();
});

it('reste lisible sans température renseignée', () => {
  const { container } = render(<LocationChip name="Cellier" temperature={null} />);
  expect(screen.getByText('Cellier')).toBeTruthy();
  expect(container.firstElementChild?.className).toBeTruthy();
});
```

- [ ] **Step 2 : lancer, vérifier l'échec (composant absent)**

- [ ] **Step 3 : écrire `location-chip.tsx`**

Trois jeux de classes Tailwind, un par température, plus un repli neutre pour `null`. Utiliser les variables de thème existantes du projet (`bg-surface`, `text-muted`, etc.), ne pas introduire de couleur en dur hors palette.

- [ ] **Step 4 : tests de la ligne d'ingrédient**

```ts
it('affiche la photo du produit à droite, en élément décoratif', () => {
  render(<IngredientRow ingredient={{ ...base, productImagePath: 'scans/tomate.jpg' }} />);
  const img = document.querySelector('img');
  expect(img?.getAttribute('alt')).toBe('');
});

it('n’affiche ni photo ni cadre vide sans produit rapproché', () => {
  render(<IngredientRow ingredient={{ ...base, productImagePath: null }} />);
  expect(document.querySelector('img')).toBeNull();
});

it('affiche l’emplacement à côté de l’état disponible', () => {
  render(<IngredientRow ingredient={{ ...base, state: 'available', locationName: 'Réfrigérateur', locationTemperature: 'chilled' }} />);
  expect(screen.getByText('Réfrigérateur')).toBeTruthy();
});
```

- [ ] **Step 5 : implémenter**

Photo alignée à droite (`ml-auto`), taille fixe, `alt=""`, `loading="lazy"`. L'URL passe par `mediaUrl()` de `apps/web/src/lib/api.ts`, jamais construite à la main.

- [ ] **Step 6 : appliquer la même ligne à la fiche de suggestion**

- [ ] **Step 7 : types, lint, tests, commit**

```bash
npm run typecheck && npm run lint && npx vitest run --root apps/web
git commit -am "feat(web): photo du produit et pastille d'emplacement sur les ingrédients (EF-23)"
```

---

### Task 4 : notes et réalisations sur les cartes de « Mes recettes » (D1–D3)

**Files:**
- Modify: `apps/web/src/screens/recipes/recipe-card.tsx` (ou le composant de carte existant)
- Modify: `apps/web/src/screens/recipes/recipe-filters.tsx` (pastille « Déjà faites »)
- Modify: `packages/shared/src/schemas/recipes.ts` si le filtre `tag` n'accepte pas encore `cooked`
- Test: le test du composant de carte, `apps/web/src/screens/recipes/recipe-filters.test.tsx`

**Interfaces:**
- Consumes: `RecipeSummaryDto.stats` — déjà présent, rien à ajouter côté API.

- [ ] **Step 1 : tests de la carte**

```ts
it('affiche la note et le nombre de réalisations d’une recette déjà faite', () => {
  render(<RecipeCard recipe={{ ...base, stats: { ...stats, timesCooked: 3, averageRating: 4.5 } }} />);
  expect(screen.getByText(/4,5/)).toBeTruthy();
  expect(screen.getByText(/3 fois/)).toBeTruthy();
});

it('n’affiche ni note ni compteur pour une recette jamais réalisée', () => {
  // L'absence de trace se lit mieux que la trace d'une absence : pas de « 0 fois ».
  render(<RecipeCard recipe={{ ...base, stats: { ...stats, timesCooked: 0, averageRating: null } }} />);
  expect(screen.queryByText(/fois/)).toBeNull();
});
```

Adapter les noms de champs à ceux de `RecipeStatsDto` après lecture du type.

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : implémenter l'affichage**

- [ ] **Step 4 : ajouter la pastille « Déjà faites »**

Dans la PREMIÈRE rangée (`Pastilles rapides`), à côté de « Dignes de confiance » et « Prêtes ». Le filtre côté API s'appuie sur `stats.timesCooked > 0` ; si le schéma de requête ne porte pas de tag correspondant, l'ajouter à `recipeListQuerySchema` et le traiter dans `recipes.service.ts`.

- [ ] **Step 5 : test du filtre**

```ts
it('propose « Déjà faites » dans la première rangée', () => { /* … */ });
```

- [ ] **Step 6 : types, lint, tests, commit**

```bash
npm run build -w @kitchen/shared && npm run typecheck && npm run lint && npm test
git commit -am "feat(recipes): notes et réalisations visibles sur les cartes (EF-21)"
```

---

### Task 5 : noter une recette sans repasser par une cuisson (D4)

**Files:**
- Modify: `apps/web/src/screens/recipe/recipe-screen.tsx`
- Modify: `apps/web/src/screens/recipe/history-panel.tsx`
- Test: `apps/web/src/screens/recipe/recipe-screen.test.tsx` (le créer s'il n'existe pas)

- [ ] **Step 1 : test**

```ts
it('permet de noter une réalisation passée depuis la fiche, sans cuisiner', () => {
  // La notation ne doit plus être captive du tiroir de validation de cuisson.
  render(<RecipeScreen /* recette avec timesCooked: 2 */ />);
  fireEvent.click(screen.getAllByRole('button', { name: /Noter/i })[0]!);
  expect(screen.getByRole('dialog')).toBeTruthy();
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : implémenter**

`RatingSheet` est déjà monté dans `recipe-screen.tsx` et piloté par `ratingLog`. Exposer un bouton « Noter » sur chaque entrée de `HistoryPanel`, qui appelle `setRatingLog(log)`. Aucune route d'API nouvelle : la notation d'une réalisation existe déjà.

- [ ] **Step 4 : types, lint, tests, commit**

```bash
npm run typecheck && npm run lint && npx vitest run --root apps/web
git commit -am "feat(recipes): noter une réalisation passée depuis la fiche (EF-21)"
```

---

### Task 6 : « Plus d'informations » à la place de « Conserver » (E)

**Files:**
- Modify: `apps/web/src/screens/suggestions/suggestion-sheet.tsx`
- Modify: `apps/web/src/screens/suggestions/suggestions-screen.tsx` si le libellé y apparaît
- Test: `apps/web/src/screens/suggestions/suggestion-sheet.test.tsx`

- [ ] **Step 1 : test**

```ts
it('intitule le bouton principal « Plus d’informations »', () => {
  render(<SuggestionSheet {...props} />);
  expect(screen.getByRole('button', { name: /Plus d’informations/i })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Conserver$/ })).toBeNull();
});

it('propose la conservation une fois les informations affichées', () => { /* … */ });
```

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : implémenter (E2)**

Le tiroir affiche les informations complètes — étapes comprises, qui n'étaient pas montrées avant conservation. La conservation devient une action secondaire, proposée après ces informations, et conserve son comportement actuel (`clientOpId`, récupération et réécriture de page).

**Ruling à confirmer en revue :** la spec §E2 change la nature du geste mais ne dit pas si les étapes d'une recette `web` doivent être affichées avant conservation. Elles ne sont pas disponibles — la page n'est lue qu'à la conservation. Décision : afficher les étapes pour les compositions `ai` (elles sont dans la fournée), et pour une recette `web`, afficher ce que la fournée contient en annonçant que le détail viendra avec la conservation.

- [ ] **Step 4 : types, lint, tests, commit**

```bash
npm run typecheck && npm run lint && npx vitest run --root apps/web
git commit -am "feat(suggestions): « Plus d'informations » ouvre la fiche avant de conserver (EF-25)"
```

---

### Task 7 : mise à l'échelle par nombre de parts — règle pure et couverture (F2, F3)

**Files:**
- Create: `packages/shared/src/rules/servings.ts`
- Create: `packages/shared/src/rules/servings.test.ts`
- Modify: `packages/shared/src/rules/index.ts`
- Modify: `apps/api/src/recipes/recipes.service.ts` et `apps/api/src/suggestions/suggestions.service.ts` si la couverture doit accepter un nombre de parts
- Test: `apps/api/src/recipes/recipes.e2e-spec.ts`

**Interfaces:**
- Produces:
```ts
/** Ratio de mise à l'échelle, borné aux parts acceptées par le schéma (1 à 50). */
export function servingsRatio(target: number, base: number): number;

/** Quantités à l'échelle ; `null` reste `null` — « une pincée » ne se multiplie pas. */
export function scaleIngredients<T extends { quantity: number | null }>(ingredients: readonly T[], ratio: number): T[];
```

- [ ] **Step 1 : écrire les tests de la règle**

```ts
describe('servingsRatio', () => {
  it('rend 1 pour un nombre de parts inchangé', () => {
    expect(servingsRatio(4, 4)).toBe(1);
  });

  it('double pour deux fois plus de convives', () => {
    expect(servingsRatio(8, 4)).toBe(2);
  });

  it('refuse une base nulle plutôt que de rendre l’infini', () => {
    expect(servingsRatio(4, 0)).toBe(1);
  });

  it('borne aux parts acceptées par le schéma', () => {
    expect(servingsRatio(0, 4)).toBe(servingsRatio(1, 4));
    expect(servingsRatio(99, 4)).toBe(servingsRatio(50, 4));
  });
});

describe('scaleIngredients', () => {
  it('laisse une quantité absente absente : « une pincée » ne se multiplie pas', () => {
    expect(scaleIngredients([{ quantity: null }], 2)[0]!.quantity).toBeNull();
  });

  it('arrondit comme le reste de l’application', () => {
    // Même arrondi que `roundQuantity`, pour qu'une quantité ne s'affiche pas
    // différemment selon l'écran qui l'a calculée.
    expect(scaleIngredients([{ quantity: 1 }], 1 / 3)[0]!.quantity).toBe(roundQuantity(1 / 3));
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : écrire `servings.ts`**

Réutiliser `roundQuantity` de `packages/shared/src/rules/quantity.ts` ; ne pas réécrire d'arrondi.

- [ ] **Step 4 : exporter depuis `rules/index.ts`**

- [ ] **Step 5 : test d'API — la couverture suit les parts**

Dans `recipes.e2e-spec.ts` :

```ts
it('recalcule la couverture sur le nombre de parts demandé (F3)', async () => {
  // Une recette prête pour quatre ne l'est pas forcément pour huit : l'écran ne
  // doit pas continuer d'annoncer « prête » quand le stock ne suit plus.
  // recette : 4 parts, 200 g de riz ; stock : 300 g
  const pourQuatre = await /* GET recette */;
  expect(pourQuatre.group).toBe('ready');
  const pourHuit = await /* GET recette ?servings=8 */;
  expect(pourHuit.group).not.toBe('ready');
});
```

- [ ] **Step 6 : implémenter côté API**

Ajouter `servings` au schéma de requête concerné (`z.coerce.number().int().min(1).max(50).optional()`), appliquer `scaleIngredients` AVANT `recipeCoverage`. Ne pas modifier `coverage.ts` : la mise à l'échelle est une transformation en amont, la couverture reste une fonction de quantités données.

- [ ] **Step 7 : types, lint, tests, commit**

```bash
npm run build -w @kitchen/shared && npm run typecheck && npm run lint && npm test
git commit -am "feat(recipes): couverture recalculée sur le nombre de parts (EF-26)"
```

---

### Task 8 : sélecteur de parts à l'écran, et documentation du lot (F1, F4)

**Files:**
- Modify: `apps/web/src/screens/recipe/recipe-screen.tsx`
- Modify: `apps/web/src/screens/suggestions/suggestion-sheet.tsx`
- Modify: `apps/web/src/screens/recipe/cook-sheet.tsx` (reprendre le nombre choisi)
- Modify: `README.md`
- Test: `apps/web/src/screens/recipe/recipe-screen.test.tsx`

**Interfaces:**
- Consumes: `servingsRatio` et `scaleIngredients` de la tâche 7.

- [ ] **Step 1 : tests**

```ts
it('recalcule les quantités affichées quand le nombre de parts change', () => { /* … */ });

it('reprend le nombre de parts choisi au moment de cuisiner (F4)', () => {
  // Un seul nombre de parts du début à la fin, jamais deux à tenir.
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : implémenter le sélecteur**

Champ numérique, cible tactile `min-h-touch`, initialisé à `recipe.servings`. Le nombre choisi est passé à la requête (tâche 7) pour que la couverture suive, et à `CookSheet` comme valeur initiale de `servingsCooked`.

- [ ] **Step 4 : mettre à jour `README.md` pour TOUT le lot**

Section Fonctionnalités : complétude des étapes, photo et emplacement par ingrédient, notes sur les cartes, « Plus d'informations », nombre de parts. Et une ligne dans « Derniers changements », version la plus récente en tête.

- [ ] **Step 5 : types, lint, suite complète, commit**

```bash
npm run build -w @kitchen/shared && npm run typecheck && npm run lint && npm test
git commit -am "feat(recipes): nombre de parts ajustable à la sélection (EF-26)"
```
