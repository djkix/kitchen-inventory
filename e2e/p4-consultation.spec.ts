import { expect, test, type Page } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';
import { resolveLocationId } from './support/stock.ts';

/**
 * Parcours P4 — consultation (section 3, tâche 6) : le téléphone en magasin
 * ou en main devant la cuisinière. Contrairement à P1-P3, ce parcours ne
 * modifie jamais le stock : chercher un article, le retrouver par
 * emplacement, voir ce qui périme bientôt, vérifier la version en service.
 * Le jeu de départ est entièrement celui du seed (`prisma/seed/dev.ts`,
 * 40 produits, jusqu'à 60 lots) : aucun produit ni lot n'est créé ici.
 *
 * Hors périmètre, à dessein : la vue « à racheter », qui dépend d'une liste
 * de courses et de seuils qui n'existent pas encore dans l'application
 * (EF-24, lot 2, `CLAUDE.md` section « Prochaine étape »). Aucun test
 * ci-dessous ne la suppose.
 *
 * NOTE sur le premier test (historique, pour mémoire). Au moment où ce
 * fichier a été écrit, l'exemple canonique d'EF-11 (« crepes » doit trouver
 * « Crêpes ») ne tenait PAS contre l'écran de stock réel : `StockService.list`
 * comparait ses termes au nom du produit avec un simple `contains` Prisma
 * (ILIKE), qui replie la casse mais jamais les accents — seul `GET /products`
 * passait par `unaccent_lite`. Le test avait donc été remplacé par une
 * démonstration de synonymes (« pork » → « Jambon blanc »). Depuis la 0.8.2
 * (migration `0007_unaccent_lite_ligatures`, voir le README), `StockService.list`
 * résout aussi ses identifiants via `unaccent_lite` (apps/api/src/stock/stock.service.ts) :
 * l'exemple canonique est redevenu vrai, le second test ci-dessous le couvre
 * directement sur un produit du seed. Le test par synonyme reste, pour ce
 * qu'il couvre en propre (EF-11 ne se limite pas aux accents).
 */

test.beforeAll(async () => {
  await restoreDatabase();
});

useSharedAdminSession();

interface StockListResponse {
  readonly items: ReadonlyArray<{ readonly product: { readonly name: string }; readonly effectiveExpiry: string | null }>;
}

/** Noms de produits actifs dans un emplacement donné, via le même appel que l'écran de stock (`GET /stock`). */
async function activeProductNamesIn(page: Page, locationId: string): Promise<string[]> {
  const response = await page.request.get('/api/v1/stock', { params: { location: locationId, status: 'active' } });
  const body = (await response.json()) as StockListResponse;
  return body.items.map((item) => item.product.name);
}

test('trouve un produit par un synonyme, sans rapport apparent avec son nom (EF-11)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('pork');

  // Carte d'article (apps/web/src/screens/stock/stock-item-card.tsx, `<article>`).
  const card = page.locator('article').filter({ hasText: 'Jambon blanc' });
  await expect(card).toBeVisible();
});

test('trouve un produit par un nom accentué saisi sans accent (EF-11)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('cafe');

  const card = page.locator('article').filter({ hasText: 'Café moulu' });
  await expect(card).toBeVisible();
});

test('filtre par emplacement, sous-emplacements compris', async ({ page }) => {
  await page.goto('/');

  // Seed (`prisma/seed/dev.ts`) : « Œufs » est posé une seule fois, dans
  // « Étagère du haut », elle-même sous-emplacement de « Placard »
  // (`Cuisine > Placard > Étagère du haut`). Calculé à la main depuis la
  // boucle des 60 lots (produit d'indice 24 sur 40, catégorie « Œufs » hors
  // de `locationByCategory` ⇒ emplacement choisi par `i % 3`, ici 24 % 3 = 0
  // ⇒ Étagère du haut ; jamais réutilisé par la seconde moitié de la boucle,
  // qui ne reparcourt que les indices 0 à 19) — jamais exécuté le seed pour
  // le vérifier, signalé comme pour les tâches précédentes.
  //
  // `StockService.list` (apps/api/src/stock/stock.service.ts) filtre
  // `location` par préfixe de chemin : « cet emplacement ET ses descendants »
  // (`where.location = { OR: [{ id }, { path: { startsWith: ... } }] }`),
  // confirmé aussi par le test API `apps/api/src/stock/stock.e2e-spec.ts`
  // (« filtre par sous-arbre d'emplacement et par recherche texte »). Aucun
  // écran de l'application n'expose un tel filtre par emplacement
  // (`stock-filters.tsx` ne propose qu'un regroupement d'affichage et des
  // pastilles de statut) : ce test appelle donc directement la même route
  // que l'écran de stock appelle déjà lui-même (`useStockInfiniteQuery`),
  // jamais un accès direct à la base — jugement à signaler si une vraie
  // interface de filtrage est attendue ici, hors mandat de cette tâche.
  const placardId = await resolveLocationId(page, 'Placard');
  const etagereId = await resolveLocationId(page, 'Étagère du haut');
  const frigoId = await resolveLocationId(page, 'Réfrigérateur');

  // Filtrer sur le parent (Placard) inclut un article posé dans son enfant
  // (Étagère du haut) : c'est tout l'objet du test.
  expect(await activeProductNamesIn(page, placardId)).toContain('Œufs');
  // Filtrer sur l'enfant lui-même le retrouve aussi (cas direct, sans effet de bord).
  expect(await activeProductNamesIn(page, etagereId)).toContain('Œufs');
  // Un emplacement sans rapport (ni l'emplacement ni un de ses ascendants/descendants) ne le retrouve jamais.
  expect(await activeProductNamesIn(page, frigoId)).not.toContain('Œufs');
});

test('liste ce qui périme bientôt, du plus urgent au moins urgent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Périme bientôt' }).click();
  await expect(page.getByRole('heading', { name: 'Périme bientôt', level: 1 })).toBeVisible();

  // Les dates du seed sont relatives au jour d'exécution
  // (`daysFromNow(offset)`, `prisma/seed/dev.ts`) : une date figée pourrait
  // devenir fausse. On n'affirme donc jamais une date, seulement un ORDRE —
  // en deux temps, pour isoler où une régression se situerait :
  //
  // 1) l'invariant du serveur lui-même : `StockService.expiring`
  //    (apps/api/src/stock/stock.service.ts) trie par `effectiveExpiry asc`
  //    (plus urgent d'abord) ; comparer les chaînes ISO consécutives suffit,
  //    sans connaître aucune valeur concrète.
  const expiring = await page.request.get('/api/v1/stock/expiring');
  const body = (await expiring.json()) as StockListResponse;
  expect(body.items.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < body.items.length; i++) {
    const previous = body.items[i - 1]!.effectiveExpiry;
    const current = body.items[i]!.effectiveExpiry;
    expect(previous).not.toBeNull();
    expect(current).not.toBeNull();
    expect(previous! <= current!).toBe(true);
  }

  // 2) que l'écran rend bien CET ordre-là, sans le rebattre : nom accessible
  // du bouton principal de chaque carte = « {nom}, {quantité}, {phrase de
  // péremption} » (stock-item-card.tsx) — on ne prend que le premier segment,
  // jamais la quantité ni la phrase (qu'il faudrait réimplémenter pour les
  // prédire, ce que les règles du projet interdisent).
  const cards = page.locator('article');
  await expect(cards).toHaveCount(body.items.length);
  const renderedNames: string[] = [];
  for (let i = 0; i < body.items.length; i++) {
    const label = await cards.nth(i).getByRole('button').first().getAttribute('aria-label');
    renderedNames.push(label!.split(',')[0]!);
  }
  expect(renderedNames).toEqual(body.items.map((item) => item.product.name));
});

test('affiche la version de l’application', async ({ page }) => {
  // Demandé explicitement par Franck en 0.5 (`CLAUDE.md`, « En service chez
  // Franck ») : la version est présente au bas de CHAQUE écran
  // (`VersionBadge`, apps/web/src/components/shell/app-shell.tsx, montée dans
  // `AppShell` hors de l'`Outlet`). C'est ce que ce test prouve.
  //
  // Ce qu'il ne prouve PAS (précision après revue) : que la valeur affichée
  // vienne de `GET /health` plutôt que de la constante figée au moment du
  // build. Le job `e2e` (.github/workflows/ci.yml) construit l'image avec
  // `build-args: APP_VERSION=ci`, le même littéral côté web et côté API : les
  // deux sources donnent « ci », aucune assertion ne peut les distinguer. Le
  // choix de la valeur affichée reste couvert par `versionState`
  // (apps/web/src/lib/version.test.ts).
  //
  // « ci » est une étiquette de validation délibérée, distincte du numéro de
  // version que seule une publication fixe sur l'image publiée : ni le job
  // `build-image` ni le job `e2e` ne publient quoi que ce soit.
  await page.goto('/');
  await expect(page.getByText('Inventaire ci', { exact: true })).toBeVisible();
});
