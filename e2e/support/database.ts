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

// Table de suivi des migrations Prisma : c'est du schéma, pas une donnée de
// test — ni vidée ni reprise par l'instantané (section 19, revue de tâche 10).
const PRISMA_MIGRATIONS_TABLE = '_prisma_migrations';

/**
 * Sème le jeu de données de développement une seule fois pour toute
 * l'exécution (`npm run seed:dev -w @kitchen/api`, lancé depuis le runner :
 * l'image `--omit=dev` n'a pas `tsx`), puis prend un instantané **de données
 * seulement** (`pg_dump --data-only`, revue de tâche 10 : voir plus bas
 * pourquoi jamais `--clean`/schéma). Les appels suivants réutilisent la même
 * promesse et ne reposent pas une deuxième fois le seed. Retourne le chemin
 * de l'instantané.
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
      [
        '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME,
        '--format=custom', '--data-only',
        `--exclude-table=${PRISMA_MIGRATIONS_TABLE}`,
        '--file', dumpPath,
      ],
      { env: PG_ENV },
    );
    return dumpPath;
  })();
  return seeded;
}

/**
 * Exécute une instruction SQL arbitraire sur la base e2e (`psql`), pour un
 * besoin ponctuel qui ne justifie pas sa propre fonction dédiée ici — par
 * exemple réinsérer une ligne après une restauration (`e2e/support/auth.ts`,
 * `useSharedAdminSession`, qui a besoin de reposer sa session partagée après
 * chaque `TRUNCATE`). Mêmes paramètres de connexion que le reste de ce
 * fichier ; appelant responsable de l'échapper correctement si une valeur
 * n'est pas déjà connue sûre (identifiants internes, jamais une saisie).
 */
export async function runSql(sql: string): Promise<void> {
  await execFileAsync('psql', ['-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: PG_ENV });
}

/**
 * Vide toutes les tables de données (jamais le schéma), dans un seul
 * `TRUNCATE … CASCADE` : la liste des tables est lue dans `pg_tables` plutôt
 * que recopiée à la main, pour rester vraie si le schéma gagne des tables
 * (recettes, lot 2) sans qu'il faille penser à revenir ici. `CASCADE` se
 * charge de l'ordre des dépendances entre tables liées par clé étrangère —
 * aucune liste ordonnée à maintenir. `RESTART IDENTITY` remet à zéro les
 * séquences, pour un état aussi reproductible que l'ancien `--clean`.
 */
async function truncateAllTables(): Promise<void> {
  const sql = `
DO $$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tables
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> '${PRISMA_MIGRATIONS_TABLE}';
  IF tables IS NOT NULL THEN
    EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', tables);
  END IF;
END $$;`;
  await execFileAsync(
    'psql',
    ['-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: PG_ENV },
  );
}

/**
 * Restaure l'instantané pris par `seedDatabase` : à appeler une fois par
 * fichier de test (`test.beforeAll`), jamais entre chaque test — rejouer le
 * seed ou restaurer à chaque test serait inutilement lent pour un repli dont
 * le seul but est de repartir d'un état connu entre fichiers.
 *
 * Restaure les **données seulement**, jamais le schéma (revue de tâche 10) :
 * `pg_restore --clean` dépose et recrée les types (les enums Prisma —
 * `Unit`, `DateType`, …) à chaque appel, avec un nouvel OID à chaque fois.
 * Le conteneur `app` du montage e2e vit pour toute l'exécution avec un pool
 * de connexions Postgres long terme (`apps/api`, un seul processus démarré
 * une fois) ; une connexion restée ouverte depuis avant une restauration
 * garde en cache l'ancien OID d'un type que le schéma vient de recréer, et
 * la prochaine requête qui s'en sert échoue avec `cache lookup failed for
 * type <oid>` — une vraie panne Postgres, pas une instabilité de test,
 * observée en CI sur `POST /api/v1/stock` (tâche 4). Vider les tables
 * (`truncateAllTables`) puis recharger les données (`pg_restore --data-only`)
 * laisse le schéma strictement intact d'un bout à l'autre de l'exécution :
 * les types ne sont créés qu'une fois, par les migrations initiales, et
 * gardent le même OID pour toutes les connexions du pool, du premier au
 * dernier fichier de test.
 */
export async function restoreDatabase(): Promise<void> {
  const dumpPath = await seedDatabase();
  await truncateAllTables();
  await execFileAsync(
    'pg_restore',
    [
      '-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME,
      '--data-only', '--disable-triggers', '--no-owner',
      dumpPath,
    ],
    { env: PG_ENV },
  );
}
