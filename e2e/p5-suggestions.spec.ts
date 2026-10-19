import { expect, test, type Page } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';
import { emptySuggestionPool, seedReadWebRecipes, suggestionCalls } from './support/suggestions.ts';

/**
 * Parcours P5 — suggestions de recettes (section 3, EF-25, EF-26), réécrit le
 * 2026-10-15 pour le lot « réservoir permanent ». « Que puis-je cuisiner ce
 * soir avec ce que j'ai ? » — un écran Suggestions en entrée du module
 * Recettes, servi d'abord par le réservoir, et le modèle appelé seulement
 * quand le réservoir ne suffit pas.
 *
 * Ce que ce fichier prouve, et dans cet ordre (les tests d'un fichier
 * s'exécutent en série sur une base restaurée une seule fois, `workers: 1` et
 * `fullyParallel: false` — le réservoir se remplit donc au fil des tests,
 * comme il le ferait au fil des visites de djkix) :
 *  1. le réservoir vide fait appeler le modèle, et une recette `web` dont la
 *     page est injoignable n'atteint jamais l'écran (décision D4) ;
 *  2. le réservoir rempli sert deux visites successives SANS aucun appel au
 *     modèle, les recettes toujours affichées (demande du propriétaire) ;
 *  3. les deux provenances s'affichent comme elles doivent (B10, B7) ;
 *  4. une orientation jamais cherchée relance une vraie recherche ;
 *  5. l'état vide dit la cause, propose la relance, et le verrou de 24 heures
 *     s'annonce au lieu de laisser un écran vide et muet (décision D11) ;
 *  6. les ingrédients dictés (spécification du 2026-10-19) : un terme validé
 *     devient une pastille visible et retirable, l'autocomplétion propose le
 *     catalogue, et la recherche ne rend que des recettes qui les utilisent
 *     TOUS (D1, D8). Le dernier de la liste parce qu'il s'appuie sur le
 *     réservoir que les tests précédents ont rempli : huit recettes y portent
 *     déjà « Tomate » et « Huile d’olive », soit plus que le plancher de six,
 *     donc aucun appel au modèle à payer pour l'essentiel de ce parcours.
 *
 * **Preuve des appels** : le compteur de la doublure
 * (`e2e/fixtures/stub-server.ts`, route `/__calls`, lu par
 * `suggestionCalls()`), jamais le `fromCache` de la réponse — un drapeau que
 * le serveur se pose à lui-même ne prouve pas qu'il s'est tu. L'ancienne
 * preuve par `batchId` (« deux fournées distinctes, donc deux appels ») a
 * disparu avec le champ lui-même : depuis le réservoir, l'écran n'est plus
 * servi par une fournée, et plus personne ne lisait cet identifiant.
 *
 * **Fournée vue par ces tests** : la doublure sert toujours
 * `apps/api/test/fixtures/suggestions/gemini-batch.json`, quelle que soit
 * l'orientation demandée (elle ne distingue que « appel de suggestion » de
 * « appel de reconnaissance photo », jamais le contenu de la requête — voir
 * `isSuggestionRequest`). Cette fixture contient exactement
 * `SUGGESTION_BATCH_SIZE` (12) recettes : huit « Recette web 1 » à « Recette
 * web 8 » (`provenance: 'web'`, région `mediterraneenne`, `sourceUrl` de la
 * forme `https://203.0.113.20/recette-N`) et quatre « Recette composée 1 » à
 * « Recette composée 4 » (`provenance: 'ai'`, région `europeenne`, une seule
 * étape chacune, « Étape unique de composition pour la recette N. »). Toutes
 * les assertions ci-dessous citent ces chaînes telles qu'elles sont dans la
 * fixture, jamais un titre plausible deviné.
 *
 * **Les huit recettes web et leur page** (corrigé le 2026-10-15 — l'assertion
 * « douze cartes » de ce fichier était fausse depuis que l'ingestion jette une
 * recette web illisible) : `RecipePageFetcher` exige HTTPS vers un hôte
 * public, donc aucune doublure locale ne peut lui servir une page sans
 * désactiver la protection même que l'application se donne. Les URL de la
 * fixture visent `203.0.113.20` (TEST-NET-3, RFC 5737) : un littéral IP, donc
 * aucune résolution DNS — aucun test ne dépend du réseau — et injoignable,
 * donc ces recettes sont jetées à l'ingestion. Les deux faces sont jouées :
 * sans page lue, elles n'atteignent pas l'écran ; déposées au réservoir dans
 * l'état que produit une lecture réussie (`seedReadWebRecipes`, décision
 * D10), elles y figurent avec le nom de leur site et l'ingestion ne les relit
 * plus. Ce qui n'est PAS joué bout en bout, faute de pouvoir l'être :
 * la lecture d'une vraie page par le récupérateur. Elle est couverte par les
 * tests d'intégration d'`apps/api` (`suggestions.e2e-spec.ts`,
 * `recipe-page.fetcher.spec.ts`), où le client HTTP est injectable.
 *
 * **Question bloquante à l'entrée** (décision D2 du 2026-10-11,
 * `apps/web/src/screens/suggestions/dish-type-question.tsx`) : aucun appel à
 * `GET /suggestions` ne part tant qu'un type de plat n'a pas été choisi, et
 * ni liste, ni squelette, ni barre de filtres ne s'affichent avant. Tout
 * parcours qui atterrit sur `/recettes` répond donc d'abord par
 * `answerDishTypeQuestion(page)`. La réponse est gardée dans une variable de
 * module, effacée par tout rechargement complet : après `page.reload()`, la
 * question est reposée — c'est ce qui fait d'un rechargement une vraie
 * « seconde visite », avec son propre appel à `GET /suggestions`.
 *
 * Sélecteurs, avec leur source :
 * - `getByRole('link', { name: 'Recettes' })` — `apps/web/src/components/
 *   shell/bottom-nav.tsx` (`NavLink` vers `/recettes`, l'écran Suggestions).
 * - `getByRole('heading', { name: 'Suggestions', level: 1 })`, le sous-titre
 *   « À partir de votre stock », le lien « Mes recettes » —
 *   `apps/web/src/screens/suggestions/suggestions-screen.tsx` (`ScreenHeader`),
 *   affichés dès l'arrivée, même avant la question bloquante.
 * - `getByRole('group', { name: 'Type de plat' }).getByRole('button', …)` —
 *   les sept boutons de la question elle-même (`DishTypeQuestion`). À ne pas
 *   confondre avec le `<select aria-label="Type de plat">` de la barre de
 *   filtres, qui est un `combobox`.
 * - `page.locator('article')` pour une carte de suggestion —
 *   `apps/web/src/screens/suggestions/suggestion-card.tsx`.
 * - Le nom du site (`203.0.113.20`) et « Composée par l'IA, non vérifiée » —
 *   `provenanceLabel`, même fichier (`siteName(sourceUrl)` retire le
 *   protocole et un éventuel `www.`, jamais l'URL entière — B10).
 * - `getByRole('dialog', { name: <titre> })` et le bouton « Plus
 *   d'informations » (qui conserve directement, ce n'est pas une consultation
 *   suivie d'une conservation séparée) — `suggestion-sheet.tsx`.
 * - `getByRole('combobox', { name: 'Cuisine' })` avec `selectOption` — barre
 *   de filtres (décision D5 du 2026-10-11, `orientation-bar.tsx`) : quatre
 *   `<select>` natifs, plus aucune pastille de région.
 * - `getByRole('button', { name: 'Chercher de nouvelles recettes' })` —
 *   action de l'`EmptyState` de `suggestions-screen.tsx`, présente
 *   uniquement dans l'état vide (lot du 2026-10-15).
 * - `getByRole('status')` pour le `notice` du verrou de 24 heures — même
 *   fichier, paragraphe au-dessus de la liste.
 * - `getByRole('heading', { name: 'Étapes', level: 2 })`, le texte exact
 *   d'une étape — `apps/web/src/screens/recipe/recipe-screen.tsx`.
 * - `getByPlaceholder('Rechercher une recette')` —
 *   `apps/web/src/screens/recipes/recipes-screen.tsx`.
 * - `getByRole('combobox', { name: 'Ingrédients à utiliser' })`, le bouton
 *   « Chercher » (`exact: true`, pour ne jamais attraper « Chercher de
 *   nouvelles recettes »), la liste `getByRole('listbox', { name: 'Produits
 *   proposés' })` et ses `option`, la croix d'une pastille
 *   (`aria-label` « Retirer <terme> ») —
 *   `apps/web/src/screens/suggestions/ingredients-field.tsx`.
 * - « Huile d’olive » : produit du jeu de développement
 *   (`prisma/seed/dev.ts`), ce qui en fait une proposition d'autocomplétion
 *   réelle ; c'est aussi, avec « Tomate », l'un des deux libellés des huit
 *   recettes web de la fixture. Les quatre compositions ne portent que
 *   « Pâtes » : aucune recette ne porte « Tomate » ET « Pâtes », d'où la
 *   combinaison sans résultat jouée en fin de parcours.
 *
 * Fermeture des tiroirs par `Escape` plutôt que par le bouton de fond
 * (`aria-label="Fermer"`) : ce bouton couvre tout l'écran, y compris derrière
 * le panneau — un clic au centre de sa zone accessible risquerait de tomber
 * sur le panneau au lieu du fond. `Sheet` écoute `Escape` explicitement.
 */

const WEB_RECIPE_COUNT = 8;
const AI_RECIPE_COUNT = 4;
const POOL_RECIPE_COUNT = WEB_RECIPE_COUNT + AI_RECIPE_COUNT;

/** Nom de site affiché par les huit recettes web de la fixture (un littéral IP, pas un domaine). */
const WEB_RECIPE_SITE = '203.0.113.20';

interface SuggestionBatchResponse {
  readonly items: ReadonlyArray<{ readonly title: string }>;
  readonly notice: string | null;
}

/** Attend la réponse de `GET /suggestions` déclenchée par `trigger`, et la retourne déjà décodée. */
async function waitForSuggestionsResponse(page: Page, trigger: () => Promise<unknown>): Promise<SuggestionBatchResponse> {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => /\/api\/v1\/suggestions(\?|$)/.test(candidate.url()) && candidate.request().method() === 'GET'),
    trigger(),
  ]);
  return (await response.json()) as SuggestionBatchResponse;
}

/**
 * Répond à la question bloquante d'entrée (D2) : condition pour que
 * `SuggestionsScreen` affiche autre chose (liste, filtres, erreur) et pour
 * qu'un appel à `GET /suggestions` parte. « Plat » convient à tous les tests
 * qui n'ont pas de raison d'en choisir un autre : c'est le type que porte
 * chacune des douze recettes de la fixture.
 */
async function answerDishTypeQuestion(page: Page, label = 'Plat') {
  await page.getByRole('group', { name: 'Type de plat' }).getByRole('button', { name: label, exact: true }).click();
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
  // Le réservoir survit aux restaurations de données de la suite (ses lignes
  // sont rechargées par l'instantané), mais pas à l'ordre des fichiers : on
  // part explicitement d'un réservoir vide, puisque c'est l'état de départ
  // que le premier test ci-dessous met à l'épreuve.
  await emptySuggestionPool();
});

useSharedAdminSession();

test('Suggestions ouvre en entrée du module Recettes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Recettes' }).click();

  await expect(page.getByRole('heading', { name: 'Suggestions', level: 1 })).toBeVisible();
  // Le sous-titre du `ScreenHeader` (« À partir de votre stock ») porte cette
  // même phrase qu'une autre phrase de l'écran, le temps du chargement
  // (`WaitingState`, « … à partir de votre stock. ») : scopé au `<header>`
  // pour ne prouver que CELUI-là, jamais le texte d'attente, qui décrit autre
  // chose (comment la fournée est composée, pas que cet écran est l'entrée du
  // module).
  await expect(page.locator('header').getByText('À partir de votre stock', { exact: true })).toBeVisible();
  // Preuve que c'est bien l'ENTRÉE du module, pas la bibliothèque elle-même :
  // le lien vers « Mes recettes » est une action de CET écran, pas l'écran courant.
  await expect(page.getByRole('link', { name: 'Mes recettes' })).toBeVisible();
});

test('réservoir vide : le modèle est appelé, et une recette web illisible n’atteint pas l’écran (D4)', async ({ page }) => {
  // Le seul test de ce fichier qui fait vraiment tenter la lecture des huit
  // pages web : `203.0.113.20` n'est routable nulle part, chaque tentative va
  // donc au bout du plafond de cinq secondes du récupérateur (en parallèle,
  // mais ajoutées au temps de page). Les tests suivants ne le repaient pas —
  // les pages y sont déjà au réservoir, et l'ingestion ne relit jamais une
  // page déjà lue (D10).
  test.slow();
  const before = await suggestionCalls();

  await page.goto('/recettes');
  // Question bloquante (D2) : c'est la réponse, pas la navigation, qui déclenche l'appel initial.
  const batch = await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page));

  // Un appel, et un seul : le réservoir était vide, il n'y avait rien à servir.
  expect(await suggestionCalls()).toBe(before + 1);

  // La doublure a bien rendu douze recettes, dont huit web — mais leurs pages
  // (`https://203.0.113.20/…`, injoignable par construction) n'ont pas pu être
  // lues : elles sont jetées à l'ingestion et ne sont PAS dans la réponse.
  // C'est l'inverse exact de ce que ce fichier affirmait avant le lot.
  expect(batch.items).toHaveLength(AI_RECIPE_COUNT);
  await expect(page.locator('article')).toHaveCount(AI_RECIPE_COUNT);
  await expect(page.getByText('Composée par l’IA, non vérifiée')).toHaveCount(AI_RECIPE_COUNT);
  // Aucune recette web n'a pu se faire passer pour une recette trouvée quelque part.
  await expect(page.getByText(WEB_RECIPE_SITE)).toHaveCount(0);
});

test('réservoir rempli : deux visites de suite sans le moindre appel au modèle (EF-26)', async ({ page }) => {
  // Les huit recettes web, déposées dans l'état que produit une lecture
  // réussie de leur page (D10) — voir l'en-tête : leur page ne peut pas être
  // servie par une doublure locale sans désactiver la protection du
  // récupérateur. Les quatre compositions, elles, sont déjà au réservoir :
  // c'est le test précédent qui les y a fait entrer, par un vrai appel.
  expect(await seedReadWebRecipes()).toBe(WEB_RECIPE_COUNT);
  const before = await suggestionCalls();

  // Première visite.
  await page.goto('/recettes');
  const first = await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page));
  expect(first.items).toHaveLength(POOL_RECIPE_COUNT);
  await expect(page.locator('article')).toHaveCount(POOL_RECIPE_COUNT);

  // Seconde visite : rechargement complet, donc question reposée, nouvelle
  // requête au serveur — pas un simple retour sur un cache de navigateur.
  await page.reload();
  const second = await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page));
  expect(second.items).toHaveLength(POOL_RECIPE_COUNT);
  await expect(page.locator('article')).toHaveCount(POOL_RECIPE_COUNT);

  // Le cœur de la demande : deux visites servies, zéro appel à la doublure.
  expect(await suggestionCalls()).toBe(before);

  // Les deux provenances se lisent telles qu'elles doivent : le nom du site
  // pour une recette dont la page a été lue (B10, jamais l'URL entière), et
  // l'aveu explicite pour une composition.
  await expect(page.getByText(WEB_RECIPE_SITE, { exact: true })).toHaveCount(WEB_RECIPE_COUNT);
  await expect(page.getByText('Composée par l’IA, non vérifiée')).toHaveCount(AI_RECIPE_COUNT);

  // Retour sur l'onglet depuis « Mes recettes » : aucune requête automatique
  // sur la route payante (`refetchOnWindowFocus: false`, `queries.ts`).
  await page.getByRole('link', { name: 'Mes recettes' }).click();
  await expect(page.getByPlaceholder('Rechercher une recette')).toBeVisible();
  await page.getByRole('link', { name: 'Suggestions' }).click();
  await expect(page.locator('article').first()).toBeVisible();
  expect(await suggestionCalls()).toBe(before);
});

test('affiche les étapes d’une composition dès la fiche, mais jamais celles d’une recette web avant conservation (B7, amendé le 2026-10-08)', async ({ page }) => {
  await page.goto('/recettes');
  await answerDishTypeQuestion(page);

  // Recette composée : les étapes sont déjà dans la fournée (B6, aucun appel
  // réseau pour une composition) — « Plus d'informations » n'aurait rien de
  // plus à aller chercher, elle doit donc déjà les montrer.
  const aiDialog = await openSuggestionSheet(page, 'Recette composée 1');
  await expect(aiDialog.getByRole('heading', { name: 'Étapes', level: 2 })).toBeVisible();
  await expect(page.getByText('Étape unique de composition pour la recette 1.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(aiDialog).toBeHidden();

  // Recette web : ses étapes ont beau être au réservoir (page lue à
  // l'ingestion, D10), la fiche ne les montre qu'après conservation (B6) —
  // texte copié tel quel depuis la fixture, jamais un libellé plausible.
  const webDialog = await openSuggestionSheet(page, 'Recette web 1');
  await expect(webDialog.getByRole('heading', { name: 'Étapes' })).toHaveCount(0);
  await expect(page.getByText('Préparer les ingrédients de la recette 1.')).toHaveCount(0);
  // L'écran affiche bien autre chose (les ingrédients) : ce n'est pas un tiroir vide par accident.
  await expect(webDialog.getByRole('listitem').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(webDialog).toBeHidden();
});

test('une orientation que le réservoir ne couvre pas relance une vraie recherche', async ({ page }) => {
  await page.goto('/recettes');
  const first = await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page));
  expect(first.items.length).toBeGreaterThan(0);
  const before = await suggestionCalls();

  // D5 (2026-10-11) : les pastilles de région ont fait place à un `<select>`
  // natif. « Européenne » ne couvre que les quatre compositions du réservoir,
  // sous le plancher de `SUGGESTION_POOL_FLOOR` (6) et jamais demandée
  // jusqu'ici : la recherche doit donc vraiment partir, plutôt que de filtrer
  // ce qui est déjà affiché.
  const second = await waitForSuggestionsResponse(page, () =>
    page.getByRole('combobox', { name: 'Cuisine' }).selectOption({ label: 'Européenne' }),
  );

  // La preuve porte sur l'appel réellement servi par la doublure — la fixture
  // rend le même contenu quelle que soit l'orientation, le contenu reçu ne
  // prouverait donc rien.
  expect(await suggestionCalls()).toBe(before + 1);
  expect(second.items.length).toBeGreaterThan(0);
});

test('état vide : la relance est atteignable, et le verrou de 24 heures s’annonce (D11)', async ({ page }) => {
  // « Dessert » n'existe nulle part au réservoir (les douze recettes de la
  // fixture sont des plats) : l'orientation reste vide même après un appel
  // au modèle, ce qui est exactement la situation que la décision D11 rend
  // possible — et qu'il ne faut pas laisser muette.
  await page.goto('/recettes');
  const before = await suggestionCalls();
  const empty = await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page, 'Dessert'));
  expect(empty.items).toHaveLength(0);
  // Premier passage : la recherche part pour de vrai, il n'y a donc rien à
  // annoncer — pas encore de verrou.
  expect(await suggestionCalls()).toBe(before + 1);
  expect(empty.notice).toBeNull();

  // Le texte d'état vide n'invite plus à attendre un changement de stock (la
  // recherche n'en dépend plus) mais à changer d'orientation ou à relancer.
  await expect(page.getByRole('heading', { name: 'Aucune suggestion pour cette orientation', level: 2 })).toBeVisible();
  await expect(page.getByText('Changez d’orientation — une autre cuisine, une durée plus large — ou lancez vous-même une nouvelle recherche.')).toBeVisible();

  // Le bouton de relance : présent dans l'état vide, et actif autant de fois
  // qu'on appuie (un compteur côté écran, pas un drapeau qui resterait posé).
  const relaunch = page.getByRole('button', { name: 'Chercher de nouvelles recettes' });
  await waitForSuggestionsResponse(page, () => relaunch.click());
  expect(await suggestionCalls()).toBe(before + 2);
  await waitForSuggestionsResponse(page, () => relaunch.click());
  expect(await suggestionCalls()).toBe(before + 3);

  // Nouvelle visite sur la même orientation : la recherche ne repart pas
  // d'elle-même avant 24 heures (D11), et l'écran le dit au lieu de rester
  // vide et muet. Aucun appel de plus.
  await page.reload();
  const locked = await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page, 'Dessert'));
  expect(await suggestionCalls()).toBe(before + 3);
  expect(locked.items).toHaveLength(0);
  // Le message porte la cause, l'échéance et les deux sorties ; seule
  // l'échéance (une date) varie, les deux autres sont citées telles quelles.
  const notice = page.getByRole('status').filter({ hasText: 'déjà été cherchée récemment' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Changez d’orientation, ou relancez la recherche vous-même.');
  // Et la sortie reste atteignable depuis cet écran-là aussi.
  await expect(page.getByRole('button', { name: 'Chercher de nouvelles recettes' })).toBeVisible();
});

test('conserve une recette composée par l’IA : elle rejoint Mes recettes, où ses étapes restent affichées', async ({ page }) => {
  await page.goto('/recettes');
  await answerDishTypeQuestion(page);
  const dialog = await openSuggestionSheet(page, 'Recette composée 1');

  await dialog.getByRole('button', { name: 'Je fais cette recette' }).click();

  // Composition (B6) : aucun appel supplémentaire, contrairement au chemin
  // web, qui fait réécrire la recette par Gemini — mais depuis le contenu
  // recopié au réservoir, sans jamais rappeler le site (D10) : la navigation
  // suit directement, sans attente prolongée à prévoir.
  await page.waitForURL(/\/recettes\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Recette composée 1', level: 1 })).toBeVisible();

  // Les étapes d'une composition étaient déjà visibles dans le tiroir (B7,
  // amendé le 2026-10-08) ; elles restent affichées sur la fiche de la
  // recette conservée — texte exact de la fixture, jamais reformulé.
  await expect(page.getByRole('heading', { name: 'Étapes', level: 2 })).toBeVisible();
  await expect(page.getByText('Étape unique de composition pour la recette 1.')).toBeVisible();

  // … et la recette est désormais dans Mes recettes, pas seulement sur sa propre fiche.
  await page.goto('/recettes/bibliotheque');
  await page.getByPlaceholder('Rechercher une recette').fill('Recette composée 1');
  // `getByRole('link', { name: … })`, pas `page.locator('article')` (EF-23) :
  // le `<Link>` qui enveloppe une `RecipeCard` porte un `aria-label` explicite
  // (`recipeAccessibleName`) — Chromium ne remonte pas le contenu d'un rôle
  // `article` dans le nom d'un lien ancêtre. Le nom commence par le titre ; la
  // suite (état de couverture) varie avec le stock réel, d'où la
  // correspondance partielle plutôt qu'un nom exact.
  await expect(page.getByRole('link', { name: /^Recette composée 1,/ })).toBeVisible();
});

test('bascule le favori d’une carte sans naviguer vers la fiche (EF-21)', async ({ page }) => {
  // Ajouté à la tâche 4 du lot « favoris et note directe » (2026-10-08) :
  // la carte de liste n'enveloppe plus le lien de navigation, c'est
  // maintenant l'inverse (`recipes-screen.tsx` — le `<Link>` est un calque
  // `absolute inset-0` SOUS la carte, qui elle-même laisse passer le clic
  // sauf sur l'étoile, qui le reprend par `pointer-events-auto`). Un
  // changement structurel analogue a déjà cassé une fois ce même geste
  // (commit 3c33ea9, « sortir l'étoile de favori de l'ancre de la carte »,
  // EF-21) : un test de composant (jsdom) ne peut pas prouver qu'un clic sur
  // l'étoile ne traverse pas jusqu'au lien superposé en dessous — seul un
  // vrai moteur de rendu, avec un vrai calcul de superposition CSS, le peut.
  // « Croque-monsieur » : recette du jeu de développement (`prisma/seed/dev.ts`),
  // jamais favorite au départ (`favorite: false` par défaut, migration `0008`).
  await page.goto('/recettes/bibliotheque');
  await page.getByPlaceholder('Rechercher une recette').fill('Croque-monsieur');

  const star = page.getByRole('button', { name: 'Favori : Croque-monsieur' });
  await expect(star).toHaveAttribute('aria-pressed', 'false');

  // Attend le PATCH déclenché par le clic (revue finale du 2026-10-08) :
  // `recipes-screen.tsx` lit `filters` pour construire la requête `GET
  // /recipes`, pas `debouncedFilters` — rien n'empêche donc le `GET
  // ?favorite=true` du clic sur la pastille, juste après, de partir avant que
  // ce PATCH ne soit commis en base. Sans cette attente, la liste reviendrait
  // parfois vide selon l'ordre d'arrivée des deux requêtes : un échec invisible
  // en local, qui n'apparaîtrait qu'en CI après fusion.
  await Promise.all([
    page.waitForResponse((candidate) => /\/api\/v1\/recipes\/[^/]+$/.test(candidate.url()) && candidate.request().method() === 'PATCH'),
    star.click(),
  ]);

  // Le favori a changé (état annoncé, forme de l'étoile) et la page n'a pas
  // navigué vers la fiche de la recette : la preuve que le clic est resté sur
  // l'étoile plutôt que de retomber sur le lien posé dessous.
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/recettes\/bibliotheque$/);
  await expect(page.getByRole('heading', { name: 'Croque-monsieur', level: 1 })).toHaveCount(0);

  // Pastille « Favoris » (A4) : la recette fraîchement marquée s'y retrouve.
  // Les filtres vivent désormais derrière le bouton « Filtres », dans un
  // panneau par le bas (D2, 2026-10-19) : sur un téléphone, les onze contrôles
  // en place permanente repoussaient la liste hors de l'écran.
  await page.getByRole('button', { name: 'Filtres' }).click();
  const filtres = page.getByRole('dialog');
  await filtres.getByRole('group', { name: 'Pastilles rapides' }).getByRole('button', { name: 'Favoris' }).click();
  // Le bouton porte le nombre de filtres actifs, pour qu'un filtre resté actif
  // ne devienne pas invisible une fois le panneau refermé.
  await filtres.getByRole('button', { name: 'Voir les recettes' }).click();
  await expect(page.getByRole('button', { name: 'Filtres (1 actif)' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Croque-monsieur,/ })).toBeVisible();
});

test('ingrédients dictés : pastilles, autocomplétion, et des recettes qui les utilisent toutes (EF-25, EF-26)', async ({ page }) => {
  // Réservoir déjà rempli par les tests précédents de ce fichier : les huit
  // recettes web portent « Tomate » et « Huile d’olive », les quatre
  // compositions portent « Pâtes » (fixture `gemini-batch.json`, citée en
  // tête). « tomate » + « Huile d’olive » trouve donc huit recettes au
  // réservoir, au-dessus du plancher de six : aucun appel au modèle n'est
  // payé pour la partie principale de ce parcours — seule la combinaison
  // sans résultat, à la fin, en coûte un (elle ne peut pas être prouvée
  // autrement : le réservoir vide EST ce qui fait partir l'appel).
  await page.goto('/recettes');
  await waitForSuggestionsResponse(page, () => answerDishTypeQuestion(page));
  const before = await suggestionCalls();

  // Motif `combobox` (`ingredients-field.tsx`) : le champ s'annonce comme tel
  // pour porter sa liste de propositions. À ne pas confondre avec les quatre
  // `<select>` de la barre de filtres, qui sont aussi des `combobox` mais
  // portent d'autres noms (« Cuisine », « Type de plat »…).
  const field = page.getByRole('combobox', { name: 'Ingrédients à utiliser' });

  // 1. Le cœur de la correction : un terme validé par Entrée devient une
  //    pastille VISIBLE. djkix avait tapé « poulet tomate » sans virgule, et
  //    rien à l'écran ne disait que l'application n'y lisait qu'un seul
  //    ingrédient de ce nom — il a lu « Aucune recette » après avoir payé
  //    l'appel. La croix de la pastille porte le terme dans son nom
  //    accessible (« Retirer tomate »), c'est elle qui prouve laquelle est là.
  await field.fill('tomate');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: 'Retirer tomate' })).toBeVisible();
  // Entrée valide le terme, elle ne lance pas la recherche : le champ est
  // rendu vide pour le suivant, et aucun appel n'est parti.
  await expect(field).toHaveValue('');

  // 2. Autocomplétion depuis le catalogue de produits (`GET /products`) :
  //    « Huile d’olive » est un produit du jeu de développement
  //    (`prisma/seed/dev.ts`). Le clic sur la proposition la pose en pastille
  //    — et le terme porte alors exactement un libellé connu, ce qui est tout
  //    l'intérêt : le rapprochement au réservoir ne dépend plus de
  //    l'orthographe du jour.
  await field.fill('huile');
  await page.getByRole('listbox', { name: 'Produits proposés' }).getByRole('option', { name: 'Huile d’olive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retirer Huile d’olive' })).toBeVisible();

  // 3. La virgule valide elle aussi, et la croix retire la pastille — ici un
  //    terme tapé par erreur, qu'il faut pouvoir enlever sans tout reprendre.
  await field.fill('merguez,');
  const removeMerguez = page.getByRole('button', { name: 'Retirer merguez' });
  await expect(removeMerguez).toBeVisible();
  await removeMerguez.click();
  await expect(page.getByRole('button', { name: 'Retirer merguez' })).toHaveCount(0);

  // 4. La recherche ne rend que des recettes utilisant TOUS les termes (D1,
  //    D8) : les huit recettes web portent les deux, les quatre compositions
  //    n'en portent aucun et sont absentes. Servi par le réservoir, donc sans
  //    le moindre appel au modèle (D2).
  //    `exact: true` : « Chercher » seul, jamais « Chercher de nouvelles
  //    recettes », l'autre bouton de cet écran.
  const search = page.getByRole('button', { name: 'Chercher', exact: true });
  const matched = await waitForSuggestionsResponse(page, () => search.click());
  expect(matched.items).toHaveLength(WEB_RECIPE_COUNT);
  await expect(page.locator('article')).toHaveCount(WEB_RECIPE_COUNT);
  await expect(page.getByText('Composée par l’IA, non vérifiée')).toHaveCount(0);
  expect(await suggestionCalls()).toBe(before);

  // 5. Combinaison que rien ne satisfait : aucune recette ne porte à la fois
  //    « Tomate » et « Pâtes ». Le réservoir filtré rend zéro, donc le modèle
  //    est appelé une fois (le seul appel de ce parcours) ; la fournée
  //    rejouée n'apporte rien de plus qui les porte toutes, et l'écran doit
  //    le DIRE plutôt que de laisser une liste vide et muette — la limite
  //    assumée de D1, qui est précisément ce que djkix a subi.
  await field.fill('pâtes,');
  const empty = await waitForSuggestionsResponse(page, () => search.click());
  expect(empty.items).toHaveLength(0);
  expect(await suggestionCalls()).toBe(before + 1);
  await expect(page.getByRole('heading', { name: 'Aucune recette avec ces ingrédients', level: 2 })).toBeVisible();
  await expect(
    page.getByText('La combinaison demandée est trop rare : chaque recette doit utiliser tous les ingrédients saisis.', { exact: false }),
  ).toBeVisible();
});

test('efface une recette de la liste : archivage après confirmation, jamais de suppression (D4, D5)', async ({ page }) => {
  // « Toujours présent dans la base des recettes » (demande de djkix) :
  // l'effacement de la liste est un `POST /recipes/:id/archive`. La recette
  // quitte « Mes recettes », garde son historique et ses notes, et la bascule
  // « Archivées » la retrouve.
  //
  // Joué au navigateur et non en jsdom pour la même raison que le favori juste
  // au-dessus : le bouton d'effacement est posé SOUS la carte opaque, découvert
  // par un glissement, par le focus ou par le survol. Seul un vrai calcul de
  // superposition CSS prouve qu'il est réellement atteignable — un test de
  // composant ne voit pas le recouvrement.
  //
  // Le survol est joué explicitement : sans geste, Playwright trouvait le
  // bouton mais ne pouvait pas le cliquer (CI du 2026-10-19), et c'était le
  // vrai défaut — une souris non plus ne pouvait pas l'atteindre. Le
  // glissement au doigt, lui, n'est pas joué ici : il est couvert par les
  // tests de composant (`recipes-screen.test.tsx`).
  //
  // « Bibimbap simplifié » : recette du jeu de développement
  // (`prisma/seed/dev.ts`), qu'aucun autre parcours ne touche.
  await page.goto('/recettes/bibliotheque');

  // Les préférences de filtres sont mémorisées côté serveur, et le parcours
  // précédent laisse « Favoris » actif : on repart d'une liste non filtrée.
  await page.getByRole('button', { name: /^Filtres/ }).click();
  const filtres = page.getByRole('dialog');
  await filtres.getByRole('button', { name: 'Tout effacer' }).click();
  await filtres.getByRole('button', { name: 'Voir les recettes' }).click();

  await page.getByPlaceholder('Rechercher une recette').fill('Bibimbap');
  await expect(page.getByRole('link', { name: /^Bibimbap simplifié,/ })).toBeVisible();

  // Nommé par sa recette, jamais « Supprimer » seul : plusieurs cartes portent
  // la même action, un lecteur d'écran doit les distinguer (EF-23).
  const carte = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Bibimbap simplifié,/ }) });
  await carte.hover();
  await expect(carte).toHaveAttribute('data-revealed', 'true');
  await page.getByRole('button', { name: 'Supprimer Bibimbap simplifié' }).click();

  // Le geste seul n'efface pas : une confirmation s'interpose (D5).
  const confirmation = page.getByRole('dialog');
  await expect(confirmation.getByText(/quitte Mes recettes/)).toBeVisible();
  await Promise.all([
    page.waitForResponse((candidate) => /\/api\/v1\/recipes\/[^/]+\/archive$/.test(candidate.url()) && candidate.request().method() === 'POST'),
    confirmation.getByRole('button', { name: 'Effacer' }).click(),
  ]);

  await expect(page.getByRole('link', { name: /^Bibimbap simplifié,/ })).toHaveCount(0);

  // Toujours en base : la bascule « Archivées » la retrouve, entière.
  await page.getByRole('button', { name: /^Filtres/ }).click();
  const apres = page.getByRole('dialog');
  await apres.getByRole('group', { name: 'Pastilles rapides' }).getByRole('button', { name: 'Archivées' }).click();
  await apres.getByRole('button', { name: 'Voir les recettes' }).click();
  await expect(page.getByRole('link', { name: /^Bibimbap simplifié,/ })).toBeVisible();
});
