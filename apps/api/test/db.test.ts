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

  it('porte le schéma du module recettes', async () => {
    const columns = async (table: string) =>
      (await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`).map((c) => c.column_name).sort();

    expect(await columns('UserPreference')).toEqual(['key', 'updatedAt', 'userId', 'value']);
    expect(await columns('RecipeRating')).toEqual(['comment', 'createdAt', 'id', 'recipeLogId', 'stars', 'updatedAt', 'userId']);
    expect(await columns('Recipe')).toEqual(expect.arrayContaining(['activeTime', 'restMinutes', 'archivedAt']));
    // Note directe (EF-21, 2026-10-08) : `rating` vit désormais aussi sur `Recipe`
    // (favori et note directe, décision D2), à côté de la notation par
    // réalisation que porte toujours `RecipeRating` ci-dessus — les deux coexistent.
    expect(await columns('Recipe')).toEqual(expect.arrayContaining(['favorite', 'rating']));
    expect(await columns('Cuisine')).toContain('normalizedName');
    expect(await columns('RecipeLog')).toContain('clientOpId');
    expect(await columns('RecipeLog')).not.toContain('rating');

    const [essential] = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
      SELECT column_default FROM information_schema.columns WHERE table_name = 'RecipeIngredient' AND column_name = 'essential'`;
    expect(essential?.column_default).toBe('false');

    const dishTypes = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'DishType'`;
    expect(dishTypes.map((d) => d.enumlabel).sort()).toEqual(['APERITIF', 'BREAKFAST', 'DESSERT', 'DRINK', 'MAIN', 'SIDE', 'STARTER']);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'RecipeIngredient'`;
    expect(indexes.map((i) => i.indexname)).toContain('RecipeIngredient_categoryId_idx');
  });
});
