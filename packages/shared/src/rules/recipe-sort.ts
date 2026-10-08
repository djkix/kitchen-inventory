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
 * nombre d'avis de réalisation (seulement entre deux recettes départagées
 * par leur moyenne — `ratingCount` ne compte que des avis de réalisation, il
 * ne mesure rien pour une note directe), puis par le titre.
 *
 * Correctif de revue (2026-10-08) : départager par `ratingCount` dès que
 * l'une des deux valeurs vient d'une note directe pénalisait systématiquement
 * cette dernière (`ratingCount` vaut 0 tant qu'aucune réalisation n'est
 * notée) — une recette notée directement 5 passait derrière une recette de
 * moyenne 5 construite sur dix avis, l'inverse de l'intention du lot.
 */
const byRating = (a: SortableRecipe, b: SortableRecipe): number => {
  const aEffective = effectiveRating(a.rating, a.averageRating);
  const bEffective = effectiveRating(b.rating, b.averageRating);
  // Le nombre d'avis ne départage que deux notes issues de réalisations. Une
  // note directe n'en a aucun : l'y comparer la ferait perdre à coup sûr, et
  // rangerait systématiquement derrière les autres les recettes qu'on vient de
  // noter à la main — l'inverse de ce que la notation directe cherche à faire.
  // À égalité entre une note directe et une moyenne, c'est donc le titre qui
  // tranche : arbitraire, mais assumé. Rien ne dit qu'un avis unique vaut moins
  // qu'une moyenne de cinquante, ni l'inverse.
  const compareByReviewCount = aEffective.source === 'cooked' && bEffective.source === 'cooked';
  return (
    Number(bEffective.value !== null) - Number(aEffective.value !== null) ||
    (bEffective.value ?? 0) - (aEffective.value ?? 0) ||
    (compareByReviewCount ? b.ratingCount - a.ratingCount : 0) ||
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
