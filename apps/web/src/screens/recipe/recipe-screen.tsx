import { DIFFICULTY_LABELS_FR, effectiveRating, scaleIngredients, servingsRatio, type RecipeDto, type RecipeLogDto } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { FavoriteStar } from '../../components/ui/favorite-star';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Sheet } from '../../components/ui/sheet';
import { StarRating } from '../../components/ui/star-rating';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { errorMessage, isApiError, newClientOpId } from '../../lib/api';
import { queryKeys, useRecipeDirectPatch, useRecipeLogsInfiniteQuery, useRecipeQuery } from '../../lib/queries';
import { formatMinutes } from '../../lib/quantity-ui';
import { recipesApi } from '../../lib/recipes-api';
import { CookSheet } from './cook-sheet';
import { HistoryPanel } from './history-panel';
import { IngredientRow } from './ingredient-row';
import { RatingSheet } from '../recipes/rating-reminder';

type ConfirmTarget = { kind: 'delete-recipe' } | { kind: 'delete-log'; log: RecipeLogDto };

/** Parts acceptées (`recipeDetailQuerySchema`, `cookRecipeSchema`, section 15) : mêmes bornes côté écran que côté serveur. */
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 50;

/** Fiche recette (section 14/15) : ingrédients face au stock réel, étapes, temps et historique des réalisations. */
export function RecipeScreen() {
  const { id } = useParams<{ id: string }>();
  // Parts choisies à l'écran (EF-26) : `undefined` tant que Franck n'y a pas
  // touché, pour que la requête reste sur les parts de la recette elle-même
  // (comportement par défaut du serveur) sans attendre de savoir combien.
  const [servings, setServings] = useState<number | undefined>(undefined);
  // Une recette ouverte après une autre (navigation sans démontage) ne doit
  // pas hériter des parts choisies pour la précédente.
  useEffect(() => setServings(undefined), [id]);
  const recipe = useRecipeQuery(id, servings);

  if (recipe.isPending) return <RecipeSkeleton />;
  if (recipe.isError) {
    const missing = isApiError(recipe.error, 'not_found');
    return (
      <>
        <ScreenHeader title="Recette" back="/recettes/bibliotheque" />
        <ErrorState
          title={missing ? 'Recette introuvable' : undefined}
          message={missing ? 'Cette recette n’existe plus : elle a peut-être été supprimée depuis un autre téléphone.' : errorMessage(recipe.error)}
          onRetry={missing ? undefined : () => void recipe.refetch()}
        />
      </>
    );
  }
  return <RecipeDetails recipe={recipe.data} servings={servings ?? recipe.data.servings} onServingsChange={setServings} />;
}

interface RecipeDetailsProps {
  recipe: RecipeDto;
  /** Parts actuellement sélectionnées (EF-26) : du sélecteur à la cuisson, un seul nombre tenu du début à la fin (F4). */
  servings: number;
  onServingsChange: (servings: number) => void;
}

function RecipeDetails({ recipe, servings, onServingsChange }: RecipeDetailsProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuth();
  const logs = useRecipeLogsInfiniteQuery(recipe.id);
  const patchRecipe = useRecipeDirectPatch();

  const [ratingLog, setRatingLog] = useState<RecipeLogDto | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);
  // Brouillon du champ « Nombre de parts » (EF-26) : `''` tant que Franck n'a
  // pas tapé, même geste que les autres champs décimaux de l'application
  // (clavier décimal français, virgule acceptée en silence).
  // Le champ EST sa propre valeur, jamais un repli sur le nombre courant : avec
  // `raw === '' ? String(valeur) : raw`, effacer réaffichait aussitôt l'ancien
  // chiffre, si bien qu'on ne pouvait plus le remplacer — taper « 2 » sur « 4 »
  // donnait « 42 ». Franck l'a rencontré le 2026-10-08.
  const [rawServings, setRawServings] = useState(String(servings));
  useEffect(() => setRawServings(String(recipe.servings)), [recipe.id, recipe.servings]);

  const archived = recipe.archivedAt !== null;
  const hasHistory = recipe.stats.timesCooked > 0;
  const items = useMemo(() => logs.data?.pages.flatMap((page) => page.items) ?? [], [logs.data]);

  const refreshRecipe = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.recipe(recipe.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recipeLogs(recipe.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingRating }),
    ]);
  };

  const logCooked = async () => {
    setBusy('log');
    try {
      // Même nombre de parts que celui choisi à l'écran (F4) : ce bouton
      // n'ouvre pas de second champ, il reprend donc celui déjà affiché.
      await recipesApi.logCooked(recipe.id, { servingsCooked: servings, clientOpId: newClientOpId() });
      toast.show({ message: 'Réalisation enregistrée', tone: 'success', durationMs: 3000 });
      await refreshRecipe();
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Impossible d’enregistrer cette réalisation'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    setBusy('archive');
    try {
      await recipesApi.archiveRecipe(recipe.id);
      toast.show({ message: 'Recette archivée', tone: 'success', durationMs: 3000 });
      await refreshRecipe();
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Archivage impossible'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Favori et note directe (A2, A3, D1) : `useRecipeDirectPatch` écrit déjà
   * le cache avant même l'appel réseau — la fiche se met à jour d'elle-même
   * (elle lit `recipe` via `useRecipeQuery`, abonné au même cache), aucun
   * état local ni `refreshRecipe` à prévoir ici. `busy` empêche seulement un
   * double envoi, il ne retarde pas l'affichage.
   */
  const toggleFavorite = async () => {
    setBusy('favorite');
    try {
      await patchRecipe(recipe.id, { favorite: !recipe.favorite });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Impossible de mettre à jour le favori'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  /** Pose, corrige ou retire la note directe (A3) ; `null` l'efface (distinct de l'absence, voir `updateRecipeSchema`). */
  const setDirectRating = async (stars: number | null) => {
    setBusy('rating');
    try {
      await patchRecipe(recipe.id, { rating: stars });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Impossible d’enregistrer la note'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    try {
      await recipesApi.restoreRecipe(recipe.id);
      toast.show({ message: 'Recette restaurée', tone: 'success', durationMs: 3000 });
      await refreshRecipe();
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Restauration impossible'), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!confirm) return;
    setBusy('delete');
    try {
      if (confirm.kind === 'delete-recipe') {
        await recipesApi.removeRecipe(recipe.id);
        toast.show({ message: 'Recette supprimée', tone: 'success', durationMs: 3000 });
        setConfirm(null);
        navigate('/recettes/bibliotheque', { replace: true });
        return;
      }
      await recipesApi.removeLog(confirm.log.id);
      toast.show({ message: 'Réalisation supprimée', tone: 'success', durationMs: 3000 });
      setConfirm(null);
      await refreshRecipe();
    } catch (error) {
      // Refus métier (A20, A26) : le message de l'API pointe déjà vers la bonne action (archiver, ou corriger le stock manuellement).
      toast.show({ message: errorMessage(error, 'Suppression impossible'), tone: 'danger', durationMs: 6000 });
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const time = formatMinutes(recipe.totalMinutes);
  const mine = ratingLog?.ratings.find((rating) => rating.userId === auth.user?.id) ?? null;

  // La note affichée passe toujours par `effectiveRating` (D3, A5) : jamais
  // la préséance recalculée à la main ici. `StarRating` n'accepte qu'un entier
  // de 1 à 5 ; la moyenne des réalisations (ex. 4,3) y est donc arrondie pour
  // le seul affichage — l'écriture, elle, ne porte jamais que sur `rating`.
  const effective = effectiveRating(recipe.rating, recipe.stats.averageRating);
  const ratingDisplay = effective.value === null ? null : Math.min(5, Math.max(1, Math.round(effective.value)));

  // Un seul nombre de parts du début à la fin (F4) : ce ratio sert à la fois
  // à l'affichage des quantités de la fiche et à l'initialisation du tiroir
  // de cuisson, jamais recalculé deux fois avec deux formules différentes.
  const ratio = servingsRatio(servings, recipe.servings);
  const scaledIngredients = useMemo(() => scaleIngredients(recipe.ingredients, ratio), [recipe.ingredients, ratio]);

  const onServingsTyped = (value: string) => {
    setRawServings(value);
    const parsed = Math.round(Number(value.replace(',', '.')));
    if (Number.isInteger(parsed) && parsed >= MIN_SERVINGS && parsed <= MAX_SERVINGS) onServingsChange(parsed);
  };

  return (
    <>
      <ScreenHeader title={recipe.title} back="/recettes/bibliotheque" subtitle={archived ? 'Archivée' : undefined} />

      <div className="flex flex-col gap-5 px-4 pb-32">
        <section className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
          {recipe.cuisineName && <span>{recipe.cuisineName}</span>}
          {time && <span className="tnum">{time}</span>}
          <span>
            {DIFFICULTY_LABELS_FR[recipe.difficulty]}
            {recipe.difficultyOverride && ' (corrigée)'}
          </span>
        </section>

        <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-card bg-surface px-4 py-3 text-[14px]">
          <TimeField label="Préparation" minutes={recipe.prepMinutes} />
          <TimeField label="Cuisson" minutes={recipe.cookMinutes} />
          <TimeField label="Temps actif" minutes={recipe.activeTime} />
          <TimeField label="Repos" minutes={recipe.restMinutes} />
        </section>

        {/* Favori et note directe (A1-A3, D1-D5) : utilisables sans réalisation enregistrée. */}
        <section className="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-[13px] font-semibold text-muted">Ma note</p>
            <StarRating value={ratingDisplay} onChange={(stars) => void setDirectRating(stars)} disabled={busy === 'rating'} />
            {effective.source === 'cooked' && (
              <p className="text-[12px] text-muted">Moyenne des réalisations : posez une note pour la remplacer.</p>
            )}
            {effective.source === 'direct' && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit px-0 text-accent"
                disabled={busy === 'rating'}
                onClick={() => void setDirectRating(null)}
              >
                Retirer la note
              </Button>
            )}
          </div>
          <FavoriteStar favorite={recipe.favorite} recipeTitle={recipe.title} onToggle={() => void toggleFavorite()} disabled={busy === 'favorite'} />
        </section>

        {/*
          Sélecteur de parts (EF-26, F1) : un seul champ, qui pilote à la fois
          la couverture (requête relancée avec `servings`, tâche 7) et
          l'affichage des quantités ci-dessous (`scaleIngredients`, même
          ratio). La recette garde ses parts d'origine en mémoire
          (`recipe.servings`) : seule la fiche s'adapte.
        */}
        <Input
          label="Nombre de parts"
          // Champ texte et non « number » : le clavier décimal français
          // produit une virgule, qu'un champ numérique rejette en silence.
          type="text"
          inputMode="numeric"
          value={rawServings}
          onChange={(event) => onServingsTyped(event.target.value)}
          className="w-28"
        />

        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">Ingrédients</h2>
          <ul className="flex flex-col divide-y divide-line rounded-card bg-surface">
            {scaledIngredients.map((ingredient) => (
              <IngredientRow key={ingredient.id} ingredient={ingredient} />
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">Étapes</h2>
          <ol className="flex flex-col gap-3 rounded-card bg-surface px-4 py-3">
            {recipe.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-[15px] leading-snug">
                <span className="tnum shrink-0 font-semibold text-accent">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-wrap gap-2 px-1">
          <Button size="sm" variant="outline" onClick={() => navigate(`/recettes/${recipe.id}/modifier`)}>
            Modifier
          </Button>
          {archived ? (
            <Button size="sm" variant="outline" loading={busy === 'restore'} onClick={() => void restore()}>
              Restaurer
            </Button>
          ) : hasHistory ? (
            <Button size="sm" variant="outline" loading={busy === 'archive'} onClick={() => void archive()}>
              Archiver
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="text-danger" onClick={() => setConfirm({ kind: 'delete-recipe' })}>
              Supprimer
            </Button>
          )}
        </div>

        <HistoryPanel
          stats={recipe.stats}
          logs={items}
          currentUserId={auth.user?.id ?? null}
          hasNextPage={Boolean(logs.hasNextPage)}
          isFetchingNextPage={logs.isFetchingNextPage}
          onLoadMore={() => void logs.fetchNextPage()}
          onRate={setRatingLog}
          onDelete={(log) => setConfirm({ kind: 'delete-log', log })}
          deletingLogId={busy === 'delete' && confirm?.kind === 'delete-log' ? confirm.log.id : null}
        />
      </div>

      {!archived && (
        <div className="safe-bottom fixed inset-x-0 bottom-[calc(var(--spacing-nav)+env(safe-area-inset-bottom,0px))] z-20 mx-auto max-w-lg bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-3 pt-6">
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => setCooking(true)}>
              Cuisiner
            </Button>
            <Button variant="primary" size="lg" className="flex-1" loading={busy === 'log'} onClick={() => void logCooked()}>
              J’ai fait cette recette
            </Button>
          </div>
        </div>
      )}

      <CookSheet open={cooking} recipe={recipe} initialServings={servings} onClose={() => setCooking(false)} onCooked={() => void refreshRecipe()} />

      <RatingSheet
        open={ratingLog !== null}
        logId={ratingLog?.id ?? null}
        recipeTitle={recipe.title}
        initialStars={mine?.stars ?? null}
        initialComment={mine?.comment ?? null}
        onClose={() => setRatingLog(null)}
        onRated={() => void refreshRecipe()}
      />

      <Sheet
        open={confirm !== null}
        onClose={() => (busy === 'delete' ? undefined : setConfirm(null))}
        locked={busy === 'delete'}
        title={confirm?.kind === 'delete-recipe' ? 'Supprimer cette recette ?' : 'Supprimer cette réalisation ?'}
        description={
          confirm?.kind === 'delete-recipe'
            ? 'Cette action est définitive.'
            : 'Cette action est définitive. Si cette réalisation a décrémenté le stock, la suppression sera refusée.'
        }
      >
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={() => setConfirm(null)} disabled={busy === 'delete'}>
            Annuler
          </Button>
          <Button block variant="danger" loading={busy === 'delete'} onClick={() => void confirmDelete()}>
            Supprimer
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function TimeField({ label, minutes }: { label: string; minutes: number | null }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="tnum font-medium">{formatMinutes(minutes) ?? '—'}</p>
    </div>
  );
}

function RecipeSkeleton() {
  return (
    <>
      <ScreenHeader title=" " back="/recettes/bibliotheque" />
      <div className="flex flex-col gap-5 px-4" aria-busy>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </>
  );
}
