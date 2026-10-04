import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Ports et identifiants publiés par la tâche 1 (docker-compose.e2e.yml),
// atteints depuis le runner, jamais depuis l'intérieur du montage.
const DB_HOST = '127.0.0.1';
const DB_PORT = '55432';
const DB_NAME = 'kitchen_e2e';
const DB_USER = 'kitchen_e2e';
const DB_PASSWORD = 'kitchen_e2e';
const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
const PG_ENV = { ...process.env, PGPASSWORD: DB_PASSWORD };

// e2e/support → e2e → racine du dépôt.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let seeded: Promise<string> | null = null;

/**
 * Sème le jeu de données de développement une seule fois pour toute
 * l'exécution (`npm run seed:dev -w @kitchen/api`, lancé depuis le runner :
 * l'image `--omit=dev` n'a pas `tsx`), puis prend un instantané `pg_dump`.
 * Les appels suivants réutilisent la même promesse et ne reposent pas une
 * deuxième fois le seed. Retourne le chemin de l'instantané.
 */
export async function seedDatabase(): Promise<string> {
  seeded ??= (async () => {
    await execFileAsync('npm', ['run', 'seed:dev', '-w', '@kitchen/api'], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL },
    });
    const dir = await mkdtemp(join(tmpdir(), 'kitchen-e2e-db-'));
    const dumpPath = join(dir, 'seed.dump');
    await execFileAsync(
      'pg_dump',
      ['-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '--format=custom', '--file', dumpPath],
      { env: PG_ENV },
    );
    return dumpPath;
  })();
  return seeded;
}

/**
 * Restaure l'instantané pris par `seedDatabase` : à appeler une fois par
 * fichier de test (`test.beforeAll`), jamais entre chaque test — rejouer le
 * seed ou restaurer à chaque test serait inutilement lent pour un repli dont
 * le seul but est de repartir d'un état connu entre fichiers.
 */
export async function restoreDatabase(): Promise<void> {
  const dumpPath = await seedDatabase();
  await execFileAsync(
    'pg_restore',
    ['-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '--clean', '--if-exists', '--no-owner', dumpPath],
    { env: PG_ENV },
  );
}
