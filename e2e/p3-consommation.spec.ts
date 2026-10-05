import { expect, test, type Locator, type Page } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';
import { expectNoActiveStockOf, getSingleActiveStockItemId, getStockItemById } from './support/stock.ts';

/**
 * Parcours P3 — consommation (section 3, tâche 5) : le geste de sortir un
 * article du placard et de le dire à l'application, depuis la liste de
 * stock (recherche + pas rapide, appui long pour « tout consommer ») et
 * depuis la fiche article (saisie libre dans le tiroir « Consommer »).
 *
 * Hors périmètre, à dessein [C1] : le basculement d'un article en liste de
 * courses quand il atteint zéro et qu'un seuil est configuré. Ni les seuils
 * ni la liste de courses n'existent dans l'application (EF-24, lot 2,
 * `CLAUDE.md` section « Prochaine étape ») — aucun test ci-dessous ne le
 * suppose.
 *
 * Contrairement à P1/P2, ce parcours ne scanne rien : le seed (`prisma/seed/
 * dev.ts`, boucle des 60 lots) fournit déjà le stock de départ. Chaque test
 * choisit un produit qui n'a qu'un SEUL lot dans tout le jeu de données
 * (vérifié en lisant le seed : les produits d'indice 20 à 39 dans l'ordre
 * d'insertion — de « Lait demi-écrémé » à « Reste de ratatouille » — n'y
 * reçoivent jamais de second lot, la boucle des 60 itérations ne les
 * reparcourant qu'une fois). Cela ne rend PAS la recherche par nom sans
 * ambiguïté pour autant (correctif après un premier échec en CI) : EF-11 la
 * rend volontairement tolérante aux synonymes, aux accents et à l'ordre des
 * mots (`expandSearchTerms`, `packages/shared/src/search/synonyms.ts`) —
 * chercher « Saumon fumé » retrouve aussi les deux lots de « Thon au
 * naturel » du seed par le groupe « poisson ». Une recherche texte ne prouve
 * donc jamais une ABSENCE (une carte qu'on cherche à ne plus trouver peut
 * très bien être remplacée par un autre produit du même groupe de synonymes,
 * qui ne part jamais) ; elle ne prouve qu'une PRÉSENCE (la carte qu'on
 * trouve est bien la bonne, vérifié par son propre texte). Les assertions
 * d'absence de ce fichier passent donc par `expectNoActiveStockOf`
 * (e2e/support/stock.ts, comparaison de `locationId`, jamais de texte) ;
 * seul le compte exact retourné par `getSingleActiveStockItemId` reste fiable
 * tel quel, parce qu'aucun des quatre produits choisis ci-dessous ne partage
 * de groupe de synonymes avec un autre produit du seed (vérifié dans
 * `packages/shared/src/search/synonyms.ts` : aucun groupe ne contient
 * « bananes », « jambon blanc » n'y est associé qu'à « porc »/« pork »/
 * « lardons », absents du seed, et « reste de ratatouille » n'y figure pas
 * du tout) — son propre commentaire le redit, pour ne pas avoir à revenir
 * ici à chaque lecture.
 *
 * Quatre produits distincts sont utilisés, un par test, pour que les tests
 * restent indépendants les uns des autres au sein de ce même fichier (la
 * base n'est restaurée qu'une fois par fichier, jamais par test) :
 *   - Bananes (Placard, 3 pièces)
 *   - Saumon fumé (Réfrigérateur, 3 pièces)
 *   - Jambon blanc (Réfrigérateur, 2 pièces)
 *   - Reste de ratatouille (Réfrigérateur, 3 pièces)
 *
 * Connexion : la session partagée de toute l'exécution
 * (`useSharedAdminSession`, `e2e/support/auth.ts`), jamais une connexion
 * réelle par test. Les quatre tests de ce fichier appelaient `loginAsAdmin`
 * chacun pour leur compte, soit quatre des dix tentatives par minute et par
 * IP qu'autorise `POST /auth/login` (`@Throttle`,
 * `apps/api/src/auth/auth.controller.ts`, quota partagé par tout le
 * conteneur `app`) : avec la connexion réelle de `smoke.spec.ts` et celle
 * qui établit la session partagée, l'exécution en consommait six pour aucun
 * gain — rien ici ne teste le formulaire de connexion, c'en est seulement le
 * préalable.
 */

test.beforeAll(async () => {
  await restoreDatabase();
});

useSharedAdminSession();

/** Carte d'article dans la liste de stock (`apps/web/src/screens/stock/stock-item-card.tsx`) : un `<article>` dont le texte contient le nom du produit. */
function stockCard(page: Page, productName: string): Locator {
  return page.locator('article').filter({ hasText: productName });
}

/**
 * Appui long (500 ms, `apps/web/src/hooks/use-long-press.ts`) : un `.click()`
 * Playwright ne suffit pas, il faut tenir le bouton. `use-long-press.ts`
 * réagit à de vrais évènements pointeur (`onPointerDown` arme un minuteur de
 * `delayMs` qui appelle `onLongPress` directement, sans attendre le relâché ;
 * `onPointerUp` ne déclenche `onClick` que si ce minuteur n'a pas encore
 * sonné) : un maintien de souris réel (pointerdown puis pointerup synthétisés
 * par Chromium pour la souris, bouton 0) suffit à le déclencher, sans qu'il
 * soit nécessaire d'émuler le tactile.
 *
 * Corrigé après un premier échec en CI (voir commit suivant) :
 * `target.boundingBox()` ne scrolle PAS l'élément dans la zone visible — à la
 * différence de `.click()`, qui le fait avant d'agir. Sur l'écran de
 * recherche, la carte peut se trouver bien après le pli (la liste n'est pas
 * filtrée qu'au produit visé : la recherche tolère les synonymes, EF-11,
 * `expandSearchTerms`, `packages/shared/src/search/synonyms.ts` — chercher
 * « Saumon fumé » retrouve aussi « Thon au naturel », le groupe « poisson »
 * les confond). Sans `scrollIntoViewIfNeeded()`, les coordonnées lues
 * peuvent tomber hors du viewport (constaté en CI : y ≈ 3714 pour un viewport
 * de 720 px de haut) : la pression tombe dans le vide, ni le clic court ni
 * l'appui long ne partent (confirmé par la trace réseau de l'échec : aucun
 * appel à `/consume`).
 */
async function longPress(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Bouton de consommation introuvable pour l’appui long.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('décrémente un article depuis la recherche', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('Bananes');

  const card = stockCard(page, 'Bananes');
  await expect(card).toBeVisible();
  // Quantité de départ du seed (prisma/seed/dev.ts) : 3 pièces, un seul lot.
  await expect(card.getByText('3 pièces', { exact: true })).toBeVisible();

  // Bouton « Consommer {pas} ; appui long pour tout consommer »
  // (stock-item-card.tsx) : un clic bref ne déclenche que le pas, jamais
  // l'appui long (use-long-press.ts, onClick tant que le minuteur n'a pas
  // eu le temps de se déclencher).
  await card.getByRole('button', { name: /^Consommer/ }).click();

  // Le pas d'une pièce (quantity-ui.ts, consumeStep('PIECE', 3) === 1) :
  // la quantité affichée passe de 3 à 2 pièces.
  await expect(card.getByText('2 pièces', { exact: true })).toBeVisible();
});

test('consomme tout par un appui long', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('Saumon fumé');

  const card = stockCard(page, 'Saumon fumé');
  await expect(card).toBeVisible();
  await expect(card.getByText('3 pièces', { exact: true })).toBeVisible();

  await longPress(page, card.getByRole('button', { name: /^Consommer/ }));

  // Message du toast d'annulation (stock-screen.tsx, `consume` : quantité
  // demandée === quantité du lot ⇒ « tout consommé », jamais « consommé »
  // seul, qui désigne une consommation partielle).
  await expect(page.getByText('Saumon fumé : tout consommé')).toBeVisible({ timeout: 5_000 });

  // Le lot à zéro est archivé (stock.quantity.ts, `recomputeQuantity`) et
  // quitte la liste active (stock.service.ts, `list`, `status: 'active'`
  // par défaut). Prouvé par absence de stock actif, jamais par une recherche
  // qui ne renverrait rien : la recherche tolère les synonymes (EF-11,
  // `expandSearchTerms`, `packages/shared/src/search/synonyms.ts`), et le
  // groupe « poisson » confond « saumon » et « thon » — chercher « Saumon
  // fumé » retrouve aussi les deux lots de « Thon au naturel » du seed, qui
  // ne disparaissent jamais. Une assertion sur « Rien ne correspond à … »
  // serait donc irréalisable par construction (déjà vu en échec CI). Portée
  // au Réfrigérateur, comme P1 : `expectNoActiveStockOf` compare les
  // `locationId`, pas le texte.
  await expectNoActiveStockOf(page, 'Saumon fumé', 'Réfrigérateur');
});

test('refuse de descendre sous zéro', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('Jambon blanc');

  const card = stockCard(page, 'Jambon blanc');
  await expect(card).toBeVisible();
  await expect(card.getByText('2 pièces', { exact: true })).toBeVisible();

  const id = await getSingleActiveStockItemId(page, 'Jambon blanc');

  // Épuise le lot par l'écran (comme le test précédent), pour obtenir un lot
  // réellement à zéro — pas une quantité négative fabriquée par le test.
  await longPress(page, card.getByRole('button', { name: /^Consommer/ }));
  await expect(page.getByText('Jambon blanc : tout consommé')).toBeVisible({ timeout: 5_000 });

  // Le bouton « Consommer » de la carte comme celui de la fiche article
  // disparaissent pour un lot archivé (stock-item-card.tsx et item-screen.tsx,
  // `{!archived && (...)}`) : l'écran n'offre donc plus aucun geste pour
  // tenter de consommer davantage. La règle qui refuse de descendre sous
  // zéro (`StockService.requireActive`, apps/api/src/stock/stock.service.ts :
  // « Ce lot est déjà épuisé », 422 `business_rule`) se vérifie ici en
  // rejouant directement l'appel que l'écran aurait fait s'il l'avait permis
  // — même route, mêmes identifiants de session que `expectNoActiveStockOf`
  // (e2e/support/stock.ts), jamais un accès direct à la base.
  const refused = await page.request.post(`/api/v1/stock/${id}/consume`, { data: { quantity: 1 } });
  expect(refused.status()).toBe(422);
  const refusedBody = (await refused.json()) as { error: { code: string; message: string } };
  expect(refusedBody.error.code).toBe('business_rule');
  expect(refusedBody.error.message).toBe('Ce lot est déjà épuisé');

  // Quantité inchangée : toujours zéro, toujours archivé — le refus n'a rien
  // écrit (pas de mouvement inséré avant la levée de l'erreur, stock.service.ts).
  const after = await getStockItemById(page, id);
  expect(after.quantity).toBe(0);
  expect(after.archivedAt).not.toBeNull();
});

test('la quantité affichée suit la somme des mouvements', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('Reste de ratatouille');

  const card = stockCard(page, 'Reste de ratatouille');
  await expect(card).toBeVisible();
  // Nom accessible de la carte (stock-item-card.tsx) : « {nom}, {quantité}, {phrase de péremption} ».
  await card.getByRole('button', { name: /^Reste de ratatouille,/ }).click();

  await expect(page.getByRole('heading', { name: 'Reste de ratatouille', level: 1 })).toBeVisible();
  // Quantité matérialisée affichée en tête de fiche (item-screen.tsx) : point
  // de départ du seed, un seul lot de 3 pièces.
  await expect(page.getByText('3 pièces', { exact: true })).toBeVisible();

  // Première consommation, saisie libre dans le tiroir (consume-sheet.tsx) :
  // 3 − 1 = 2. Ce n'est encore qu'une seule écriture, pas la preuve visée.
  await page.getByRole('button', { name: 'Consommer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consommer', level: 2 })).toBeVisible();
  await page.getByLabel('Quantité (pièce)').fill('1');
  await page.getByRole('button', { name: 'Consommer 1 pièce' }).click();
  await expect(page.getByText('2 pièces', { exact: true })).toBeVisible();

  // Deuxième consommation, enchaînée sans restaurer la base ni recharger la
  // page : c'est ici le point qui compte (CLAUDE.md, « StockItem.quantity
  // est une valeur matérialisée. La vérité est la somme des StockMovement »,
  // et `stock.quantity.ts`, `recomputeQuantity`, qui relit TOUS les mouvements
  // à chaque écriture plutôt que de soustraire du dernier affichage). Si la
  // quantité affichée ne reflétait que la dernière écriture (un bug qui
  // écrirait `quantity = 3 - 1` une seconde fois, ou qui ignorerait le
  // premier mouvement), cette assertion verrait encore « 2 pièces » au lieu
  // de la somme réelle (3 − 1 − 1 = 1).
  await page.getByRole('button', { name: 'Consommer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consommer', level: 2 })).toBeVisible();
  await page.getByLabel('Quantité (pièce)').fill('1');
  await page.getByRole('button', { name: 'Consommer 1 pièce' }).click();
  await expect(page.getByText('1 pièce', { exact: true })).toBeVisible();
});
