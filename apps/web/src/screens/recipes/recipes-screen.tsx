import type { RecipeFilters, RecipeSummaryDto } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type TouchEvent } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { SearchIcon, TrashIcon } from '../../components/ui/icons';
import { Sheet } from '../../components/ui/sheet';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { queryKeys, useCuisinesQuery, useRecipeDirectPatch, useRecipeFiltersQuery, useRecipesInfiniteQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import { RecipeCard, recipeAccessibleName } from './recipe-card';
import { countActiveRecipeFilters, EMPTY_RECIPE_FILTERS, RecipeFiltersBar } from './recipe-filters';
import { RatingReminderBanner } from './rating-reminder';
import { RecipeTabSwitch } from './recipe-tab-switch';

/** Déplacement minimal, en pixels, pour qu'un glissement compte (D5) : un frôlement n'en est pas un. */
const SWIPE_REVEAL_PX = 48;

export function RecipesScreen() {
  const [query, setQuery] = useState('');
  // D2 : les filtres vivent derrière un bouton, dans un panneau par le bas.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // D4/D5 : la recette dont l'effacement attend une confirmation.
  const [toErase, setToErase] = useState<RecipeSummaryDto | null>(null);
  const [erasing, setErasing] = useState(false);
  const [filters, setFilters] = useState<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const debouncedFilters = useDebouncedValue(filters, 500);

  const savedFilters = useRecipeFiltersQuery();
  const cuisines = useCuisinesQuery();
  const hasAppliedSaved = useRef(false);
  const lastSaved = useRef<RecipeFilters>(EMPTY_RECIPE_FILTERS);
  const patchRecipe = useRecipeDirectPatch();
  const toast = useToast();
  const queryClient = useQueryClient();

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

  /**
   * « Effacer » de la liste, c'est archiver (D4) : la recette quitte « Mes
   * recettes », garde son historique et ses notes, et reste consultable par la
   * bascule « Archivées ». Aucune suppression réelle, aucune route nouvelle.
   */
  const erase = async (recipe: RecipeSummaryDto) => {
    setErasing(true);
    try {
      await recipesApi.archiveRecipe(recipe.id);
      setToErase(null);
      toast.show({ message: 'Recette effacée', tone: 'success', durationMs: 3000 });
      await queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Effacement impossible'), tone: 'danger' });
      setToErase(null);
    } finally {
      setErasing(false);
    }
  };

  const recipes = useRecipesInfiniteQuery({ ...filters, q: debouncedQuery || undefined });

  const items = useMemo(() => recipes.data?.pages.flatMap((page) => page.items) ?? [], [recipes.data]);
  const total = recipes.data?.pages[0]?.total ?? 0;
  const activeFilters = countActiveRecipeFilters(filters);

  return (
    <>
      <ScreenHeader
        title="Mes recettes"
        subtitle={recipes.isSuccess ? <span className="tnum">{total} recette{total > 1 ? 's' : ''}</span> : undefined}
      />

      <RecipeTabSwitch />

      <RatingReminderBanner />

      <div className="flex items-center gap-2 px-4 pb-3">
        <label className="relative block min-w-0 flex-1">
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
        {/*
          D2 : un seul contrôle sur la ligne de recherche, portant le nombre de
          filtres actifs — sans ce nombre, un filtre resté actif deviendrait
          invisible une fois le panneau refermé.
        */}
        <Button
          variant={activeFilters > 0 ? 'primary' : 'outline'}
          className="shrink-0"
          aria-label={activeFilters > 0 ? `Filtres (${activeFilters} actif${activeFilters > 1 ? 's' : ''})` : 'Filtres'}
          onClick={() => setFiltersOpen(true)}
        >
          Filtres
          {activeFilters > 0 && <span className="tnum" aria-hidden>({activeFilters})</span>}
        </Button>
      </div>

      {recipes.isPending ? (
        <ListSkeleton />
      ) : recipes.isError ? (
        <ErrorState message={errorMessage(recipes.error)} onRetry={() => void recipes.refetch()} />
      ) : items.length === 0 ? (
        <RecipesEmpty hasActiveQuery={Boolean(debouncedQuery)} hasActiveFilters={activeFilters > 0} />
      ) : (
        <>
          <ul className="flex flex-col gap-2 px-4">
            {items.map((recipe) => (
              <RecipeListRow key={recipe.id} recipe={recipe} onToggleFavorite={() => toggleFavorite(recipe)} onErase={() => setToErase(recipe)} />
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

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres" description="Les choix sont appliqués immédiatement.">
        <div className="flex flex-col gap-3">
          <RecipeFiltersBar value={filters} cuisines={cuisines.data ?? []} onChange={setFilters} />
          <Button block variant="primary" onClick={() => setFiltersOpen(false)}>
            Voir les recettes
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={toErase !== null}
        onClose={() => (erasing ? undefined : setToErase(null))}
        locked={erasing}
        title="Effacer cette recette ?"
        description={
          toErase
            ? `« ${toErase.title} » quitte Mes recettes. Elle reste dans la base : son historique et ses notes sont conservés, et la bascule « Archivées » la retrouve.`
            : undefined
        }
      >
        <div className="flex gap-2">
          <Button block variant="secondary" disabled={erasing} onClick={() => setToErase(null)}>
            Annuler
          </Button>
          <Button block variant="danger" loading={erasing} onClick={() => toErase && void erase(toErase)}>
            Effacer
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Une ligne de la liste : la carte, le lien qui la couvre, et l'action
 * d'effacement découverte par un glissement vers la gauche (D5).
 *
 * Le glissement seul n'efface jamais — il révèle un bouton rouge, qu'il faut
 * toucher, et qui demande confirmation : un pouce qui fait défiler la liste
 * déclencherait sinon un effacement. Le geste est mesuré de bout en bout
 * (`touchstart` → `touchend`) et rejeté s'il est surtout vertical.
 *
 * Le bouton est **toujours dans le document**, simplement caché sous la carte :
 * un glissement n'existe ni au clavier, ni au lecteur d'écran, ni à la souris,
 * et l'action doit rester atteignable sans glisser (D5). Trois chemins, donc :
 * le glissement au doigt, le focus (qui révèle de lui-même, pour que le bouton
 * ne soit jamais actionné à l'aveugle), et le survol à la souris.
 *
 * Le survol est un vrai gestionnaire de pointeur, filtré sur `pointerType`, et
 * non le `group-hover` de Tailwind : celui-ci est fermé par
 * `@media (hover: hover)`, que rien ne garantit, et le bouton restait alors
 * **réellement incliquable** — le parcours de bout en bout du 2026-10-19 le
 * trouvait sans jamais pouvoir l'atteindre, exactement comme une souris.
 */
function RecipeListRow({
  recipe,
  onToggleFavorite,
  onErase,
}: {
  recipe: RecipeSummaryDto;
  onToggleFavorite: () => void;
  onErase: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Une recette déjà archivée ne se ré-archive pas (bascule « Archivées »).
  const erasable = recipe.archivedAt === null;

  // Souris seule : un doigt produit aussi des événements de pointeur, et
  // découvrir l'action au moindre effleurement rendrait le glissement inutile.
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && erasable) setRevealed(true);
  };
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') setRevealed(false);
  };

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onTouchEnd = (event: TouchEvent) => {
    const from = start.current;
    const touch = event.changedTouches[0];
    start.current = null;
    if (!from || !touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    // Surtout vertical : c'est un défilement de la liste, pas un glissement.
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (erasable && dx < -SWIPE_REVEAL_PX) setRevealed(true);
    else if (dx > SWIPE_REVEAL_PX) setRevealed(false);
  };

  return (
    <li
      className="relative overflow-hidden rounded-card"
      data-revealed={revealed}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {erasable && (
        <button
          type="button"
          aria-label={`Supprimer ${recipe.title}`}
          onFocus={() => setRevealed(true)}
          onClick={onErase}
          className="absolute inset-y-0 right-0 flex w-24 items-center justify-center gap-1 rounded-r-card bg-danger-deep text-[13px] font-semibold text-danger"
        >
          <TrashIcon size={18} />
          Effacer
        </button>
      )}
      <div
        className={cn('relative transition-transform duration-150', revealed && erasable && '-translate-x-24')}
      >
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
          posé par `FavoriteStar` lui-même). Le bouton d'effacement
          ci-dessus suit la même règle : frère du lien, jamais son
          descendant — il est hors de ce calque, sous la carte opaque.
        */}
        <Link
          to={`/recettes/${recipe.id}`}
          aria-label={recipeAccessibleName(recipe)}
          className="absolute inset-0 rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="pointer-events-none relative">
          <RecipeCard recipe={recipe} onToggleFavorite={onToggleFavorite} />
        </div>
      </div>
    </li>
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
