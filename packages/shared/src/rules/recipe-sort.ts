export const RECIPE_SORTS = ['rating', 'coverage', 'antiWaste', 'mostCooked', 'leastRecent'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

export const RECIPE_SORT_LABELS_FR: Record<RecipeSort, string> = {
  rating: 'Les mieux notées',
  coverage: 'Réalisables avec le stock',
  antiWaste: 'Anti-gaspillage',
  mostCooked: 'Les plus faites',
  leastRecent: 'Les moins récentes',
};

export interface SortableRecipe {
  title: string;
  coverage: number;
  bonus: number;
  averageRating: number | null;
  ratingCount: number;
  timesCooked: number;
  lastCookedAt: Date | null;
}

const byTitle = (a: SortableRecipe, b: SortableRecipe): number => a.title.localeCompare(b.title, 'fr');

/** Note : les recettes notées passent devant, puis la moyenne, puis le nombre d'avis. */
const byRating = (a: SortableRecipe, b: SortableRecipe): number =>
  Number(b.averageRating !== null) - Number(a.averageRating !== null) ||
  (b.averageRating ?? 0) - (a.averageRating ?? 0) ||
  b.ratingCount - a.ratingCount ||
  byTitle(a, b);

const COMPARATORS: Record<RecipeSort, (a: SortableRecipe, b: SortableRecipe) => number> = {
  rating: byRating,
  coverage: (a, b) => b.coverage - a.coverage || byRating(a, b),
  antiWaste: (a, b) => b.bonus - a.bonus || b.coverage - a.coverage || byTitle(a, b),
  mostCooked: (a, b) => b.timesCooked - a.timesCooked || byTitle(a, b),
  // Jamais faites en premier : une date absente vaut le passé le plus lointain.
  leastRecent: (a, b) => (a.lastCookedAt?.getTime() ?? -1) - (b.lastCookedAt?.getTime() ?? -1) || byTitle(a, b),
};

export function sortRecipes<T extends SortableRecipe>(recipes: readonly T[], sort: RecipeSort): T[] {
  // Copie avant tri : `Array.sort` modifie en place, et il est stable depuis ES2019.
  return [...recipes].sort(COMPARATORS[sort]);
}
