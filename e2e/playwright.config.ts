import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { generateBarcodeVideo } from './fixtures/barcode-video.ts';

/** Forme minimale lue dans une fixture Open Food Facts rejouée par la doublure. */
interface OffFixture {
  readonly code: string;
  readonly product: {
    readonly product_name?: string;
    readonly product_name_fr?: string;
  };
}

function readOffFixture(file: string): OffFixture {
  const path = fileURLToPath(new URL(`../apps/api/test/fixtures/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as OffFixture;
}

/**
 * Même règle de nommage que la cascade de reconnaissance
 * (`apps/api/src/recognition/open-food-facts.client.ts` : `product_name_fr
 * || product_name`) — lue ici sur la fixture plutôt que recopiée, pour que
 * les parcours affirment exactement ce que l'application affiche.
 */
function productName(fixture: OffFixture): string {
  return fixture.product.product_name_fr || fixture.product.product_name || '';
}

// Les deux fixtures Open Food Facts que sert la doublure pour la vidéo de
// caméra simulée (section 19, tâches 2 et 9). Toutes deux absentes du jeu de
// données de seed : chaque scan déclenche un vrai appel à la doublure,
// jamais une réponse déjà en cache.
const PRIMARY_FIXTURE = readOffFixture('off-3017620422003.json');
const SECONDARY_FIXTURE = readOffFixture('off-8801043015608.json');

/** Code-barres du premier bloc de la vidéo (Nutella). */
export const FAKE_VIDEO_BARCODE = PRIMARY_FIXTURE.code;
/** Nom de produit que la cascade de reconnaissance rend pour ce code. */
export const FAKE_VIDEO_PRODUCT_NAME = productName(PRIMARY_FIXTURE);

/** Code-barres du second bloc de la vidéo (Shin Ramyun), pour tester la rafale. */
export const FAKE_VIDEO_BARCODE_SECONDARY = SECONDARY_FIXTURE.code;
/** Nom de produit que la cascade de reconnaissance rend pour ce second code. */
export const FAKE_VIDEO_PRODUCT_NAME_SECONDARY = productName(SECONDARY_FIXTURE);

// Générée une fois, au chargement de la configuration (un seul worker, une
// seule exécution) : Chromium rejoue ce fichier en boucle pour tout flux
// vidéo demandé par `getUserMedia`, quel que soit le test. La vidéo alterne
// les deux codes par blocs (voir `generateBarcodeVideo`) : un parcours qui ne
// lit que le premier scan voit toujours `FAKE_VIDEO_BARCODE` en premier, un
// parcours qui enchaîne deux scans sans fermer la caméra peut désormais
// attendre `FAKE_VIDEO_BARCODE_SECONDARY` pour le second.
const fakeVideoPath = await generateBarcodeVideo([FAKE_VIDEO_BARCODE, FAKE_VIDEO_BARCODE_SECONDARY]);

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
      // Exclu : ce fichier exige un conteneur `app` démarré avec
      // `VISION_PROVIDER=none` (docker-compose.e2e.none.yml), jamais celui
      // (VISION_PROVIDER=gemini) que ce projet attend — voir l'en-tête de
      // `p5-suggestions-sans-fournisseur.spec.ts`. Joué par le projet dédié
      // ci-dessous, dans un step CI séparé.
      testIgnore: /p5-suggestions-sans-fournisseur\.spec\.ts$/,
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
    {
      name: 'chromium-sans-fournisseur',
      // Seul fichier de ce projet : aucun besoin de caméra simulée ici (ce
      // parcours n'ouvre jamais le scan), mais les mêmes `launchOptions` sont
      // gardées par cohérence avec le reste de la session, au cas où un futur
      // test de ce projet en aurait besoin.
      testMatch: /p5-suggestions-sans-fournisseur\.spec\.ts$/,
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
