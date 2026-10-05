import { expect, test } from '@playwright/test';
import { loginAsAdmin, useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';
import { identifyScannedProduct } from './support/scan.ts';

/**
 * Première session bout en bout (section 19, tâche 2) : le montage répond,
 * une session s'ouvre, et — le test qui décide du reste du plan — la caméra
 * simulée permet de lire un code-barres jusqu'au tiroir de validation.
 *
 * Connexion : le deuxième test ci-dessous appelle `loginAsAdmin` pour de
 * vrai — c'est son objet même, prouver que le formulaire de connexion mène
 * bien au stock. Le troisième n'a besoin que d'être authentifié, pas de
 * reprouver la connexion : il passe par `useSharedAdminSession`
 * (`e2e/support/auth.ts`), scopé à son propre `test.describe` pour ne pas
 * authentifier aussi le premier test, qui doit au contraire rester anonyme
 * (il vérifie l'écran de connexion lui-même).
 */

test.beforeAll(async () => {
  await restoreDatabase();
});

test('l’application répond et affiche la connexion', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible();
});

test('une session s’ouvre et le stock s’affiche', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Stock', level: 1 })).toBeVisible();
  // Le jeu de seed pose toujours des lots : la liste n'est jamais vide.
  await expect(page.getByText(/^\d+ articles?$/)).toBeVisible();
});

test.describe('une fois connecté', () => {
  useSharedAdminSession();

  test('la caméra simulée permet de lire un code-barres', async ({ page }) => {
    await page.goto('/scan');

    // Premier passage sur l'écran scan pour cette session de navigateur :
    // aucun emplacement n'est mémorisé, le tiroir de choix s'ouvre seul. La
    // liste est l'arbre des emplacements aplati (`LocationList`) : le nom
    // accessible de chaque bouton concatène le nom et, s'il est non nul, le
    // nombre d'articles qu'il contient (ex. « Placard 29 ») — jamais le nom
    // seul ni le chemin complet. D'où un nom partiel, non exact.
    await page.getByRole('button', { name: 'Placard', exact: false }).click({ timeout: 20_000 });

    // La vidéo de la caméra simulée alterne deux codes-barres par blocs, en
    // boucle, indépendamment du moment où ce test démarre (section 19, tâche
    // 9) : le code lu ici n'est donc jamais présupposé être l'un plutôt que
    // l'autre des deux produits des fixtures Open Food Facts (toutes deux
    // absentes du seed : la doublure est bien sollicitée) — il est identifié
    // depuis ce que le tiroir affiche.
    const confirmTitle = page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 });
    await expect(confirmTitle).toBeVisible({ timeout: 20_000 });
    const product = await identifyScannedProduct(page);
    // « Nutella » ou « Shin Ramyun » seul serait ambigu pour le premier : il
    // apparaît à la fois dans le nom du produit et dans la ligne marque ·
    // catégorie (confirm-sheet.tsx). Le nom retenu par la cascade de
    // reconnaissance (product_name_fr s'il existe, sinon product_name —
    // open-food-facts.client.ts) est bien celui que `identifyScannedProduct`
    // lit dans les fixtures, exact et complet.
    await expect(page.getByText(product.name, { exact: true })).toBeVisible();
    // Unique sur cet écran : seul confirm-sheet.tsx rend « code <code-barres> »,
    // uniquement une fois le produit reconnu (jamais recognition-sheet.tsx, qui
    // ne s'affiche que pour un code-barres inconnu).
    await expect(page.getByText(`code ${product.barcode}`)).toBeVisible();
  });
});
