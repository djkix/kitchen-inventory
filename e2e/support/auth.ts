import { test, type BrowserContext, type Page } from '@playwright/test';

/** Identifiants créés par `prisma/seed/dev.ts` (section 19). */
export const ADMIN_EMAIL = 'admin@example.org';
export const ADMIN_PASSWORD = 'inventaire-dev-2026';

/**
 * Connexion par le formulaire (jamais par appel direct à `/auth/login` : on
 * veut exercer le vrai parcours). Rend la main une fois le stock affiché,
 * pour que les tests suivants n'aient pas à réattendre la navigation.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(ADMIN_EMAIL);
  await page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('heading', { name: 'Stock', level: 1 }).waitFor();
}

/**
 * Ouvre une session admin une seule fois pour tout le fichier (ou le bloc
 * `test.describe`) appelant, puis réapplique son cookie à chaque test
 * (`test.beforeAll` + `test.beforeEach`) plutôt que de répéter la connexion
 * complète par test. À appeler une fois, hors de tout test, au niveau du
 * fichier ou en tête d'un `test.describe` :
 *
 * ```ts
 * useSharedAdminSession();
 *
 * test('…', async ({ page }) => {
 *   await page.goto('/scan'); // déjà authentifié, sans repasser par /connexion
 * });
 * ```
 *
 * Pourquoi : `POST /auth/login` est limité à 10 tentatives par minute et par
 * IP (`@Throttle`, `apps/api/src/auth/auth.controller.ts`), un seuil partagé
 * par tout le conteneur `app` de l'exécution — donc par tous les fichiers de
 * test, qui passent tous par la même IP de navigateur depuis le runner. Un
 * fichier qui se connecte une fois par test épuise ce budget au fil des
 * fichiers qui s'ajoutent (observé en CI, tâche 4 : un fichier à quatre
 * connexions par test, ajouté à ceux qui existaient déjà, a fait dépasser le
 * seuil pour le dernier fichier de l'exécution par ordre alphabétique — une
 * panne qui n'avait rien à voir avec celui-ci). Ne pas utiliser cette
 * fonction pour un test qui vérifie précisément le parcours de connexion
 * lui-même (comme `smoke.spec.ts`, qui doit continuer à appeler
 * `loginAsAdmin` pour de vrai au moins une fois) : elle sert les tests pour
 * qui la connexion n'est qu'un préalable.
 *
 * Le cookie est gardé dans une fermeture propre à cet appel, jamais une
 * variable de module partagée entre fichiers — mais son ordre d'exécution
 * (une connexion, puis sa réutilisation par les tests qui suivent) repose
 * sur l'exécution strictement séquentielle de la suite (`workers: 1`,
 * `fullyParallel: false`, `e2e/playwright.config.ts`), comme
 * `restoreDatabase` (`e2e/support/database.ts`).
 */
export function useSharedAdminSession(): void {
  let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsAdmin(page);
    sessionCookies = await context.cookies();
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.context().addCookies(sessionCookies);
  });
}
