import { expect, test } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { denyCameraForTest } from './support/camera.ts';
import { restoreDatabase } from './support/database.ts';
import { identifyScannedProduct } from './support/scan.ts';

/**
 * Parcours P2 — rangement des courses (section 3, tâche 4) : validation d'un
 * article reconnu, quantité saisie au clavier avec une virgule française,
 * repli sur la saisie manuelle quand le code-barres est inconnu, et panne du
 * fournisseur de reconnaissance signalée sans perdre ce qui avait déjà été
 * saisi.
 *
 * Hors périmètre, à dessein [C1] : la saisie ou la capture de la date limite
 * de consommation (DLC) directement depuis le tiroir de validation du scan.
 * Cette fonctionnalité n'existe pas dans l'application — demandée deux fois
 * par Franck, reportée deux fois (voir `CLAUDE.md`, « Prochaine étape ») —
 * aucun test ci-dessous ne la couvre donc, pour ne pas donner l'illusion
 * qu'elle est déjà prise en charge.
 *
 * Comme pour P1, la vidéo de la caméra simulée alterne deux codes-barres par
 * blocs, en boucle : aucun test de ce fichier ne présuppose lequel des deux
 * produits des fixtures Open Food Facts apparaît en premier (voir
 * `identifyScannedProduct`, `e2e/support/scan.ts`).
 *
 * Chaque test choisit son propre emplacement (jamais partagé avec un autre
 * test de ce fichier) : la base n'est restaurée qu'une fois par fichier
 * (`beforeAll`), donc les lots ajoutés par un test restent visibles aux
 * suivants, et il n'existe que deux produits de fixtures — toute assertion
 * de présence ou d'absence doit rester scopée à un emplacement ou à un état
 * propre au test, jamais à une recherche globale par nom de produit (déjà vu
 * en défaut sur P1 : une recherche `q=<nom>` est globale à tous les
 * emplacements et peut être polluée par un autre test du même fichier).
 * Les assertions ci-dessous portent donc sur le bandeau « Ajouté : … » ou le
 * tiroir de validation eux-mêmes (état éphémère de CE test, jamais partagé),
 * jamais sur une recherche dans /stock.
 *
 * Connexion : une seule vraie connexion par fichier (`useSharedAdminSession`,
 * `e2e/support/auth.ts`), jamais une par test — voir la documentation de
 * cette fonction pour le budget de tentatives par minute que ce fichier a
 * fait dépasser en CI (tâche 4) avant ce correctif.
 *
 * Panne du fournisseur de reconnaissance (test 4, plus bas) : faute d'un
 * chemin réel pour la provoquer dans la doublure elle-même (voir le
 * commentaire détaillé sur place), l'assertion s'arrête à la frontière du
 * navigateur — `page.route` intercepte uniquement l'appel que le navigateur
 * fait lui-même à l'API, jamais la doublure ou le fournisseur Gemini réel.
 */

test.beforeAll(async () => {
  await restoreDatabase();
});

useSharedAdminSession();

test('ouvre le tiroir de validation sur un produit reconnu', async ({ page }) => {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Congélateur', exact: false }).click({ timeout: 20_000 });

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });
  const product = await identifyScannedProduct(page);
  // Unique sur cet écran (confirm-sheet.tsx, tâche 2) : confirme que le
  // produit proposé est bien celui que la caméra simulée vient de lire,
  // donc que la reconnaissance a bien eu lieu (pas un code-barres inconnu).
  await expect(page.getByText(`code ${product.barcode}`)).toBeVisible();

  // Quantité proposée par défaut : le pas de l'unité du produit (confirm-sheet.tsx),
  // toujours 1 pièce ici puisque les deux produits de fixtures ont `defaultUnit: 'PIECE'`
  // (apps/api/src/recognition/open-food-facts.client.ts, jamais déduit du poids net).
  await expect(page.getByRole('textbox', { name: 'Quantité en pièce' })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Ajouter 1 pièce' })).toBeVisible();

  // Ignoré plutôt que confirmé : ce test vérifie seulement que la
  // reconnaissance ouvre le tiroir, pas l'ajout en stock (déjà couvert par P1).
  await page.getByRole('button', { name: 'Ignorer' }).click();
});

test('accepte une quantité saisie à la virgule française', async ({ page }) => {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Réfrigérateur', exact: false }).click({ timeout: 20_000 });

  await expect(page.getByRole('heading', { name: 'Ajouter cet article ?', level: 2 })).toBeVisible({ timeout: 20_000 });

  // Champ texte, pas « number » : le clavier décimal français produit une
  // virgule qu'un champ numérique rejetterait en silence (confirm-sheet.tsx,
  // commentaire sur l'`<input type="text" inputMode="decimal">`).
  await page.getByRole('textbox', { name: 'Quantité en pièce' }).fill('1,5');
  const confirmButton = page.getByRole('button', { name: 'Ajouter 1,5 pièce' });
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  // Bandeau « Ajouté : … » (last-added-banner.tsx), état propre à cette
  // session de scan : aucune recherche globale nécessaire.
  await expect(page.getByText('1,5 pièce')).toBeVisible({ timeout: 10_000 });
});

test('retombe sur la saisie manuelle quand le code-barres est inconnu', async ({ page }) => {
  // Code-barres absent des deux seuls codes que la doublure reconnaît
  // (`e2e/fixtures/stub-server.ts`, `OFF_BARCODES`) : n'importe quel autre
  // code-barres valide (régime EAN-8/12/13/14, `barcodeSchema`,
  // `packages/shared/src/schemas/products.ts`) retombe automatiquement sur
  // `off-not-found.json` (404) — c'est le comportement par défaut de la
  // doublure pour tout code qui n'est pas dans sa table, aucune bascule à
  // demander explicitement.
  const UNKNOWN_BARCODE = '00000001';

  // La vidéo truquée ne peut jamais produire ce code-barres (voir
  // `e2e/support/camera.ts`) : seule la saisie manuelle de `CameraError`
  // (repli caméra refusée) permet de le proposer à la reconnaissance.
  await denyCameraForTest(page);
  await page.goto('/scan');

  // Sans caméra, l'emplacement n'est demandé qu'à la première saisie
  // (scan-screen.tsx, commentaire sur l'effet de réconciliation) : le choisir
  // explicitement via le bandeau du haut avant de saisir le code-barres, sans
  // quoi la première tentative ouvrirait seulement le tiroir de choix et
  // perdrait la saisie en cours (camera-error.tsx vide son champ après
  // chaque soumission, qu'elle aboutisse ou non).
  await page.getByRole('button', { name: 'Choisir l’emplacement' }).click();
  await page.getByRole('button', { name: 'Étagère du haut', exact: false }).click();

  await expect(page.getByRole('heading', { name: 'Caméra refusée', level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Code EAN-8, EAN-13 ou UPC').fill(UNKNOWN_BARCODE);
  await page.getByRole('button', { name: 'Rechercher ce code' }).click();

  await expect(page.getByRole('heading', { name: 'Code-barres inconnu', level: 2 })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(`${UNKNOWN_BARCODE} n’est ni dans votre référentiel ni dans Open Food Facts.`)).toBeVisible();

  await page.getByRole('button', { name: 'Créer à la main' }).click();
  await expect(page.getByRole('heading', { name: 'Nouveau produit', level: 2 })).toBeVisible();
  // Le code-barres saisi est repris tel quel dans la fiche manuelle
  // (`openManualForm`, `use-scan-flow.ts` : `defaults: { barcode, ... }`,
  // champ « Code-barres » de `product-form.tsx`) : rien de la saisie n'est
  // perdu en retombant sur la création à la main.
  await expect(page.getByLabel('Code-barres')).toHaveValue(UNKNOWN_BARCODE);

  await page.getByLabel('Nom', { exact: true }).fill('Pâtes semi-complètes inconnues');
  await page.getByRole('button', { name: 'Ajouter au stock' }).click();
  await expect(page.getByText('Ajouté : Pâtes semi-complètes inconnues')).toBeVisible({ timeout: 10_000 });
});

test('signale la panne du service de reconnaissance sans perdre la saisie', async ({ page }) => {
  // Deuxième code-barres inconnu, distinct de celui du test précédent : les
  // deux tests du fichier qui saisissent un code à la main ne doivent jamais
  // partager le même, pour rester reconnaissables l'un de l'autre si jamais
  // l'un des deux finissait par créer un produit.
  const UNKNOWN_BARCODE = '00000002';

  await denyCameraForTest(page);
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Choisir l’emplacement' }).click();
  await page.getByRole('button', { name: 'Placard', exact: false }).click();

  await expect(page.getByRole('heading', { name: 'Caméra refusée', level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Code EAN-8, EAN-13 ou UPC').fill(UNKNOWN_BARCODE);
  await page.getByRole('button', { name: 'Rechercher ce code' }).click();
  await expect(page.getByRole('heading', { name: 'Code-barres inconnu', level: 2 })).toBeVisible({ timeout: 10_000 });

  // Panne du fournisseur de reconnaissance (Gemini, derrière la doublure) :
  // aucun mécanisme de l'application ne permet de la provoquer de bout en
  // bout depuis un test piloté par le seul navigateur. L'en-tête générique de
  // la doublure (`x-stub-force-status`, `e2e/fixtures/stub-server.ts`) force
  // une panne sur n'importe laquelle de ses routes, mais seulement pour
  // l'appelant qui le pose lui-même sur sa propre requête — ici
  // `apps/api` (`GeminiProvider.recognize`,
  // `apps/api/src/recognition/providers/gemini.provider.ts`), qui ne
  // transmet jamais les en-têtes reçus du navigateur (`HTTP_CLIENT` est un
  // client HTTP unique pour tout le processus,
  // `apps/api/src/common/http-client.ts` ; aucune route ni middleware de
  // `apps/api/src/app.module.ts` ne relaie un en-tête du navigateur vers cet
  // appel sortant, vérifié par lecture du code). Impossible donc de faire
  // échouer la doublure elle-même depuis ce test sans modifier l'application.
  //
  // À la place : interception réseau du seul appel que le NAVIGATEUR fait
  // réellement lui-même, `POST /api/v1/scan/image`, pour lui substituer
  // exactement la réponse que produirait un vrai échec de Gemini relayé par
  // l'API (`ApiError.providerUnavailable`, 502, code `provider_unavailable` —
  // `apps/api/src/common/api-error.ts` et `apps/api/src/recognition/
  // recognition.service.ts`, catch de `recognizeImage`). Le reste du
  // parcours (choix d'emplacement, code-barres inconnu, tiroir de
  // reconnaissance, bascule sur la fiche manuelle) passe par la vraie pile.
  // Jugement à signaler : ce n'est pas « la doublure » au sens strict du
  // brief qui échoue ici, faute d'un chemin réel pour le lui demander.
  await page.route('**/api/v1/scan/image', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'provider_unavailable',
          message: 'Fournisseur de vision Gemini en erreur (500)',
          details: { imagePath: null, rawId: 'e2e-panne-simulee' },
        },
      }),
    });
  });

  await page.getByRole('button', { name: 'Photographier l’emballage' }).click();

  // PNG 1x1 minimal : image réellement décodable par `createImageBitmap`
  // (`apps/web/src/lib/image.ts`, `photoFileToJpeg`), qu'un fichier
  // arbitraire ne serait pas — le contenu réel importe peu, la doublure
  // n'est de toute façon jamais atteinte pour cette requête.
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('input[type="file"]').setInputFiles({ name: 'produit.png', mimeType: 'image/png', buffer: TINY_PNG });

  await expect(page.getByRole('heading', { name: 'Fournisseur injoignable', level: 2 })).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText('Fournisseur injoignable, photo conservée à identifier. Vous pouvez créer la fiche à la main : la photo y sera rattachée.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Créer la fiche à la main' }).click();
  await expect(page.getByRole('heading', { name: 'Nouveau produit', level: 2 })).toBeVisible();
  // Rien de la saisie n'a été perdu par la panne : le code-barres déjà
  // identifié comme inconnu est toujours repris dans la fiche manuelle
  // (`RecognitionSheet`, bouton « Créer la fiche à la main » → `onManual(phase.barcode, phase.imagePath)`,
  // `apps/web/src/screens/scan/recognition-sheet.tsx`).
  await expect(page.getByLabel('Code-barres')).toHaveValue(UNKNOWN_BARCODE);
});
