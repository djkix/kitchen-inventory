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

/**
 * Identifiants des produits dont le nom, le nom d'origine ou la marque
 * contient l'un des `terms` (déjà développés par `expandSearchTerms`), en
 * ignorant les accents des deux côtés de la comparaison (EF-11) via
 * `unaccent_lite`. Prisma ne sait pas appliquer une fonction SQL sur une
 * colonne dans son query builder : on résout donc les identifiants ici, à
 * charge pour l'appelant de les reporter dans son propre `where`.
 */
export async function findProductIdsByTerms(prisma: PrismaService, terms: string[]): Promise<string[]> {
  if (terms.length === 0) return [];
  const likes = terms.map((t) => `%${t}%`);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Product"
    WHERE unaccent_lite(name) ILIKE ANY(${likes}::text[])
       OR unaccent_lite(coalesce("originalName", '')) ILIKE ANY(${likes}::text[])
       OR unaccent_lite(coalesce(brand, '')) ILIKE ANY(${likes}::text[])
  `);
  return rows.map((r) => r.id);
}
