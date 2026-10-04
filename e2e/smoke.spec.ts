import { expect, test } from '@playwright/test';
import { FAKE_VIDEO_BARCODE } from './playwright.config.ts';
import { loginAsAdmin } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';

/**
 * Première session bout en bout (section 19, tâche 2) : le montage répond,
 * une session s'ouvre, et — le test qui décide du reste du plan — la caméra
 * simulée permet de lire un code-barres jusqu'au tiroir de validation.
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

test('la caméra simulée permet de lire un code-barres', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');

  // Premier passage sur l'écran scan pour cette session de navigateur :
  // aucun emplacement n'est mémorisé, le tiroir de choix s'ouvre seul.
  await page.getByRole('button', { name: 'Placard', exact: true }).click({ timeout: 20_000 });

  // La vidéo de la caméra simulée boucle sur le code-barres du Nutella des
  // fixtures Open Food Facts (absent du seed : la doublure est bien sollicitée).
  const confirmTitle = page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 });
  await expect(confirmTitle).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Nutella', { exact: false })).toBeVisible();
  await expect(page.getByText(`code ${FAKE_VIDEO_BARCODE}`)).toBeVisible();
});
