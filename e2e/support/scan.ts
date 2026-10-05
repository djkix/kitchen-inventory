import { expect, type Page } from '@playwright/test';
import {
  FAKE_VIDEO_BARCODE,
  FAKE_VIDEO_BARCODE_SECONDARY,
  FAKE_VIDEO_PRODUCT_NAME,
  FAKE_VIDEO_PRODUCT_NAME_SECONDARY,
} from '../playwright.config.ts';

/**
 * Aide partagée aux parcours qui scannent (section 19, tâche 9) : la vidéo de
 * caméra simulée alterne deux codes-barres par blocs, en boucle, sur toute la
 * durée de la session Playwright — indépendamment du moment où un test
 * donné commence à scanner. Le premier code lu par un test n'est donc
 * JAMAIS présupposé être l'un plutôt que l'autre : chaque scan doit
 * s'identifier lui-même depuis ce que le tiroir de validation affiche,
 * jamais depuis une constante choisie à l'avance.
 */
export interface ScannedProduct {
  readonly barcode: string;
  readonly name: string;
}

const SCANNABLE_PRODUCTS: readonly ScannedProduct[] = [
  { barcode: FAKE_VIDEO_BARCODE, name: FAKE_VIDEO_PRODUCT_NAME },
  { barcode: FAKE_VIDEO_BARCODE_SECONDARY, name: FAKE_VIDEO_PRODUCT_NAME_SECONDARY },
];

/**
 * Le tiroir de validation d'un scan doit déjà être visible avant cet appel.
 * Attend (avec réessais, comme partout ailleurs dans cette suite — jamais un
 * simple `isVisible()` à un instant donné) que l'un des deux codes connus se
 * peigne, puis relit lequel : le tiroir et son texte « code {barcode} » font
 * partie du même rendu React, mais rien ne garantit qu'ils se peignent dans
 * le même instant exact sous CI chargée.
 */
export async function identifyScannedProduct(page: Page): Promise<ScannedProduct> {
  // Seul texte sans ambiguïté sur cet écran pour cela : « · code {barcode} »
  // (confirm-sheet.tsx, apps/web/src/screens/scan) — jamais le nom du produit
  // seul, qui réapparaît dans une ligne marque · catégorie.
  const locators = SCANNABLE_PRODUCTS.map((product) => page.getByText(`code ${product.barcode}`));
  const eitherCode = locators.reduce((combined, locator) => combined.or(locator));
  await expect(eitherCode).toBeVisible();

  // Le tiroir est déjà peint (attente ci-dessus) : ces lectures ne sont plus
  // une course, juste la relecture d'un état stable.
  for (const [index, product] of SCANNABLE_PRODUCTS.entries()) {
    if (await locators[index]?.isVisible()) return product;
  }
  throw new Error('Aucun des deux codes-barres connus de la vidéo de test n’est visible sur le tiroir de validation.');
}

/**
 * Délai d'attente du tiroir de validation après un scan. Très au-dessus de ce
 * qu'exige le filtre anti-répétition : entre un premier scan confirmé et un
 * second scan d'un code différent, l'attente réelle est au plus la durée
 * d'un bloc de la vidéo (`BLOCK_SECONDS` dans `fixtures/barcode-video.ts`,
 * 3 s) — le second code n'a jamais été traité, donc accepté dès qu'il
 * apparaît, sans devoir lui-même attendre un délai de garde. 20 s laisse une
 * marge large pour la latence de CI, cohérente avec le délai déjà utilisé
 * partout ailleurs dans cette suite pour l'ouverture du tiroir de choix
 * d'emplacement.
 */
const CONFIRM_SHEET_TIMEOUT_MS = 20_000;

/**
 * Attend le tiroir de validation d'un scan (sans présupposer lequel des deux
 * codes y figure), identifie le produit lu, puis confirme l'ajout au libellé
 * de quantité donné. Utilisable aussi bien pour un premier scan que pour un
 * second scan enchaîné sans fermer la caméra (la rafale, section 3).
 */
export async function scanAndConfirm(page: Page, quantityButtonName = 'Ajouter 1 pièce'): Promise<ScannedProduct> {
  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: CONFIRM_SHEET_TIMEOUT_MS });
  const product = await identifyScannedProduct(page);
  await page.getByRole('button', { name: quantityButtonName }).click();
  await expect(page.getByText(`Ajouté : ${product.name}`)).toBeVisible({ timeout: 10_000 });
  return product;
}
