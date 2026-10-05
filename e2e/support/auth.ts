import { createHash, randomUUID } from 'node:crypto';
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { runSql } from './database.ts';

/** Identifiants créés par `prisma/seed/dev.ts` (section 19). */
export const ADMIN_EMAIL = 'admin@example.org';
export const ADMIN_PASSWORD = 'inventaire-dev-2026';

/** Nom du cookie de session (`SESSION_COOKIE`, `apps/api/src/auth/session.service.ts`). */
const SESSION_COOKIE_NAME = 'sid';

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

interface SharedSession {
  /** Cookies à réappliquer tels quels (`context.addCookies`) — inclut le cookie `sid`. */
  readonly cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
  /** SHA-256 hexadécimal du jeton brut (même algorithme que `hashToken`, `apps/api/src/auth/tokens.ts`). */
  readonly tokenHash: string;
  /** Identifiant de l'utilisateur admin (`GET /me`), pour la ligne `Session` réinsérée. */
  readonly userId: string;
  readonly expiresAt: Date;
}

/**
 * Une seule connexion réelle (`POST /auth/login`, HTTP) pour TOUTE
 * l'exécution Playwright de ce process — jamais une par fichier. Mémoïsée au
 * niveau du module : `workers: 1` et `fullyParallel: false`
 * (`e2e/playwright.config.ts`) garantissent un seul process Node pour tous
 * les fichiers du projet `chromium`, donc une seule promesse partagée.
 *
 * Pourquoi c'était nécessaire (incident CI, tâche 7) : `POST /auth/login` est
 * limité à 10 tentatives par minute et par IP (`@Throttle`,
 * `apps/api/src/auth/auth.controller.ts`, **non configurable** — la limite
 * est un littéral du décorateur, pas une variable d'environnement lue depuis
 * `AppConfig`), un quota partagé par tout le conteneur `app` de l'exécution.
 * Une connexion réelle par fichier (l'ancien comportement de
 * `useSharedAdminSession`) épuisait ce budget au fil des fichiers ajoutés à
 * la suite — observé deux fois dans cette branche (tâche 4, puis de nouveau
 * à l'ajout de P5) : le dernier fichier par ordre alphabétique
 * (`smoke.spec.ts`) en payait systématiquement le prix. Rendre la limite
 * configurable aurait exigé un changement d'application (le décorateur
 * `@Throttle` ne lit aucune config) hors du mandat d'écriture de tests ;
 * partager une session unique pour toute l'exécution n'en a besoin d'aucun.
 */
let sharedSession: Promise<SharedSession> | null = null;

async function establishSharedSession(browser: Browser): Promise<SharedSession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsAdmin(page);

  const me = await page.request.get('/api/v1/me');
  const { id: userId } = (await me.json()) as { id: string };

  const cookies = await context.cookies();
  const sid = cookies.find((cookie) => cookie.name === SESSION_COOKIE_NAME);
  if (!sid) throw new Error(`Cookie de session « ${SESSION_COOKIE_NAME} » absent après connexion.`);
  // Même algorithme que `hashToken` (apps/api/src/auth/tokens.ts) : SHA-256
  // hexadécimal du jeton brut — jamais importé depuis `apps/api` (paquet
  // applicatif, pas partagé), reproduit ici à l'identique et cité à la source.
  const tokenHash = createHash('sha256').update(sid.value).digest('hex');

  await context.close();
  return { cookies, tokenHash, userId, expiresAt: new Date(sid.expires * 1000) };
}

/**
 * Réinsère la ligne `Session` de la session partagée après une restauration
 * de base (`restoreDatabase`, `e2e/support/database.ts`) : `TRUNCATE` sur
 * `User` entraîne par CASCADE la table `Session` (clé étrangère
 * `onDelete: Cascade`, `prisma/schema.prisma`), même quand `Session` n'est
 * pas nommée explicitement — c'est une règle Postgres (`TRUNCATE ...
 * CASCADE` se propage à toute table qui référence une table tronquée), pas
 * un oubli de `truncateAllTables`. Repose donc la ligne par SQL direct (pas
 * de nouvel appel HTTP, donc aucun coût sur le quota de connexion) : un
 * nouvel identifiant à chaque fois (l'ancien a disparu avec la table), même
 * empreinte de jeton et même utilisateur qu'à l'établissement.
 */
async function reinsertSharedSession(session: SharedSession): Promise<void> {
  const id = randomUUID();
  await runSql(
    `INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt", "lastSeenAt", "createdAt") ` +
      `VALUES ('${id}', '${session.userId}', '${session.tokenHash}', '${session.expiresAt.toISOString()}', now(), now()) ` +
      `ON CONFLICT ("tokenHash") DO NOTHING;`,
  );
}

/**
 * Ouvre une session admin une seule fois pour TOUTE l'exécution (pas par
 * fichier ni par `test.describe` : voir la docstring de `sharedSession`
 * ci-dessus), puis réapplique son cookie à chaque test (`test.beforeEach`),
 * après avoir reposé la ligne `Session` que la restauration de base du
 * fichier courant vient de faire disparaître (`test.beforeAll`). À appeler
 * une fois, hors de tout test, au niveau du fichier ou en tête d'un
 * `test.describe` :
 *
 * ```ts
 * useSharedAdminSession();
 *
 * test('…', async ({ page }) => {
 *   await page.goto('/scan'); // déjà authentifié, sans repasser par /connexion
 * });
 * ```
 *
 * Ne pas utiliser cette fonction pour un test qui vérifie précisément le
 * parcours de connexion lui-même (comme `smoke.spec.ts`, qui doit continuer
 * à appeler `loginAsAdmin` pour de vrai au moins une fois) : elle sert les
 * tests pour qui la connexion n'est qu'un préalable.
 *
 * Ordre d'exécution : chaque fichier enregistre son propre
 * `test.beforeAll(restoreDatabase)` avant d'appeler cette fonction (même
 * convention partout dans `e2e/`) ; Playwright exécute les hooks `beforeAll`
 * dans leur ordre d'enregistrement au sein d'un même fichier, donc la
 * restauration a toujours eu lieu avant que le hook ci-dessous ne repose la
 * session — jamais l'inverse.
 */
export function useSharedAdminSession(): void {
  test.beforeAll(async ({ browser }) => {
    sharedSession ??= establishSharedSession(browser);
    const session = await sharedSession;
    await reinsertSharedSession(session);
  });

  test.beforeEach(async ({ page }) => {
    const session = await sharedSession!;
    await page.context().addCookies(session.cookies);
  });
}
