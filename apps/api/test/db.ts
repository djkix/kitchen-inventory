import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { PrismaClient } from '@prisma/client';

const execFileAsync = promisify(execFile);
const SCHEMA_PATH = resolve(import.meta.dirname, '../../../prisma/schema.prisma');

export interface TestDatabase {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Base PostgreSQL 16 pour les tests : celle désignée par DATABASE_URL_TEST
 * (service de la CI), sinon une instance embarquée éphémère. Aucun Docker.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const fromEnv = process.env.DATABASE_URL_TEST;
  if (fromEnv) return { url: fromEnv, stop: async () => undefined };

  const dir = await mkdtemp(join(tmpdir(), 'kitchen-pg-'));
  const port = 54_300 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'kitchen',
    password: 'kitchen',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Les journaux du serveur noient la sortie de Vitest.
    onLog: () => undefined,
    onError: (message) => process.stderr.write(String(message)),
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('kitchen_test');
  return {
    url: `postgresql://kitchen:kitchen@127.0.0.1:${port}/kitchen_test`,
    stop: async () => {
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function migrate(url: string): Promise<void> {
  await execFileAsync('npx', ['prisma', 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
    env: { ...process.env, DATABASE_URL: url },
  });
}

/** Vide toutes les tables applicatives entre deux tests, sans toucher aux migrations. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list.length > 0) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}
