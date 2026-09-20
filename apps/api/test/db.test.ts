import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('base de test et migration initiale', () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a l’extension pg_trgm', async () => {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
    expect(rows).toHaveLength(1);
  });

  it('a les colonnes ajoutées au schéma fourni', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name IN ('lockedUntil', 'failedLogins')`;
    expect(rows.map((r) => r.column_name).sort()).toEqual(['failedLogins', 'lockedUntil']);
  });

  it('a toutes les migrations appliquées', async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM _prisma_migrations`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.finished_at !== null)).toBe(true);
  });
});
