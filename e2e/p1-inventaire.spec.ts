import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';
import { identifyScannedProduct, scanAndConfirm } from './support/scan.ts';

/**
 * Parcours P1 — inventaire initial (section 3, tâche 3) : quelqu'un se place
 * devant un placard, choisit l'emplacement une fois, puis scanne les articles
 * les uns après les autres sans jamais refermer la caméra.
 *
 * La vidéo de la caméra simulée alterne deux codes-barres par blocs, en
 * boucle, indépendamment du moment où un test donné commence à scanner
 * (section 19, tâche 9) : aucun test de ce fichier ne présuppose donc lequel
 * des deux produits des fixtures Open Food Facts apparaît en premier — voir
 * `scanAndConfirm` / `identifyScannedProduct` (`e2e/support/scan.ts`), qui
 * l'identifient depuis ce que le tiroir de validation affiche.
 */

/**
 * Saisie manuelle (« À la main », `apps/web/src/screens/scan/scan-screen.tsx`) :
 * un geste de l'écran de scan distinct de la rafale, qui emprunte le même
 * tiroir sans quitter ni refermer la caméra. Conservé comme troisième article
 * du test de rafale ci-dessous, pour rester couvert, mais plus comme
 * remplacement des scans eux-mêmes.
 */
async function ajouterArticleManuellement(page: Page, nom: string) {
  await page.getByRole('button', { name: 'À la main' }).click();
  await expect(page.getByRole('heading', { name: 'Nouveau produit', level: 2 })).toBeVisible();
  await page.getByLabel('Nom', { exact: true }).fill(nom);
  await page.getByRole('button', { name: 'Ajouter au stock' }).click();
}

test.beforeAll(async () => {
  await restoreDatabase();
});

test('ne crée rien tant que la validation n’a pas été faite', async ({ page }) => {
  // Régression du défaut corrigé en 0.6 : le scan seul (sans validation du
  // tiroir) ne doit jamais ajouter de lot.
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Placard', exact: false }).click({ timeout: 20_000 });

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  const product = await identifyScannedProduct(page);
  await page.getByRole('button', { name: 'Ignorer' }).click();

  await page.goto('/stock');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill(product.name);
  await expect(page.getByText(`Rien ne correspond à « ${product.name} »`)).toBeVisible({ timeout: 10_000 });
});

test('enchaîne deux scans sans refermer la caméra', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Congélateur', exact: false }).click({ timeout: 20_000 });

  // Premier article : lu par la caméra simulée.
  const first = await scanAndConfirm(page);

  // Deuxième article : un vrai second scan, sans refermer ni quitter la
  // caméra — c'est le geste que ce test vérifie (la rafale, section 3), pas
  // une saisie manuelle qui le contournerait. Le filtre anti-répétition
  // (`createScanGate`, `apps/web/src/lib/scan-debounce.ts`) ne réaccepte le
  // premier code qu'après qu'il ait quitté le champ ET que les 2 s de garde
  // soient passées ; le second code, lui, n'a encore jamais été traité dans
  // cette session et est donc accepté dès qu'il apparaît, au prochain bloc
  // de la vidéo (`BLOCK_SECONDS` dans `fixtures/barcode-video.ts`, 3 s) — au
  // plus une durée de bloc après la fermeture du tiroir du premier article.
  // `scanAndConfirm` attend ce résultat (le tiroir qui réapparaît), jamais
  // une durée fixe, avec une marge large pour franchir cette frontière.
  await expect(page.getByRole('button', { name: 'Fermer le scan' })).toBeVisible();
  const second = await scanAndConfirm(page);
  // Les deux scans doivent avoir lu des codes différents : un même code
  // relu signalerait que le filtre anti-répétition n'a pas fait son travail,
  // ou que la vidéo n'a pas changé de bloc entre les deux scans.
  expect(second.barcode).not.toBe(first.barcode);
  await expect(page.getByText('2 ajoutés')).toBeVisible({ timeout: 10_000 });

  // Troisième article, par saisie manuelle : la caméra reste ouverte, et ce
  // geste alternatif de l'écran de scan reste couvert sans se substituer à
  // la rafale testée ci-dessus.
  await expect(page.getByRole('button', { name: 'Fermer le scan' })).toBeVisible();
  await ajouterArticleManuellement(page, 'Farine de blé T55');
  await expect(page.getByText('3 ajoutés')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Fermer le scan' })).toBeVisible();
});

test('garde l’emplacement choisi d’un article à l’autre', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Réfrigérateur', exact: false }).click({ timeout: 20_000 });

  const emplacementCourant = page.getByRole('button', { name: 'Emplacement courant : Réfrigérateur. Changer' });
  await expect(emplacementCourant).toBeVisible();

  const first = await scanAndConfirm(page);

  // Toujours le même emplacement après le premier article, sans repasser par
  // le tiroir de choix.
  await expect(emplacementCourant).toBeVisible();

  // Deuxième article, par un vrai second scan (la rafale) : la preuve que
  // l'emplacement est repris de la session de scan plutôt que redemandé n'a
  // de sens que si ce second article vient bien d'un second scan, pas d'une
  // saisie manuelle qui n'aurait jamais redemandé l'emplacement de toute
  // façon.
  const second = await scanAndConfirm(page);
  expect(second.barcode).not.toBe(first.barcode);
  await expect(page.getByText('2 ajoutés')).toBeVisible({ timeout: 10_000 });
  await expect(emplacementCourant).toBeVisible();
});

test('ajoute en quantité 1 par défaut', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Étagère du haut', exact: false }).click({ timeout: 20_000 });

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  const product = await identifyScannedProduct(page);
  // Unique sur cet écran (tâche 2) : confirme que c'est bien le même article
  // lu par la caméra simulée qui est proposé à la validation.
  await expect(page.getByText(`code ${product.barcode}`)).toBeVisible();
  // Quantité pré-remplie à 1 (pas de l'unité pièce), jamais modifiée ici.
  await expect(page.getByRole('textbox', { name: 'Quantité en pièce' })).toHaveValue('1');

  await page.getByRole('button', { name: 'Ajouter 1 pièce' }).click();
  await expect(page.getByText(`Ajouté : ${product.name}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('1 pièce')).toBeVisible();
});

test('annule l’ajout depuis le bandeau dans les cinq secondes', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  // Le « Placard » n'a reçu aucun lot dans le test de régression plus haut
  // (la validation y a été annulée) : le lot créé ici y est donc le seul,
  // et son annulation doit bien le faire disparaître de la liste du stock.
  await page.getByRole('button', { name: 'Placard', exact: false }).click({ timeout: 20_000 });

  const product = await scanAndConfirm(page);

  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText(`${product.name} retiré`)).toBeVisible({ timeout: 5_000 });

  await page.goto('/stock');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill(product.name);
  await expect(page.getByText(`Rien ne correspond à « ${product.name} »`)).toBeVisible({ timeout: 10_000 });
});
