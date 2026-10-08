import { effectiveRating } from './effective-rating.js';

export const RECIPE_SORTS = ['rating', 'coverage', 'mostCooked', 'leastRecent'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

export const RECIPE_SORT_LABELS_FR: Record<RecipeSort, string> = {
  rating: 'Les mieux notées',
  coverage: 'Réalisables avec le stock',
  mostCooked: 'Les plus faites',
  leastRecent: 'Les moins récentes',
};

export interface SortableRecipe {
  title: string;
  coverage: number;
  rating: number | null;
  averageRating: number | null;
  ratingCount: number;
  timesCooked: number;
  lastCookedAt: Date | null;
}

const byTitle = (a: SortableRecipe, b: SortableRecipe): number => a.title.localeCompare(b.title, 'fr');

/**
 * Note : passe par `effectiveRating` (D3, A5) pour que note directe et
 * moyenne des réalisations se classent sur la même échelle, puis par le
 * nombre d'avis de réalisation, puis par le titre.
 */
const byRating = (a: SortableRecipe, b: SortableRecipe): number => {
  const aEffective = effectiveRating(a.rating, a.averageRating).value;
  const bEffective = effectiveRating(b.rating, b.averageRating).value;
  return (
    Number(bEffective !== null) - Number(aEffective !== null) ||
    (bEffective ?? 0) - (aEffective ?? 0) ||
    b.ratingCount - a.ratingCount ||
    byTitle(a, b)
  );
};

const COMPARATORS: Record<RecipeSort, (a: SortableRecipe, b: SortableRecipe) => number> = {
  rating: byRating,
  coverage: (a, b) => b.coverage - a.coverage || byRating(a, b),
  mostCooked: (a, b) => b.timesCooked - a.timesCooked || byTitle(a, b),
  // Jamais faites en premier : cas nul traité explicitement, pas de date sentinelle.
  leastRecent: (a, b) =>
    Number(a.lastCookedAt !== null) - Number(b.lastCookedAt !== null) ||
    (a.lastCookedAt && b.lastCookedAt ? a.lastCookedAt.getTime() - b.lastCookedAt.getTime() : 0) ||
    byTitle(a, b),
};

export function sortRecipes<T extends SortableRecipe>(recipes: readonly T[], sort: RecipeSort): T[] {
  // Copie avant tri : `Array.sort` modifie en place, et il est stable depuis ES2019.
  return [...recipes].sort(COMPARATORS[sort]);
}
