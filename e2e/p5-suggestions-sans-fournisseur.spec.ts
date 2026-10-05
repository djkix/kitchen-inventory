import { expect, test } from '@playwright/test';
import { useSharedAdminSession } from './support/auth.ts';
import { restoreDatabase } from './support/database.ts';

/**
 * Parcours P5 — suggestions de recettes (section 3, tâche 7, EF-25, EF-26) :
 * dernier cas, le fournisseur de suggestions n'est PAS configuré
 * (`VISION_PROVIDER=none`). Volontairement isolé de `p5-suggestions.spec.ts` :
 * la suite entière tourne contre UN SEUL conteneur applicatif partagé par
 * tous les fichiers (`docker-compose.e2e.yml`, `VISION_PROVIDER=gemini`), et
 * `VISION_PROVIDER` ne se change qu'au redémarrage de ce conteneur — un
 * redémarrage casserait tout parcours des autres fichiers qui s'exécute en
 * même temps ou après lui dans la même fenêtre de session (caméra, scan,
 * suggestions). Ce fichier a donc son propre projet Playwright
 * (`chromium-sans-fournisseur`, `e2e/playwright.config.ts`), explicitement
 * exclu de la commande `npm run e2e` (qui ne lance que le projet
 * `chromium`), et sa propre commande (`npm run e2e:sans-fournisseur`),
 * déclenchée par un step CI dédié (`.github/workflows/ci.yml`, job `e2e`)
 * qui bascule le service `app` sur `docker-compose.e2e.none.yml` APRÈS que
 * le reste de la suite a terminé — jamais en parallèle.
 *
 * La base de données n'est pas affectée par ce redémarrage (seul le service
 * `app` est recréé, `db` continue de tourner) : `restoreDatabase()` et
 * `useSharedAdminSession()` fonctionnent ici exactement comme dans les autres
 * fichiers, sans traitement particulier.
 *
 * Sélecteurs, avec leur source :
 * - `getByRole('heading', { name: 'Aucun fournisseur de suggestions configuré',
 *   level: 2 })` — `apps/web/src/components/ui/empty-state.tsx`
 *   (`EmptyState`, titre en `<h2>`), monté par
 *   `apps/web/src/screens/suggestions/suggestions-screen.tsx`
 *   (`SuggestionsErrorState`, branche `provider_disabled`).
 * - Le message exact — `description={error.message}` dans ce même composant :
 *   jamais reformulé côté écran, c'est le message du serveur
 *   (`assertProviderEnabled`, `apps/api/src/common/api-error.ts`) qui seul
 *   nomme les deux variables d'environnement attendues.
 * - `getByRole('link', { name: 'Aller aux réglages' })` — action de ce même
 *   `EmptyState`.
 */

test.beforeAll(async () => {
  await restoreDatabase();
});

useSharedAdminSession();

test('dit en français que le fournisseur n’est pas configuré', async ({ page }) => {
  await page.goto('/recettes');

  await expect(page.getByRole('heading', { name: 'Aucun fournisseur de suggestions configuré', level: 2 })).toBeVisible();
  await expect(
    page.getByText('Fournisseur de suggestions désactivé : renseignez VISION_PROVIDER et VISION_API_KEY', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Aller aux réglages' })).toBeVisible();
});
