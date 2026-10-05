import { defineConfig, devices } from '@playwright/test';
import { generateBarcodeVideo } from './fixtures/barcode-video.ts';

/**
 * Code-barres de la vidéo de caméra simulée, lu par tous les parcours qui
 * scannent (section 19). Choisi dans les fixtures Open Food Facts rejouées
 * par la doublure (`apps/api/test/fixtures/off-3017620422003.json`), absent
 * du jeu de données de seed : chaque scan de ce code déclenche un vrai appel
 * à la doublure, jamais une réponse déjà en cache.
 */
export const FAKE_VIDEO_BARCODE = '3017620422003';

// Générée une fois, au chargement de la configuration (un seul worker, une
// seule exécution) : Chromium rejoue ce fichier en boucle pour tout flux
// vidéo demandé par `getUserMedia`, quel que soit le test.
const fakeVideoPath = await generateBarcodeVideo(FAKE_VIDEO_BARCODE);

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  // Un seul worker (consigne du projet) : les tests partagent une base de
  // données restaurée entre fichiers, jamais entre tests isolés en parallèle.
  workers: 1,
  retries: 0,
  // Rapport HTML et artefacts (traces, captures, vidéos) dans des dossiers
  // frères, jamais l'un dans l'autre : le reporter HTML vide son dossier
  // avant de le régénérer, ce qui effacerait les artefacts s'ils étaient à
  // l'intérieur (Franck ne peut rien rejouer localement, ils sont la seule
  // preuve d'un échec).
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'artefacts',
  // Le montage est démarré et arrêté par la CI (`docker compose`), jamais par
  // Playwright : pas de `webServer` ici.
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${fakeVideoPath}`,
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
});
