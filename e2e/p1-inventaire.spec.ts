import { expect, test, type Page } from '@playwright/test';
import { FAKE_VIDEO_BARCODE } from './playwright.config.ts';
import { loginAsAdmin } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';

/**
 * Parcours P1 — inventaire initial (section 3, tâche 3) : quelqu'un se place
 * devant un placard, choisit l'emplacement une fois, puis scanne les articles
 * les uns après les autres sans jamais refermer la caméra.
 *
 * Nom du produit retenu par la cascade de reconnaissance pour le code-barres
 * de la caméra simulée (product_name_fr de la fixture Open Food Facts
 * `off-3017620422003.json`, rejouée par la doublure) : jamais la marque seule
 * (voir `apps/web/src/screens/scan/confirm-sheet.tsx`, qui affiche aussi une
 * ligne marque · catégorie contenant le même mot « Nutella »).
 */
const PRODUIT_SCANNE = 'Nutella pâte à tartiner aux noisettes et au cacao';

/**
 * La vidéo de la caméra simulée (section 19, tâche 2) fige un seul
 * code-barres sur chaque image, et le filtre anti-répétition de l'application
 * (`apps/web/src/lib/scan-debounce.ts`, `createScanGate`) ne réaccepte un code
 * qu'une fois qu'il a « quitté le champ » — ce qui n'arrive jamais ici
 * puisque la vidéo ne contient qu'une image figée rejouée en boucle. Un
 * second scan automatique du même code est donc irréalisable sans fabriquer
 * une seconde vidéo (hors mandat de cette tâche, et risqué à faire sans banc
 * d'essai local). Le second article d'une rafale est donc ajouté par un
 * geste différent déjà prévu par l'écran — la saisie manuelle (« À la main »,
 * `apps/web/src/screens/scan/scan-screen.tsx`) — qui emprunte le même tiroir
 * sans quitter ni refermer la caméra. Signalé au coordinateur dans le rapport.
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
  await page.getByRole('button', { name: 'Ignorer' }).click();

  await page.goto('/stock');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill(PRODUIT_SCANNE);
  await expect(page.getByText(`Rien ne correspond à « ${PRODUIT_SCANNE} »`)).toBeVisible({ timeout: 10_000 });
});

test('enchaîne deux scans sans refermer la caméra', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Congélateur', exact: false }).click({ timeout: 20_000 });

  // Premier article : lu par la caméra simulée.
  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ajouter 1 pièce' }).click();
  await expect(page.getByText(`Ajouté : ${PRODUIT_SCANNE}`)).toBeVisible({ timeout: 10_000 });

  // La caméra reste ouverte (bouton de fermeture de l'écran scan toujours là,
  // aucune navigation) : le deuxième article est ajouté sans quitter l'écran,
  // par la saisie manuelle (voir la fonction utilitaire en tête de fichier).
  await expect(page.getByRole('button', { name: 'Fermer le scan' })).toBeVisible();
  await ajouterArticleManuellement(page, 'Farine de blé T55');

  await expect(page.getByText('2 ajoutés')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Fermer le scan' })).toBeVisible();
});

test('garde l’emplacement choisi d’un article à l’autre', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Réfrigérateur', exact: false }).click({ timeout: 20_000 });

  const emplacementCourant = page.getByRole('button', { name: 'Emplacement courant : Réfrigérateur. Changer' });
  await expect(emplacementCourant).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ajouter 1 pièce' }).click();
  await expect(page.getByText(`Ajouté : ${PRODUIT_SCANNE}`)).toBeVisible({ timeout: 10_000 });

  // Toujours le même emplacement après le premier article, sans repasser par
  // le tiroir de choix.
  await expect(emplacementCourant).toBeVisible();

  // Deuxième article (saisie manuelle, caméra à usage unique — voir plus
  // haut) : le champ emplacement est masqué par `lockLocation`, preuve qu'il
  // est repris de la session de scan plutôt que redemandé.
  await ajouterArticleManuellement(page, 'Riz basmati');
  await expect(page.getByText('2 ajoutés')).toBeVisible({ timeout: 10_000 });
  await expect(emplacementCourant).toBeVisible();
});

test('ajoute en quantité 1 par défaut', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Étagère du haut', exact: false }).click({ timeout: 20_000 });

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  // Unique sur cet écran (tâche 2) : confirme que c'est bien le même article
  // lu par la caméra simulée qui est proposé à la validation.
  await expect(page.getByText(`code ${FAKE_VIDEO_BARCODE}`)).toBeVisible();
  // Quantité pré-remplie à 1 (pas de l'unité pièce), jamais modifiée ici.
  await expect(page.getByRole('textbox', { name: 'Quantité en pièce' })).toHaveValue('1');

  await page.getByRole('button', { name: 'Ajouter 1 pièce' }).click();
  await expect(page.getByText(`Ajouté : ${PRODUIT_SCANNE}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('1 pièce')).toBeVisible();
});

test('annule l’ajout depuis le bandeau dans les cinq secondes', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/scan');
  // Le « Placard » n'a reçu aucun lot dans le test de régression plus haut
  // (la validation y a été annulée) : le lot créé ici y est donc le seul,
  // et son annulation doit bien le faire disparaître de la liste du stock.
  await page.getByRole('button', { name: 'Placard', exact: false }).click({ timeout: 20_000 });

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ajouter 1 pièce' }).click();
  await expect(page.getByText(`Ajouté : ${PRODUIT_SCANNE}`)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText(`${PRODUIT_SCANNE} retiré`)).toBeVisible({ timeout: 5_000 });

  await page.goto('/stock');
  await page.getByRole('searchbox', { name: 'Rechercher un article' }).fill(PRODUIT_SCANNE);
  await expect(page.getByText(`Rien ne correspond à « ${PRODUIT_SCANNE} »`)).toBeVisible({ timeout: 10_000 });
});
