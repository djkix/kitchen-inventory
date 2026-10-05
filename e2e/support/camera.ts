import type { Page } from '@playwright/test';

/**
 * Empêche la caméra de démarrer pour cette page (section 17 : repli sur la
 * saisie manuelle du code-barres). La vidéo truquée de toute la session
 * Playwright (`--use-fake-device-for-media-stream`, `e2e/playwright.config.ts`)
 * ne peut produire que les deux codes-barres connus de la doublure
 * (`e2e/fixtures/stub-server.ts`) : aucun scan de caméra ne peut donc jamais
 * donner un code-barres inconnu ni une panne de reconnaissance. Le seul
 * endroit de l'application où un code-barres se saisit à la main est le
 * repli de `CameraError` (`apps/web/src/components/scanner/camera-error.tsx`),
 * affiché uniquement quand `useCamera` est en échec (état `denied`,
 * `apps/web/src/components/scanner/use-camera.ts`) — jamais quand la caméra
 * fonctionne.
 *
 * Décision volontaire : ne pas retirer la permission caméra au niveau du
 * contexte Playwright (`browserContext.clearPermissions()`). Chromium est
 * lancé avec `--use-fake-ui-for-media-stream` (accepte automatiquement toute
 * invite de permission) pour toute la session ; une permission simplement
 * réinitialisée repasserait donc par cette invite auto-acceptée plutôt que
 * par un vrai refus, et rien ici ne permet de le vérifier sans Docker. Une
 * permission explicitement refusée par le protocole CDP (`Browser.setPermission`)
 * s'appliquerait en outre à tout le navigateur partagé par l'exécution entière
 * (un seul worker, tous les fichiers), pas seulement à cette page : un risque
 * de fuite vers des tests sans rapport, invérifiable ici.
 *
 * À la place : `getUserMedia` est réécrit pour rejeter avec le nom
 * d'exception que `use-camera.ts` reconnaît comme caméra refusée
 * (`NotAllowedError`), sans toucher au système de permissions. Rien d'autre
 * que cette page n'est affecté.
 *
 * Script injecté en chaîne (`addInitScript`), pas en fonction typée : il
 * s'exécute dans le navigateur, pas dans ce fichier Node, et la
 * configuration TypeScript de `e2e/` ne charge pas la bibliothèque DOM
 * (`tsconfig.base.json` : `lib: ["ES2023"]` seul) — `window`/`navigator`/
 * `DOMException` n'y seraient pas résolus.
 */
export async function denyCameraForTest(page: Page): Promise<void> {
  await page.addInitScript(
    "window.navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Caméra refusée pour ce test', 'NotAllowedError'));",
  );
}
