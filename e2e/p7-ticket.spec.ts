import { expect, test, type Page } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';

/**
 * Parcours P7 — ticket de caisse (EF-29, section 3, rangement des courses) :
 * choisir l'emplacement, déposer la photo du ticket, voir les lignes dans
 * l'ordre du ticket, décocher l'une, valider, retrouver la quantité montée
 * dans le Stock.
 *
 * Gemini est doublé (`e2e/fixtures/stub-server.ts`) : il rend un ticket fixe
 * (`receipts/gemini-ticket-pieces.json`), quelle que soit l'image. Le fichier
 * déposé n'est donc qu'un prétexte ; en revanche tout le reste est le code
 * réel — envoi multipart, rapprochement au catalogue, validation, mouvements
 * de stock. Le ticket compte aussi deux lignes qui ne sont pas des produits
 * (sac, total) : elles ne doivent jamais apparaître.
 *
 * Les quantités se lisent par l'API (`GET /stock`), la même route que l'écran,
 * et se comparent AVANT / APRÈS : les valeurs de départ viennent du jeu de
 * développement et ne sont jamais présupposées ici.
 */

test.beforeAll(async () => {
  await restoreDatabase();
});

useSharedAdminSession();

// Minuscule PNG valide : seul le type MIME compte pour l'API.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface StockListResponse {
  readonly items: ReadonlyArray<{ readonly quantity: number; readonly product: { readonly name: string } }>;
}

/** Quantité active totale d'un produit, tous emplacements confondus (nom comparé à l'identique : `q` tolère les synonymes). */
async function totalOf(page: Page, productName: string): Promise<number> {
  const response = await page.request.get('/api/v1/stock', { params: { q: productName, status: 'active' } });
  const body = (await response.json()) as StockListResponse;
  return body.items.filter((item) => item.product.name === productName).reduce((sum, item) => sum + Number(item.quantity), 0);
}

test('un ticket photographié, une ligne décochée, le reste entre au stock (EF-29)', async ({ page }) => {
  const yaourtBefore = await totalOf(page, 'Yaourt nature');
  const beurreBefore = await totalOf(page, 'Beurre doux');

  await page.goto('/courses');
  await expect(page.getByRole('heading', { name: 'Courses', level: 1 })).toBeVisible();

  // L'emplacement se choisit avant la photo : sans lui, le bouton reste inactif.
  const photographier = page.getByRole('button', { name: 'Photographier le ticket' });
  await expect(photographier).toBeDisabled();
  await page.getByRole('button', { name: /Choisir l’emplacement/ }).click();
  await page.getByRole('button', { name: 'Réfrigérateur', exact: false }).click();
  await expect(photographier).toBeEnabled();

  // Le champ fichier est masqué (`sr-only`) et ouvert par le bouton ; on le
  // renseigne directement, comme le ferait le sélecteur natif.
  await page.getByTestId('receipt-file').setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: TINY_PNG });

  // Dans l'ordre du ticket, produits seulement : sac et total n'y figurent pas.
  const cases = page.getByRole('checkbox');
  await expect(cases).toHaveCount(2, { timeout: 20_000 });
  await expect(cases.nth(0)).toHaveAccessibleName('Ajouter Yaourt nature');
  await expect(cases.nth(1)).toHaveAccessibleName('Ajouter Beurre doux');
  await expect(cases.nth(0)).toBeChecked();
  await expect(cases.nth(1)).toBeChecked();
  await expect(page.getByText('SAC CAISSE')).toHaveCount(0);
  await expect(page.getByText('TOTAL', { exact: true })).toHaveCount(0);

  // On décoche le beurre : le bouton le compte.
  await cases.nth(1).uncheck();
  await expect(page.getByRole('button', { name: 'Ajouter 1 produit' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter 1 produit' }).click();
  await expect(page.getByText('1 produit ajouté au stock')).toBeVisible();

  // Le yaourt a monté de la quantité du ticket ; le beurre n'a pas bougé.
  await expect(async () => {
    expect(await totalOf(page, 'Yaourt nature')).toBe(yaourtBefore + 4);
  }).toPass({ timeout: 10_000 });
  expect(await totalOf(page, 'Beurre doux')).toBe(beurreBefore);

  // Et le Stock l'affiche.
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill('Yaourt nature');
  await expect(page.locator('article').filter({ hasText: 'Yaourt nature' }).first()).toBeVisible();
});
