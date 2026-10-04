import type { Page } from '@playwright/test';

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
