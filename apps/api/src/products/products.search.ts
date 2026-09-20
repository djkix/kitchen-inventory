import { expandSearchTerms } from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Recherche tolérante (EF-11) : trigrammes `pg_trgm` sur nom, nom d'origine et
 * marque, plus synonymes développés côté application. Renvoie les identifiants
 * classés par similarité décroissante puis nom.
 */
export async function searchProductIds(
  prisma: PrismaService,
  query: string,
  filters: { categoryId?: string },
  page: { skip: number; take: number },
): Promise<{ ids: string[]; total: number }> {
  const terms = expandSearchTerms(query);
  if (terms.length === 0) return { ids: [], total: 0 };
  const primary = terms[0]!;
  const likes = terms.map((t) => `%${t}%`);
  const categoryFilter = filters.categoryId ? Prisma.sql`AND p."categoryId" = ${filters.categoryId}` : Prisma.empty;

  const where = Prisma.sql`
    FROM "Product" p
    WHERE p."mergedIntoId" IS NULL
      ${categoryFilter}
      AND (
        p.barcode = ${query}
        OR unaccent_lite(p.name) ILIKE ANY(${likes}::text[])
        OR unaccent_lite(coalesce(p."originalName", '')) ILIKE ANY(${likes}::text[])
        OR unaccent_lite(coalesce(p.brand, '')) ILIKE ANY(${likes}::text[])
        OR EXISTS (SELECT 1 FROM unnest(${terms}::text[]) AS t WHERE unaccent_lite(p.name) % t OR unaccent_lite(coalesce(p.brand, '')) % t)
      )`;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id,
      GREATEST(
        similarity(unaccent_lite(p.name), ${primary}),
        similarity(unaccent_lite(coalesce(p."originalName", '')), ${primary}),
        similarity(unaccent_lite(coalesce(p.brand, '')), ${primary}),
        CASE WHEN unaccent_lite(p.name) ILIKE ANY(${likes}::text[]) THEN 0.6 ELSE 0 END,
        CASE WHEN p.barcode = ${query} THEN 1 ELSE 0 END
      ) AS score
    ${where}
    ORDER BY score DESC, p.name ASC
    LIMIT ${page.take} OFFSET ${page.skip}`);
  const counted = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count ${where}`);
  return { ids: rows.map((r) => r.id), total: Number(counted[0]?.count ?? 0n) };
}
