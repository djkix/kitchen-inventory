import { expect, test, type Page } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';

/**
 * Parcours P5 — suggestions de recettes (section 3, tâche 7, EF-25, EF-26) :
 * la fonctionnalité la plus récente (livrée il y a trois jours) et la plus
 * fragile de la suite. « Que puis-je cuisiner ce soir avec ce que j'ai ? » —
 * un écran Suggestions en entrée du module Recettes, une fournée composée
 * depuis le stock réel, une orientation par région qui relance une vraie
 * recherche, et la conservation d'une suggestion qui la fait enfin rejoindre
 * « Mes recettes » avec ses étapes.
 *
 * [C15] Hors périmètre, à dessein : la conservation d'une recette **venant du
 * web** n'est jouée nulle part dans ce fichier. `RecipePageFetcher`
 * (apps/api/src/suggestions/recipe-page.fetcher.ts) refuse tout ce qui n'est
 * pas HTTPS public (pas d'adresse privée, pas de boucle locale) — « l'
 * application n'envoie jamais Franck vers le site », donc elle ne récupère
 * jamais une doublure locale non plus. Relâcher ce garde-fou pour les
 * besoins d'un test reviendrait à tester l'application avec sa propre
 * protection désactivée. Seule une recette **composée par l'IA** (`provenance:
 * 'ai'`) est conservée ici : `SuggestionsService.buildCreateInput`
 * (apps/api/src/suggestions/suggestions.service.ts) ne fait alors AUCUN appel
 * réseau (B6) — les étapes et ingrédients de la fournée sont repris tels
 * quels.
 *
 * Fournée vue par ces tests : la doublure (`e2e/fixtures/stub-server.ts`,
 * `SUGGESTIONS_FIXTURE`) sert toujours `apps/api/test/fixtures/suggestions/
 * gemini-batch.json`, quelle que soit l'orientation demandée (elle ne
 * distingue que « appel de suggestion » vs « appel de reconnaissance photo »,
 * jamais le contenu de la requête de suggestion elle-même — voir
 * `isSuggestionRequest`). Cette fixture contient très exactement
 * `SUGGESTION_BATCH_SIZE` (12, `apps/api/src/suggestions/suggestions.service.ts`)
 * recettes : huit « Recette web 1 » à « Recette web 8 » (`provenance: 'web'`,
 * région `mediterraneenne`, `sourceUrl` de la forme
 * `https://exemple-cuisine-N.test/recette-N`) et quatre « Recette composée 1 »
 * à « Recette composée 4 » (`provenance: 'ai'`, région `europeenne`, une
 * seule étape chacune, « Étape unique de composition pour la recette N. »).
 * Toutes les assertions de contenu ci-dessous citent ces chaînes telles
 * qu'elles sont dans la fixture, jamais un titre plausible deviné.
 *
 * Changer de région (B9, décision du 2026-10-04) relance une vraie recherche
 * côté serveur plutôt que de filtrer ce qui est déjà affiché :
 * `SuggestionsService.computeSignature` hache les graines de stock triées, la
 * région, la durée et la difficulté — une région différente change donc la
 * signature de cache (B12), ce qui force un nouvel appel au fournisseur et
 * l'écriture d'une nouvelle ligne `SuggestionBatch` (nouveau `batchId`). Comme
 * la doublure sert un contenu identique quelle que soit l'orientation (voir
 * plus haut), la preuve d'un second appel ne peut PAS porter sur le contenu
 * reçu — elle porte sur l'identité du lot (`batchId`), le marqueur que la
 * réponse porte déjà pour exactement cet usage (section 12, « conservation
 * d'une suggestion… identifiant de lot »).
 *
 * Sélecteurs, avec leur source :
 * - `getByRole('link', { name: 'Recettes' })` — `apps/web/src/components/
 *   shell/bottom-nav.tsx` (`NavLink` vers `/recettes`, l'écran Suggestions —
 *   `apps/web/src/app.tsx`, route `/recettes` → `<SuggestionsScreen />`).
 * - `getByRole('heading', { name: 'Suggestions', level: 1 })`, le sous-titre
 *   « À partir de votre stock », le lien « Mes recettes » —
 *   `apps/web/src/screens/suggestions/suggestions-screen.tsx`
 *   (`ScreenHeader`).
 * - `page.locator('article')` pour une carte de suggestion — même structure
 *   que les cartes de stock et de recettes (`<article>`), lue dans
 *   `apps/web/src/screens/suggestions/suggestion-card.tsx`.
 * - Le nom du site (`exemple-cuisine-N.test`) et « Proposée par l'IA » —
 *   `provenanceLabel`, même fichier (`siteName(sourceUrl)` retire le
 *   protocole et un éventuel `www.`, jamais affiché en entier — B10).
 * - `getByRole('dialog', { name: <titre> })`, le bouton « Conserver » —
 *   `apps/web/src/screens/suggestions/suggestion-sheet.tsx` (titre du
 *   `Sheet`, rendu en `<h2>` par `apps/web/src/components/ui/sheet.tsx`,
 *   `aria-label` du tiroir = ce même titre).
 * - `getByRole('group', { name: 'Région' })`, les boutons de région
 *   (« Européenne », « Méditerranéenne »…) —
 *   `apps/web/src/screens/suggestions/orientation-bar.tsx`
 *   (`ChipRow label="Région"`, libellés `SUGGESTION_REGION_LABELS_FR`,
 *   `packages/shared/src/schemas/suggestions.ts`).
 * - `getByRole('heading', { name: 'Étapes', level: 2 })`, le texte exact
 *   d'une étape — `apps/web/src/screens/recipe/recipe-screen.tsx`.
 * - `getByPlaceholder('Rechercher une recette')` —
 *   `apps/web/src/screens/recipes/recipes-screen.tsx`.
 *
 * Fermeture des tiroirs par `Escape` plutôt que par le bouton de fond
 * (`aria-label="Fermer"`) : ce bouton couvre tout l'écran, y compris
 * derrière le panneau lui-même (`apps/web/src/components/ui/sheet.tsx`) — un
 * clic au centre de sa zone accessible risquerait de tomber sur le panneau
 * au lieu du fond selon la hauteur du contenu. `Sheet` écoute `Escape`
 * explicitement (sauf `locked`), c'est le chemin fiable.
 */

const SUGGESTION_BATCH_SIZE = 12;
const WEB_RECIPE_COUNT = 8;
const AI_RECIPE_COUNT = 4;

interface SuggestionBatchResponse {
  readonly batchId: string;
  readonly items: ReadonlyArray<{ readonly title: string }>;
}

/** Attend la réponse de `GET /suggestions` déclenchée par `trigger`, et la retourne déjà décodée. */
async function waitForSuggestionsResponse(page: Page, trigger: () => Promise<unknown>): Promise<SuggestionBatchResponse> {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => /\/api\/v1\/suggestions(\?|$)/.test(candidate.url()) && candidate.request().method() === 'GET'),
    trigger(),
  ]);
  return (await response.json()) as SuggestionBatchResponse;
}

/** Ouvre le tiroir de conservation d'une suggestion depuis sa carte, par son titre exact. */
async function openSuggestionSheet(page: Page, title: string) {
  const card = page.locator('article').filter({ hasText: title });
  await card.getByRole('heading', { name: title, level: 3 }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeAll(async () => {
  await restoreDatabase();
});

useSharedAdminSession();

test('Suggestions ouvre en entrée du module Recettes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Recettes' }).click();

  await expect(page.getByRole('heading', { name: 'Suggestions', level: 1 })).toBeVisible();
  // Le sous-titre du `ScreenHeader` (« À partir de votre stock ») porte cette
  // même phrase qu'une autre phrase de l'écran, le temps du chargement (
  // `WaitingState`, « … à partir de votre stock. ») : scopé au `<header>`
  // (apps/web/src/components/shell/app-shell.tsx, `ScreenHeader`) pour ne
  // prouver que CELUI-là, jamais le texte d'attente, qui décrit autre chose
  // (comment la fournée est composée, pas que cet écran est l'entrée du module).
  await expect(page.locator('header').getByText('À partir de votre stock', { exact: true })).toBeVisible();
  // Preuve que c'est bien l'ENTRÉE du module, pas la bibliothèque elle-même :
  // le lien vers « Mes recettes » est une action de CET écran, pas l'écran courant.
  await expect(page.getByRole('link', { name: 'Mes recettes' })).toBeVisible();
});

test('affiche une fournée construite sur le stock, chaque carte avec sa provenance', async ({ page }) => {
  const batch = await waitForSuggestionsResponse(page, () => page.goto('/recettes'));
  expect(batch.items).toHaveLength(SUGGESTION_BATCH_SIZE);

  const cards = page.locator('article');
  await expect(cards).toHaveCount(SUGGESTION_BATCH_SIZE);

  // Provenance « web » : le nom du site, jamais l'URL entière (B10).
  for (let i = 1; i <= WEB_RECIPE_COUNT; i++) {
    await expect(page.getByText(`exemple-cuisine-${i}.test`, { exact: true })).toBeVisible();
  }
  // Provenance « ai » : la même mention sur les quatre cartes composées.
  await expect(page.getByText('Proposée par l’IA')).toHaveCount(AI_RECIPE_COUNT);
});

test('n’affiche aucune étape avant conservation, quelle que soit la provenance', async ({ page }) => {
  await page.goto('/recettes');

  const cases: Array<{ title: string; stepText: string }> = [
    { title: 'Recette web 1', stepText: 'Préparer les ingrédients de la recette 1.' },
    { title: 'Recette composée 1', stepText: 'Étape unique de composition pour la recette 1.' },
  ];

  for (const { title, stepText } of cases) {
    const dialog = await openSuggestionSheet(page, title);
    // Les deux provenances doivent se ressembler avant conservation (B7,
    // décision du 2026-10-04) : aucune section « Étapes », aucun texte
    // d'étape, copié ici tel quel depuis la fixture plutôt que deviné.
    await expect(dialog.getByRole('heading', { name: 'Étapes' })).toHaveCount(0);
    await expect(page.getByText(stepText)).toHaveCount(0);
    // L'écran affiche bien autre chose (les ingrédients) : ce n'est pas un tiroir vide par accident.
    await expect(dialog.getByRole('listitem').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

test('relance une recherche quand on choisit une région, plutôt que de filtrer ce qui est affiché', async ({ page }) => {
  const first = await waitForSuggestionsResponse(page, () => page.goto('/recettes'));
  expect(first.items.length).toBeGreaterThan(0);

  const second = await waitForSuggestionsResponse(page, () =>
    page.getByRole('group', { name: 'Région' }).getByRole('button', { name: 'Européenne', exact: true }).click(),
  );

  // La doublure sert un contenu identique quelle que soit l'orientation (voir
  // l'en-tête de ce fichier) : la preuve d'une recherche ciblée ne peut donc
  // porter que sur l'identité du lot renvoyé, pas sur son contenu. Un
  // `batchId` distinct ne peut survenir que si la signature de cache a changé
  // (`computeSignature`, région incluse) et qu'un nouvel appel a donc bien été
  // fait au fournisseur — un simple filtrage côté écran de la même fournée
  // aurait gardé le même `batchId`.
  expect(second.batchId).not.toBe(first.batchId);
});

test('conserve une recette composée par l’IA : elle rejoint Mes recettes, où ses étapes apparaissent enfin', async ({ page }) => {
  await page.goto('/recettes');
  const dialog = await openSuggestionSheet(page, 'Recette composée 1');

  await dialog.getByRole('button', { name: 'Conserver' }).click();

  // Composition IA (B6) : aucun appel réseau supplémentaire, contrairement au
  // chemin web (récupération de page + réécriture Gemini, hors périmètre ici
  // — [C15]) : la navigation suit directement, sans attente prolongée à prévoir.
  await page.waitForURL(/\/recettes\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Recette composée 1', level: 1 })).toBeVisible();

  // C'est SEULEMENT maintenant, sur la fiche de la recette conservée, que les
  // étapes apparaissent (B7) — texte exact de la fixture, jamais reformulé.
  await expect(page.getByRole('heading', { name: 'Étapes', level: 2 })).toBeVisible();
  await expect(page.getByText('Étape unique de composition pour la recette 1.')).toBeVisible();

  // … et la recette est désormais dans Mes recettes, pas seulement sur sa propre fiche.
  await page.goto('/recettes/bibliotheque');
  await page.getByPlaceholder('Rechercher une recette').fill('Recette composée 1');
  // `page.locator('article')`, pas `getByRole('link', { name: … })` : vérifié
  // (artefacts CI + reproduction isolée hors Docker) que Chromium calcule un
  // nom accessible VIDE pour le `<Link>` qui enveloppe une `RecipeCard`
  // (`apps/web/src/screens/recipes/recipes-screen.tsx`) — le contenu d'un rôle
  // `article` n'est pas remonté dans le nom d'un lien ancêtre (règle de calcul
  // du nom accessible, pas un défaut de l'application ni du texte conservé :
  // la fiche de la recette, elle, affiche bien « Recette composée 1 » en
  // `<h1>`, vérifié juste au-dessus). Même structure et même sélecteur que
  // P3/P4 pour les cartes de stock (`<article>`, jamais une classe CSS).
  await expect(page.locator('article').filter({ hasText: 'Recette composée 1' })).toBeVisible();
});
