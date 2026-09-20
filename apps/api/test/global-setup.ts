import { migrate, startTestDatabase } from './db.js';

/**
 * Démarre une base une seule fois pour toute la session Vitest, joue les
 * migrations, et expose l'URL aux fichiers de test via l'environnement.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const db = await startTestDatabase();
  await migrate(db.url);
  process.env.DATABASE_URL = db.url;
  return async () => {
    await db.stop();
  };
}
