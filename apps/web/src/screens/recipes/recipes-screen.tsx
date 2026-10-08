import type { RecipeFilters, RecipeSummaryDto } from '@kitchen/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { SearchIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { errorMessage } from '../../lib/api';
import { useCuisinesQuery, useRecipeDirectPatch, useRecipeFiltersQuery, useRecipesInfiniteQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import { RecipeCard, recipeAccessibleName } from './recipe-card';
import { countActiveRecipeFilters, EMPTY_RECIPE_FILTERS, RecipeFiltersBar } from './recipe-filters';
import { RatingReminderBanner } from './rating-reminder';
import { RecipeTabSwitch } from './recipe-tab-switch';

export function RecipesScreen() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const debouncedFilters = useDebouncedValue(filters, 500);

  const savedFilters = useRecipeFiltersQuery();
  const cuisines = useCuisinesQuery();
  const hasAppliedSaved = useRef(false);
  const lastSaved = useRef<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const patchRecipe = useRecipeDirectPatch();
  const toast = useToast();

  /** Bascule le favori depuis la carte (A2) : la liste n'attend pas le serveur, voir `useRecipeDirectPatch`. */
  const toggleFavorite = (recipe: RecipeSummaryDto) => {
    patchRecipe(recipe.id, { favorite: !recipe.favorite }).catch((error: unknown) => {
      toast.show({ message: errorMessage(error, 'Impossible de mettre à jour le favori'), tone: 'danger' });
    });
  };

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
        subtitle={recipes.isSuccess ? <span className="tnum">{total} recette{total > 1 ? 's' : ''}</span> : undefined}
      />

      <RecipeTabSwitch />

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
              <li key={recipe.id} className="relative">
                {/*
                  L'étoile de favori est un bouton, posé dans la carte juste
                  en dessous : un bouton dans un lien est du HTML invalide, et
                  sur mobile un lecteur d'écran qui explore au doigt (pas à la
                  tabulation) l'absorbe souvent comme une simple action du
                  lien plutôt que comme un arrêt distinct. Le lien devient donc
                  un calque qui couvre toute la carte (`absolute inset-0`),
                  sous elle plutôt qu'autour d'elle ; la carte, non interactive
                  elle-même, laisse passer le clic (`pointer-events-none`),
                  sauf sur l'étoile qui le reprend (`pointer-events-auto`,
                  posé par `FavoriteStar` lui-même).
                */}
                <Link
                  to={`/recettes/${recipe.id}`}
                  aria-label={recipeAccessibleName(recipe)}
                  className="absolute inset-0 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <div className="pointer-events-none relative">
                  <RecipeCard recipe={recipe} onToggleFavorite={() => toggleFavorite(recipe)} />
                </div>
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
