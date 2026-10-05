import { expect, type Page } from '@playwright/test';

/**
 * Vérification d'absence scopée à un emplacement (section 3, défaut corrigé
 * après revue) : `StockService.list` (apps/api/src/stock/stock.service.ts)
 * ne filtre `q` que sur le produit, jamais sur l'emplacement — une recherche
 * globale par nom de produit traverse donc TOUS les emplacements. Ce fichier
 * contient deux produits scannés dans des emplacements différents
 * (Congélateur, Réfrigérateur, Étagère du haut, Placard) sans restauration de
 * base entre les tests : une assertion qui cherche seulement par nom de
 * produit peut très bien trouver un lot posé par un autre test, dans un
 * autre emplacement, et se tromper dans les deux sens (échec à cause d'un
 * test voisin, ou succès qui ne tient qu'au hasard du minutage de la vidéo).
 *
 * `StockService.list` expose bien un paramètre `location`, mais il filtre
 * par préfixe de chemin — « cet emplacement ET ses descendants » (même
 * fichier, `where.location = { OR: [{ id }, { path: { startsWith } }] }`).
 * Inutilisable tel quel ici : « Étagère du haut » est un sous-emplacement de
 * « Placard » (`prisma/seed/dev.ts`), et les deux servent à des tests
 * différents de ce fichier — un lot posé sur l'étagère ne doit jamais
 * compter comme une preuve pour une assertion sur le placard. La portée
 * exacte (cet emplacement, jamais ses descendants) est donc reconstituée en
 * comparant `item.locationId`, après une requête non filtrée par
 * emplacement.
 *
 * Les deux appels (`/locations`, `/stock`) sont les mêmes que ceux que
 * l'application fait elle-même (`useLocationsQuery`, `useStockInfiniteQuery`)
 * — jamais un accès direct à la base : seule la vérification contourne
 * l'écran, pas le serveur.
 */

interface LocationNode {
  readonly id: string;
  readonly name: string;
  readonly children: readonly LocationNode[];
}

interface StockItemSummary {
  readonly locationId: string;
}

interface StockListResponse {
  readonly items: readonly StockItemSummary[];
}

function findLocationId(nodes: readonly LocationNode[], name: string): string | null {
  for (const node of nodes) {
    if (node.name === name) return node.id;
    const found = findLocationId(node.children, name);
    if (found) return found;
  }
  return null;
}

async function resolveLocationId(page: Page, locationName: string): Promise<string> {
  const response = await page.request.get('/api/v1/locations');
  const tree = (await response.json()) as LocationNode[];
  const id = findLocationId(tree, locationName);
  if (id === null) throw new Error(`Emplacement « ${locationName} » introuvable parmi /locations.`);
  return id;
}

/**
 * Affirme qu'aucun lot actif de `productName` n'existe dans `locationName`
 * EXACTEMENT (jamais dans un sous-emplacement — voir plus haut). Enveloppé
 * dans `expect(...).toPass` : le lot tout juste annulé par un test peut
 * encore apparaître une fraction de seconde le temps que l'invalidation de
 * la requête de stock se propage.
 */
export async function expectNoActiveStockOf(page: Page, productName: string, locationName: string): Promise<void> {
  const locationId = await resolveLocationId(page, locationName);
  await expect(async () => {
    const response = await page.request.get('/api/v1/stock', { params: { q: productName, status: 'active' } });
    const body = (await response.json()) as StockListResponse;
    expect(body.items.some((item) => item.locationId === locationId)).toBe(false);
  }).toPass({ timeout: 10_000 });
}

/**
 * Affirme qu'un lot actif de `productName` existe bien dans `locationName`
 * EXACTEMENT (même portée que `expectNoActiveStockOf`, jamais un
 * sous-emplacement). Pour un parcours où la caméra est refusée
 * (`e2e/support/camera.ts`) : `LastAddedBanner` (« Ajouté : … ») n'est rendu
 * que dans la branche caméra active de `scan-screen.tsx`
 * (`apps/web/src/screens/scan/scan-screen.tsx` : le bandeau bas, avec
 * `LastAddedBanner` et le compteur, est à l'intérieur de `<BarcodeScanner>`,
 * jamais affiché quand `cameraBlocked` est vrai) — y asserter ce bandeau
 * attendrait indéfiniment un élément qui ne peut structurellement pas
 * apparaître, quel que soit le succès réel de l'ajout. Cette vérification
 * passe par l'API (même requête que l'écran stock), pas par un élément
 * d'écran absent par construction dans ce parcours.
 */
export async function expectActiveStockOf(page: Page, productName: string, locationName: string): Promise<void> {
  const locationId = await resolveLocationId(page, locationName);
  await expect(async () => {
    const response = await page.request.get('/api/v1/stock', { params: { q: productName, status: 'active' } });
    const body = (await response.json()) as StockListResponse;
    expect(body.items.some((item) => item.locationId === locationId)).toBe(true);
  }).toPass({ timeout: 10_000 });
}

interface StockItemRef {
  readonly id: string;
  readonly quantity: number;
  readonly archivedAt: string | null;
}

interface StockListResponseWithRef {
  readonly items: readonly StockItemRef[];
}

/**
 * Résout l'identifiant du lot ACTIF unique de `productName` (section 3,
 * tâche 5) : contrairement au cas documenté plus haut, les produits choisis
 * par `p3-consommation.spec.ts` (`prisma/seed/dev.ts`, boucle des 60 lots —
 * les produits d'indice 20 à 39 dans l'ordre d'insertion n'y reçoivent
 * qu'un seul lot chacun) n'ont qu'un seul lot dans tout le jeu de données.
 * Une recherche par nom non scopée par emplacement est donc sans ambiguïté
 * pour eux. Échoue explicitement si ce n'est pas le cas (plutôt que de
 * prendre silencieusement le premier résultat), pour qu'un futur changement
 * du seed qui romprait cette hypothèse fasse échouer le test au lieu de le
 * rendre silencieusement faux.
 */
export async function getSingleActiveStockItemId(page: Page, productName: string): Promise<string> {
  const response = await page.request.get('/api/v1/stock', { params: { q: productName, status: 'active' } });
  const body = (await response.json()) as StockListResponseWithRef;
  if (body.items.length !== 1) {
    throw new Error(`Attendu un seul lot actif de « ${productName} », trouvé ${body.items.length}.`);
  }
  return body.items[0]!.id;
}

/** Lecture directe d'un lot par identifiant (`GET /stock/:id`), pour vérifier un état que l'écran ne montre plus (lot archivé). */
export async function getStockItemById(page: Page, id: string): Promise<StockItemRef> {
  const response = await page.request.get(`/api/v1/stock/${id}`);
  return (await response.json()) as StockItemRef;
}
