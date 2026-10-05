import type { RecipeFilters } from '@kitchen/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { SearchIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { errorMessage } from '../../lib/api';
import { useCuisinesQuery, useRecipeFiltersQuery, useRecipesInfiniteQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import { RecipeCard, recipeAccessibleName } from './recipe-card';
import { countActiveRecipeFilters, EMPTY_RECIPE_FILTERS, RecipeFiltersBar } from './recipe-filters';
import { RatingReminderBanner } from './rating-reminder';

export function RecipesScreen() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const debouncedFilters = useDebouncedValue(filters, 500);

  const savedFilters = useRecipeFiltersQuery();
  const cuisines = useCuisinesQuery();
  const hasAppliedSaved = useRef(false);
  const lastSaved = useRef<RecipeFilters>(EMPTY_RECIPE_FILTERS);

  // Les préférences enregistrées remplacent les filtres par défaut, une seule fois au montage.
  useEffect(() => {
    if (hasAppliedSaved.current || !savedFilters.isSuccess) return;
    hasAppliedSaved.current = true;
    const merged = { ...EMPTY_RECIPE_FILTERS, ...savedFilters.data };
    lastSaved.current = merged;
    setFilters(merged);
  }, [savedFilters.isSuccess, savedFilters.data]);

  // Écriture des préférences après un temps d'inactivité : jamais à chaque frappe ou chaque clic.
  useEffect(() => {
    if (!hasAppliedSaved.current) return;
    if (JSON.stringify(debouncedFilters) === JSON.stringify(lastSaved.current)) return;
    lastSaved.current = debouncedFilters;
    void recipesApi.setFilters(debouncedFilters);
  }, [debouncedFilters]);

  const recipes = useRecipesInfiniteQuery({ ...filters, q: debouncedQuery || undefined });

  const items = useMemo(() => recipes.data?.pages.flatMap((page) => page.items) ?? [], [recipes.data]);
  const total = recipes.data?.pages[0]?.total ?? 0;

  return (
    <>
      <ScreenHeader
        title="Mes recettes"
        back="/recettes"
        subtitle={recipes.isSuccess ? <span className="tnum">{total} recette{total > 1 ? 's' : ''}</span> : undefined}
      />

      <RatingReminderBanner />

      <div className="px-4 pb-3">
        <label className="relative block">
          <span className="sr-only">Rechercher une recette</span>
          <SearchIcon size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une recette"
            enterKeyHint="search"
            autoComplete="off"
            className="min-h-touch w-full rounded-xl border border-line bg-surface pl-11 pr-3.5 text-[16px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <RecipeFiltersBar value={filters} cuisines={cuisines.data ?? []} onChange={setFilters} />

      {recipes.isPending ? (
        <ListSkeleton />
      ) : recipes.isError ? (
        <ErrorState message={errorMessage(recipes.error)} onRetry={() => void recipes.refetch()} />
      ) : items.length === 0 ? (
        <RecipesEmpty hasActiveQuery={Boolean(debouncedQuery)} hasActiveFilters={countActiveRecipeFilters(filters) > 0} />
      ) : (
        <>
          <ul className="flex flex-col gap-2 px-4">
            {items.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  to={`/recettes/${recipe.id}`}
                  aria-label={recipeAccessibleName(recipe)}
                  className="block rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <RecipeCard recipe={recipe} />
                </Link>
              </li>
            ))}
          </ul>
          {recipes.hasNextPage && (
            <div className="px-4 pt-4">
              <Button block onClick={() => void recipes.fetchNextPage()} loading={recipes.isFetchingNextPage}>
                Charger plus ({items.length} sur {total})
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function RecipesEmpty({ hasActiveQuery, hasActiveFilters }: { hasActiveQuery: boolean; hasActiveFilters: boolean }) {
  if (hasActiveQuery) {
    return <EmptyState title="Aucune recette ne correspond" description="Essayez une autre recherche, ou élargissez les filtres actifs." />;
  }
  if (hasActiveFilters) {
    return (
      <EmptyState
        title="Rien ne correspond à ces filtres"
        description="Aucune recette ne correspond à la combinaison choisie. « Tout effacer » revient à la liste complète."
      />
    );
  }
  return (
    <EmptyState
      title="Aucune recette pour l’instant"
      description="Conservez une suggestion pour qu’elle rejoigne votre bibliothèque : les recettes se créent depuis l’écran Suggestions, à partir du stock réel."
    />
  );
}
