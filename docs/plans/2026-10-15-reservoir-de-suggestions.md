# Réservoir permanent de suggestions — plan d'exécution

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — `superpowers:subagent-driven-development`.
> Les étapes sont en cases à cocher (`- [ ]`).

**Objectif :** les recettes rapportées par Gemini ne s'effacent plus jamais ; une
recette web n'est retenue que si sa page existe, et son contenu est recopié une
fois pour toutes ; Gemini n'est rappelé que si le réservoir ne suffit pas.

**Architecture :** une table `SuggestionPoolRecipe` (une ligne par recette, clé =
`suggestionIdentity`) remplit le rôle de cache permanent que `SuggestionBatch`
tenait sur 24 h. Le service lit le réservoir, filtre sur l'orientation, calcule
la couverture contre le stock du moment, trie, et n'appelle le modèle que sous
un seuil plancher ou sur relance explicite. `SuggestionBatch` reste comme
journal brut.

**Pile :** NestJS 12, Prisma 6, PostgreSQL 16, Zod 4, React 19, Vitest 4.

**Spec :** `docs/specs/2026-10-15-reservoir-de-suggestions.md` — lire D1 à D10
avant de commencer.

## Contraintes globales

- Français pour les libellés d'interface, les messages d'erreur et les
  commentaires ; anglais pour le code et les identifiants.
- TypeScript strict, `noUncheckedIndexedAccess` actif, `any` interdit hors tests.
- Toute règle métier pure vit dans `packages/shared`, testée, jamais recopiée
  dans un contrôleur ou un composant (CLAUDE.md).
- Aucun changement de schéma sans migration Prisma versionnée et commitée.
- Aucun test ne touche le réseau : page web et Gemini rejoués depuis des
  doublures locales.
- Chaque tâche finit par un commit dont le message cite `EF-25` ou `EF-26`.
- `README.md` et la ligne de changelog sont mis à jour par la tâche 8, pas par
  chaque tâche.
- Les commandes : `npm run build -w @kitchen/shared` avant les tests si le
  paquet partagé a changé ; `npm test -w @kitchen/api` ; `cd apps/web &&
  npx vitest run <chemin>` pour le front ; `npx tsc -p <projet> --noEmit`.

## Points de vigilance

Cinq cas que la spec implique et qu'aucun test existant n'exerce :

1. Une recette `web` dont la page répond mais ne porte pas de `schema.org/Recipe`
   → elle doit entrer au réservoir avec `pageText` rempli et `pageRecipe` à
   `null`, pas être jetée (tâche 3).
2. Une recette `web` dont l'URL est refusée pour raison de sécurité
   (`RecipePageRefusedError`, adresse privée, HTTP) → jetée sans faire échouer
   la fournée entière (tâche 3).
3. Deux fournées successives rapportant la même recette → une seule ligne,
   `lastSeenAt` mis à jour, aucune erreur de clé unique (tâche 3).
4. Un réservoir qui contient assez de recettes pour l'orientation demandée →
   **aucun appel à Gemini**, et le quota journalier n'est pas entamé (tâche 4).
5. Conserver une recette `web` dont le réservoir porte les données structurées
   → ni requête réseau, ni appel de réécriture (tâche 6).

---

### Tâche 1 : Règle de tri du réservoir

**Fichiers :**
- Créer : `packages/shared/src/rules/suggestion-pool.ts`
- Créer : `packages/shared/src/rules/suggestion-pool.test.ts`
- Modifier : `packages/shared/src/index.ts` (ajouter l'export)

**Interfaces :**
- Produit : `comparePoolEntries(a: PoolEntryForSort, b: PoolEntryForSort): number`
  et le type `PoolEntryForSort`. Consommé par la tâche 4.

- [ ] **Étape 1 : écrire le test qui échoue**

`packages/shared/src/rules/suggestion-pool.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { comparePoolEntries, type PoolEntryForSort } from './suggestion-pool.js';

const entry = (over: Partial<PoolEntryForSort>): PoolEntryForSort => ({
  verified: false,
  coverage: 0,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('comparePoolEntries (EF-26, D7)', () => {
  it('place une recette web vérifiée avant une composition, même moins couverte', () => {
    const web = entry({ verified: true, coverage: 0.2 });
    const compo = entry({ verified: false, coverage: 1 });
    expect(comparePoolEntries(web, compo)).toBeLessThan(0);
    expect(comparePoolEntries(compo, web)).toBeGreaterThan(0);
  });

  it('à statut égal, la meilleure couverture passe devant', () => {
    expect(comparePoolEntries(entry({ coverage: 0.8 }), entry({ coverage: 0.4 }))).toBeLessThan(0);
  });

  it('à couverture égale, la plus récemment découverte passe devant', () => {
    const vieille = entry({ firstSeenAt: '2026-01-01T00:00:00.000Z' });
    const neuve = entry({ firstSeenAt: '2026-06-01T00:00:00.000Z' });
    expect(comparePoolEntries(neuve, vieille)).toBeLessThan(0);
  });

  it('est un ordre total stable : comparer une entrée à elle-même rend zéro', () => {
    const e = entry({ verified: true, coverage: 0.5 });
    expect(comparePoolEntries(e, e)).toBe(0);
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

`npx vitest run packages/shared/src/rules/suggestion-pool.test.ts`
Attendu : ÉCHEC, module introuvable.

- [ ] **Étape 3 : écrire l'implémentation minimale**

`packages/shared/src/rules/suggestion-pool.ts` :

```ts
/**
 * Ordre d'affichage du réservoir de suggestions (EF-26, décision D7 du
 * 2026-10-15).
 *
 * Une recette web vérifiée passe avant une composition du modèle quelle que
 * soit sa couverture : la demande de djkix porte d'abord sur l'existence de
 * la recette, la couverture ne départage qu'à statut égal. Puis, à couverture
 * égale, la plus récemment découverte — sans quoi le réservoir, qui ne
 * s'efface jamais, figerait pour toujours le haut de la liste sur ses plus
 * vieilles entrées.
 */
export interface PoolEntryForSort {
  /** Page source lue avec succès à l'ingestion ; faux pour une composition du modèle. */
  verified: boolean;
  /** Couverture calculée contre le stock du moment, entre 0 et 1. */
  coverage: number;
  /** Date ISO de première apparition dans le réservoir. */
  firstSeenAt: string;
}

export function comparePoolEntries(a: PoolEntryForSort, b: PoolEntryForSort): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  return b.firstSeenAt.localeCompare(a.firstSeenAt);
}
```

- [ ] **Étape 4 : lancer le test, vérifier qu'il passe**

`npx vitest run packages/shared/src/rules/suggestion-pool.test.ts` → 4 tests verts.

- [ ] **Étape 5 : exporter depuis le paquet**

Ajouter dans `packages/shared/src/index.ts`, à côté des autres règles :

```ts
export * from './rules/suggestion-pool.js';
```

Puis `npm run build -w @kitchen/shared` et `npx tsc -p packages/shared/tsconfig.json --noEmit`.

- [ ] **Étape 6 : commit**

```bash
git add packages/shared
git commit -m "feat(shared): règle de tri du réservoir de suggestions (EF-26)"
```

---

### Tâche 2 : Table du réservoir

**Fichiers :**
- Modifier : `prisma/schema.prisma` (nouveau modèle, après `model SuggestionBatch`)
- Créer : `prisma/migrations/0009_suggestion_pool/migration.sql`

**Interfaces :**
- Produit : le modèle Prisma `SuggestionPoolRecipe`, consommé par les tâches 3, 4 et 6.

- [ ] **Étape 1 : ajouter le modèle**

Dans `prisma/schema.prisma`, juste après `model SuggestionBatch { … }` :

```prisma
model SuggestionPoolRecipe {
  id         String     @id @default(cuid())
  identity   String     @unique
  /// La `ModelRecipe` validée, telle qu'elle sera revalidée à la lecture.
  payload    Json
  provenance String
  dishType   DishType
  sourceUrl  String?
  /// Date de lecture réussie de la page source ; `null` pour une composition
  /// du modèle, qui n'a rien à vérifier (décision D5).
  verifiedAt DateTime?
  /// `schema.org/Recipe` lu sur la page, gardé pour que la conservation ne
  /// rappelle jamais le site (décision D10).
  pageRecipe Json?
  /// Texte nettoyé de la page (plafonné à 8 000 caractères par le lecteur),
  /// repli quand la page ne porte pas de données structurées.
  pageText    String?
  model       String
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())

  @@index([dishType])
  @@index([firstSeenAt])
}
```

- [ ] **Étape 2 : écrire la migration à la main**

`prisma/migrations/0009_suggestion_pool/migration.sql` :

```sql
-- Réservoir permanent des suggestions (EF-26, spec du 2026-10-15). Une ligne
-- par recette, clé de dédoublonnage `identity` = `suggestionIdentity` partagée
-- (titre normalisé + URL source). Rien n'est jamais effacé : décision D1,
-- « pas d'âge max, tu logges tout ». `verifiedAt` reste NULL pour une
-- composition du modèle, qui n'a pas de page à vérifier. `pageRecipe` et
-- `pageText` recopient le contenu lu une seule fois (D10), pour que la
-- conservation d'une recette web ne rappelle plus jamais le site.

-- CreateTable
CREATE TABLE "SuggestionPoolRecipe" (
    "id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "provenance" TEXT NOT NULL,
    "dishType" "DishType" NOT NULL,
    "sourceUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "pageRecipe" JSONB,
    "pageText" TEXT,
    "model" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionPoolRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionPoolRecipe_identity_key" ON "SuggestionPoolRecipe"("identity");

-- CreateIndex
CREATE INDEX "SuggestionPoolRecipe_dishType_idx" ON "SuggestionPoolRecipe"("dishType");

-- CreateIndex
CREATE INDEX "SuggestionPoolRecipe_firstSeenAt_idx" ON "SuggestionPoolRecipe"("firstSeenAt");
```

- [ ] **Étape 3 : vérifier qu'il n'y a pas de dérive**

```bash
npx prisma generate
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
```

Attendu : aucune différence. Si la CI du dépôt joue la dérive autrement, suivre
la commande du job `migrations` dans `.github/workflows/`.

- [ ] **Étape 4 : commit**

```bash
git add prisma
git commit -m "feat(suggestions): table du réservoir permanent de recettes (EF-26)"
```

---

### Tâche 3 : Ingestion — vérifier la page, recopier son contenu, écrire au réservoir

**Fichiers :**
- Créer : `apps/api/src/suggestions/suggestion-pool.service.ts`
- Créer : `apps/api/src/suggestions/suggestion-pool.service.spec.ts`
- Modifier : `apps/api/src/suggestions/suggestions.module.ts` (déclarer le service)

**Interfaces :**
- Consomme : `RecipePageFetcher` (jeton d'injection `RECIPE_PAGE_FETCHER`),
  `RecipePageRefusedError`, `suggestionIdentity`, `modelRecipeSchema`.
- Produit :
  - `SuggestionPoolService.ingest(recipes: readonly ModelRecipe[], model: string): Promise<number>`
    — rend le nombre de recettes retenues.
  - `SuggestionPoolService.read(filter): Promise<PoolRecipe[]>` (tâche 4 l'étend ;
    ici, écrire la forme minimale ci-dessous).
  - `interface PoolRecipe { identity: string; recipe: ModelRecipe; verified: boolean; firstSeenAt: string; pageRecipe: PageRecipe | null; pageText: string | null }`

- [ ] **Étape 1 : écrire les tests qui échouent**

`apps/api/src/suggestions/suggestion-pool.service.spec.ts`. Les tests tournent
contre la base PostgreSQL embarquée comme les autres specs de l'API (suivre
exactement le montage de `apps/api/src/suggestions/suggestions.e2e-spec.ts` pour
l'amorçage et le nettoyage de la base). Le lecteur de page est une doublure
locale, jamais le réseau. Couvre les points de vigilance 1, 2 et 3 :

```ts
// Recette web dont la page porte schema.org/Recipe
it('retient une recette web vérifiée et recopie ses données structurées', async () => {
  const fetcher = { fetchContent: async () => ({ structured: { title: 'Tarte', ingredients: ['pommes'], steps: ['cuire'] }, text: 'texte' }) };
  // … ingest([WEB_RECIPE], 'gemini-test')
  // attendu : 1 retenue, ligne en base, verifiedAt non nul, pageRecipe rempli
});

// Vigilance 1
it('retient une recette web sans données structurées, avec son texte', async () => {
  const fetcher = { fetchContent: async () => ({ structured: null, text: 'ingrédients : pommes' }) };
  // attendu : 1 retenue, pageRecipe null, pageText = 'ingrédients : pommes'
});

it('jette une recette web dont la page ne répond pas', async () => {
  const fetcher = { fetchContent: async () => null };
  // attendu : 0 retenue, aucune ligne en base
});

// Vigilance 2
it('jette une recette web dont l’URL est refusée, sans faire échouer les autres', async () => {
  // fetchContent lève RecipePageRefusedError pour la première URL, répond pour la seconde
  // attendu : 1 retenue (la seconde), aucune exception remontée
});

it('entre une composition du modèle sans contacter le réseau', async () => {
  const fetcher = { fetchContent: async () => { throw new Error('ne doit pas être appelé'); } };
  // attendu : 1 retenue, verifiedAt null, pageRecipe null, pageText null
});

// Vigilance 3
it('ne crée qu’une ligne pour la même recette vue deux fois et avance lastSeenAt', async () => {
  // ingest deux fois la même recette
  // attendu : une seule ligne, lastSeenAt de la seconde > firstSeenAt
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

`npm test -w @kitchen/api -- suggestion-pool` → ÉCHEC, service introuvable.

- [ ] **Étape 3 : écrire le service**

`apps/api/src/suggestions/suggestion-pool.service.ts`. Points imposés :

- `ingest` traite les recettes **en parallèle** (`Promise.all`) : une fournée de
  douze recettes web ne doit pas coûter douze fois le plafond de délai en série.
- Une recette `ai` n'appelle jamais le lecteur de page.
- Une recette `web` appelle `fetchContent(sourceUrl)` dans un `try/catch` qui
  rattrape `RecipePageRefusedError` **et** toute autre erreur : un échec sur une
  recette n'en fait jamais tomber une autre, et ne fait jamais échouer la
  fournée. Une page qui rend `null` est traitée comme absente.
- L'écriture se fait par `upsert` sur `identity` : `create` pose `firstSeenAt` et
  `lastSeenAt` à maintenant, `update` ne touche que `lastSeenAt`, `model`, et le
  contenu de page **seulement s'il était vide** — une page déjà lue ne se relit
  pas (D10).
- `payload` est écrit depuis la `ModelRecipe` déjà validée ; `read` revalide par
  `modelRecipeSchema.safeParse` et traite une ligne non conforme comme absente,
  comme le fait déjà `parseRow` dans `suggestions.service.ts`.

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

`npm test -w @kitchen/api -- suggestion-pool` → tous verts.
`npx tsc -p apps/api/tsconfig.json --noEmit` → silencieux.

- [ ] **Étape 5 : commit**

```bash
git add apps/api/src/suggestions prisma
git commit -m "feat(suggestions): ingestion au réservoir, page vérifiée et recopiée (EF-26)"
```

---

### Tâche 4 : Service — servir depuis le réservoir, n'appeler Gemini qu'au besoin

**Fichiers :**
- Modifier : `apps/api/src/suggestions/suggestions.service.ts`
- Modifier : `apps/api/src/suggestions/suggestions.e2e-spec.ts` (les cas du cache)

**Interfaces :**
- Consomme : `SuggestionPoolService` (tâche 3), `comparePoolEntries` (tâche 1).

- [ ] **Étape 1 : écrire le test qui échoue (vigilance 4)**

Dans `suggestions.e2e-spec.ts`, à côté des cas de cache existants :

```ts
it('sert depuis le réservoir sans appeler Gemini ni entamer le quota', async () => {
  // 1. premier appel : fournée réelle (doublure Gemini), réservoir amorcé
  // 2. consommer un article du stock pour que la pioche — donc l'ancienne
  //    signature de fournée — change
  // 3. second appel
  // attendu : la doublure Gemini n'a été appelée qu'une fois, le second appel
  //   rend des recettes, et `recognitionLog` ne compte qu'une entrée
  //   RECIPE_SUGGESTION
});
```

Ce test est le cœur de la demande : avant ce lot, l'étape 2 suffisait à
déclencher un second appel payant.

- [ ] **Étape 2 : lancer, vérifier l'échec**

`npm test -w @kitchen/api -- suggestions.e2e` → le nouveau cas échoue (deux
appels au lieu d'un).

- [ ] **Étape 3 : réécrire `list`**

Nouvelle forme de `SuggestionsService.list`, en remplacement du bloc actuel
`readFreshBatch` / `fetchAndStore` :

1. `assertProviderEnabled`, lecture des catégories, de l'instantané de stock et
   des graines : inchangé.
2. Lire le réservoir filtré sur l'orientation demandée (`dishType`, `region`,
   `maxMinutes`, `difficulty` ; les trois derniers se filtrent sur le `payload`
   revalidé, seul `dishType` est une colonne).
3. Exclure les recettes déjà conservées dans « Mes recettes » (D7).
4. Calculer la couverture de chaque entrée contre l'instantané (réutiliser
   `toSuggestionDtos`, inchangé) et trier par `comparePoolEntries`.
5. Appeler le modèle **seulement si** `query.refresh === true` ou si l'étape 4
   rend moins de `SUGGESTION_POOL_FLOOR` entrées. Déclarer, près de
   `SUGGESTION_BATCH_SIZE` :

```ts
/**
 * Plancher sous lequel le réservoir ne suffit plus pour l'orientation demandée
 * et justifie un appel au modèle (décision D6, 2026-10-15) : la moitié d'une
 * fournée. Au-dessus, rien n'est demandé à Gemini — c'est tout l'objet du
 * réservoir.
 */
const SUGGESTION_POOL_FLOOR = 6;
```

6. Après un appel réussi, passer les recettes à `SuggestionPoolService.ingest`,
   **puis relire le réservoir** : une recette web dont la page n'existe pas a
   été jetée à l'ingestion et ne doit jamais atteindre l'écran.
7. Supprimer `readFreshBatch`, `CACHE_TTL_MS` et `StoredBatchPayload` s'il ne
   reste aucun lecteur. `fetchAndStore` continue d'écrire `SuggestionBatch`
   (journal brut, D2) mais n'est plus lu pour servir.
8. Remplacer `readLatestBatch` (repli sur quota dépassé) par une lecture du
   réservoir sans filtre d'orientation ; le message de `quotaMessage` devient
   « …; les recettes déjà connues sont affichées. » lorsqu'il reste quelque
   chose, et garde sa formulation actuelle quand le réservoir est vide.
9. `fromCache` vaut désormais « servi sans appel au modèle ».

- [ ] **Étape 4 : lancer toute la suite de l'API**

`npm test -w @kitchen/api` → vert. Corriger les cas de cache existants qui
parlaient de la fournée de 24 h : ils doivent désormais décrire le réservoir.

- [ ] **Étape 5 : commit**

```bash
git add apps/api/src/suggestions
git commit -m "feat(suggestions): servir depuis le réservoir, Gemini seulement sous le plancher (EF-25, EF-26)"
```

---

### Tâche 5 : Exposer la vérification au front

**Fichiers :**
- Modifier : `packages/shared/src/schemas/suggestions.ts` (`SuggestionDto`)
- Modifier : `apps/api/src/suggestions/suggestions.service.ts` (`toSuggestionDtos`)
- Modifier : `apps/web/src/screens/suggestions/suggestion-card.tsx`
- Modifier : `apps/web/src/screens/suggestions/suggestion-card.test.tsx`

- [ ] **Étape 1 : ajouter le champ au DTO**

Dans `SuggestionDto`, après `sourceUrl` :

```ts
  /**
   * Page source lue avec succès à l'ingestion (décision D4 du 2026-10-15).
   * Toujours `false` pour une composition du modèle, qui n'a pas de page : la
   * carte le dit alors sans ambiguïté plutôt que de laisser croire à une
   * recette trouvée quelque part.
   */
  verified: boolean;
```

- [ ] **Étape 2 : écrire le test de la carte**

Dans `suggestion-card.test.tsx` :

```ts
it('annonce une composition non vérifiée sans ambiguïté', () => {
  render(<SuggestionCard suggestion={{ ...composition, provenance: 'ai', verified: false }} onOpen={vi.fn()} />);
  expect(screen.getByText('Composée par l’IA, non vérifiée')).toBeTruthy();
});

it('affiche le nom du site pour une recette web vérifiée', () => {
  render(<SuggestionCard suggestion={{ ...web, provenance: 'web', sourceUrl: 'https://exemple.test/tarte', verified: true }} onOpen={vi.fn()} />);
  expect(screen.getByText('exemple.test')).toBeTruthy();
});
```

- [ ] **Étape 3 : lancer, vérifier l'échec**

`cd apps/web && npx vitest run src/screens/suggestions/suggestion-card.test.tsx`

- [ ] **Étape 4 : changer le libellé**

Dans `provenanceLabel`, remplacer le retour par défaut `'Proposée par l’IA'` par
`'Composée par l’IA, non vérifiée'`, et mettre à jour le commentaire de la
fonction : la mention dit désormais ce que la recette est, pas seulement d'où
elle vient. Renseigner `verified` dans `toSuggestionDtos` depuis l'entrée du
réservoir.

- [ ] **Étape 5 : lancer les tests du front et les types**

`cd apps/web && npx vitest run src/screens/suggestions/` → vert.
`npx tsc -p apps/web/tsconfig.json --noEmit` → silencieux.

- [ ] **Étape 6 : commit**

```bash
git add packages/shared apps/api apps/web
git commit -m "feat(suggestions): une composition s'annonce non vérifiée sur sa carte (EF-26)"
```

---

### Tâche 6 : Conserver sans rappeler le site

**Fichiers :**
- Modifier : `apps/api/src/suggestions/suggestions.service.ts` (`keep`, `buildCreateInput`)
- Modifier : `apps/api/src/suggestions/suggestions.e2e-spec.ts`

- [ ] **Étape 1 : écrire le test (vigilance 5)**

```ts
it('conserve une recette web depuis le réservoir sans réseau ni réécriture', async () => {
  // réservoir amorcé avec pageRecipe structuré
  // attendu : la doublure du lecteur de page n'est pas appelée, la doublure du
  //   réécrivain non plus, la Recipe créée porte source IMPORTED et l'URL
});

it('réécrit sans rappeler le site quand seul le texte est gardé', async () => {
  // réservoir amorcé avec pageText et pageRecipe null
  // attendu : lecteur de page non appelé, réécrivain appelé une fois
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : réécrire `keep` (décision D9)**

- `keep` cherche la recette par `suggestionId` dans `SuggestionPoolRecipe`
  (`identity` est unique), plus par `batchId` dans `SuggestionBatch`.
  `batchId` reste accepté dans l'entrée, ignoré pour la recherche.
- `ApiError.notFound('Suggestion introuvable')` si l'identité n'est pas au
  réservoir.
- `buildCreateInput` reçoit en plus `pageRecipe` et `pageText` de la ligne :
  données structurées présentes → construire directement, aucun appel ; texte
  seul → réécriture Gemini à partir du texte gardé ; `ai` → inchangé. Le
  lecteur de page n'est plus appelé du tout dans ce chemin.

- [ ] **Étape 4 : lancer toute la suite de l'API**

`npm test -w @kitchen/api` → vert.

- [ ] **Étape 5 : commit**

```bash
git add apps/api/src/suggestions
git commit -m "feat(suggestions): conserver depuis le réservoir, sans rappeler le site (EF-25)"
```

---

### Tâche 7 : Parcours bout en bout

**Fichiers :**
- Modifier : `e2e/` — les parcours Suggestions (P5 et le parcours dirigé du 2026-10-11)

- [ ] **Étape 1 : relire les parcours existants**

Lire chaque fichier du dossier `e2e/` qui touche Suggestions **avant** de
modifier quoi que ce soit : deux lots précédents ont laissé des parcours
cassés faute de cette relecture.

- [ ] **Étape 2 : adapter**

Les attentes qui supposaient un appel à Gemini à chaque orientation changent :
la doublure locale ne doit plus être sollicitée quand le réservoir suffit.
Ajouter un parcours : deux visites successives, la seconde sans aucun appel à
la doublure Gemini, les recettes toujours affichées.

- [ ] **Étape 3 : vérifier ce qui est vérifiable en local**

Les parcours Playwright sont **CI uniquement** (pas de moteur de conteneurs sur
le Mac de djkix). Vérifier par relecture et par `npx tsc` que les fichiers
compilent ; la preuve vient de la CI après fusion.

- [ ] **Étape 4 : commit**

```bash
git add e2e
git commit -m "test(e2e): parcours Suggestions servi depuis le réservoir (EF-26)"
```

---

### Tâche 8 : Documentation

**Fichiers :**
- Modifier : `README.md` (section Fonctionnalités + table « Derniers changements »)
- Modifier : `docs/cahier-des-charges.md` (section 26, amendement daté)
- Modifier : `CLAUDE.md` (bloc « Ce qui est déjà fait »)

- [ ] **Étape 1 : README**

Dans la description des suggestions, remplacer la mention du cache de 24 h par
le réservoir permanent : ce qui est gardé, ce qui est vérifié, quand Gemini est
rappelé. Dire explicitement qu'une composition s'affiche comme non vérifiée, et
pourquoi elles existent encore (la recherche web exige la facturation Google
Cloud, qui n'est pas activée).

- [ ] **Étape 2 : ligne de changelog**

Ajouter en tête de la table `| Version | Date | Changement |` une ligne
`0.17.0`, à la suite de celle déjà posée pour les filtres de « Mes recettes » le
même jour — fusionner les deux en une seule ligne de version si release-please
les regroupe.

- [ ] **Étape 3 : cahier des charges**

Section 26, amendement daté du 2026-10-15 : le cache de fournée à 24 h est
remplacé par un réservoir permanent, une recette web n'est retenue que si sa
page a été lue, et son contenu est recopié une fois pour toutes.

- [ ] **Étape 4 : CLAUDE.md**

Compléter le paragraphe « Recettes suggérées à partir du stock livrées » : le
cache de fournée 24 h n'existe plus, citer la spec du 2026-10-15.

- [ ] **Étape 5 : commit**

```bash
git add README.md docs CLAUDE.md
git commit -m "docs(suggestions): réservoir permanent et vérification des pages (EF-25, EF-26)"
```
