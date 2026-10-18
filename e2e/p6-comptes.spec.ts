import { expect, test } from '@playwright/test';
import { loginAsAdmin, signInWithGoogle } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';

/**
 * Parcours P6 — inscription et validation d'un compte (section 10, D1 à D4).
 * Hors cahier, comme P5 : c'est la fonctionnalité la plus récente du projet,
 * et la seule dont une régression enfermerait tout le monde dehors.
 *
 * Ce que le parcours exerce vraiment : le bouton de Google est doublé (le
 * script `accounts.google.com/gsi/client` ne peut pas se charger sans réseau),
 * mais le jeton qu'il remet est signé pour de bon et l'application le vérifie
 * avec `google-auth-library`, contre les clés publiques servies par la
 * doublure (`GOOGLE_CERTS_URL`, `docker-compose.e2e.yml`). Signature,
 * émetteur, audience et expiration sont donc contrôlés par le code de
 * production. Voir `e2e/support/auth.ts` pour la frontière exacte.
 *
 * Un seul test, parce que c'est une seule histoire et qu'elle se raconte dans
 * l'ordre : une adresse inconnue n'entre pas, un administrateur la valide,
 * elle entre. La découper en trois ferait dépendre chaque morceau de l'état
 * laissé par le précédent (la base n'est restaurée qu'une fois par fichier),
 * sans rien prouver de plus.
 */

const INVITEE_EMAIL = 'nouvelle@example.org';
const INVITEE_NAME = 'Nouvelle Venue';

test.beforeAll(async () => {
  await restoreDatabase();
});

test('une adresse inconnue attend une validation, puis entre une fois validée', async ({ page, browser }) => {
  // --- 1. L'adresse inconnue se connecte : la demande est créée, rien ne s'ouvre.
  await signInWithGoogle(page, INVITEE_EMAIL, INVITEE_NAME);
  await expect(page.getByText(/attend la validation/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stock', level: 1 })).toBeHidden();

  // Elle n'accède à rien : ni l'écran de stock, ni l'API derrière.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connexion', level: 1 })).toBeVisible();
  expect((await page.request.get('/api/v1/stock')).status()).toBe(401);

  // --- 2. Un administrateur la valide depuis Réglages › Comptes.
  // Contexte séparé : la page ci-dessus doit rester celle de l'invitée, sans
  // cookie d'administrateur.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAsAdmin(adminPage);
  await adminPage.goto('/reglages');

  // `<section aria-label="…">` nommée, donc un rôle `region` : les trois
  // listes de la section Comptes se distinguent par leur nom, jamais par
  // leur position dans la page.
  const enAttente = adminPage.getByRole('region', { name: 'Demandes en attente' });
  await expect(enAttente.getByText(INVITEE_EMAIL)).toBeVisible();
  await enAttente.getByRole('button', { name: 'Valider' }).click();

  // La demande quitte la liste d'attente pour celle des comptes actifs.
  await expect(adminPage.getByRole('region', { name: 'Comptes actifs' }).getByText(INVITEE_EMAIL)).toBeVisible();
  await expect(enAttente.getByText(INVITEE_EMAIL)).toBeHidden();
  await adminContext.close();

  // --- 3. Elle se reconnecte et entre.
  await signInWithGoogle(page, INVITEE_EMAIL, INVITEE_NAME);
  await expect(page.getByRole('heading', { name: 'Stock', level: 1 })).toBeVisible();
});
