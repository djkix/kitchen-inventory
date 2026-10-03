import { DIFFICULTY_LABELS_FR, type RecipeDto, type RecipeLogDto } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { Sheet } from '../../components/ui/sheet';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import { errorMessage, isApiError, newClientOpId } from '../../lib/api';
import { queryKeys, useRecipeLogsInfiniteQuery, useRecipeQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import { HistoryPanel } from './history-panel';
import { IngredientRow } from './ingredient-row';
import { RatingSheet } from '../recipes/rating-reminder';

/** « 25 min », « 1 h 15 » : même présentation que la carte recette (section 14). */
function formatMinutes(totalMinutes: number | null): string | null {
  if (totalMinutes === null) return null;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes}` : `${hours} h`;
}

type ConfirmTarget = { kind: 'delete-recipe' } | { kind: 'delete-log'; log: RecipeLogDto };

/** Fiche recette (section 14/15) : ingrédients face au stock réel, étapes, temps et historique des réalisations. */
export function RecipeScreen() {
  const { id } = useParams<{ id: string }>();
  const recipe = useRecipeQuery(id);

  if (recipe.isPending) return <RecipeSkeleton />;
  if (recipe.isError) {
    const missing = isApiError(recipe.error, 'not_found');
    return (
      <>
        <ScreenHeader title="Recette" back="/recettes" />
        <ErrorState
          title={missing ? 'Recette introuvable' : undefined}
          message={missing ? 'Cette recette n’existe plus : elle a peut-être été supprimée depuis un autre téléphone.' : errorMessage(recipe.error)}
          onRetry={missing ? undefined : () => void recipe.refetch()}
        />
      </>
    );
  }
  return <RecipeDetails recipe={recipe.data} />;
}

function RecipeDetails({ recipe }: { recipe: RecipeDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuth();
  const logs = useRecipeLogsInfiniteQuery(recipe.id);

  const [ratingLog, setRatingLog] = useState<RecipeLogDto | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      await recipesApi.logCooked(recipe.id, { servingsCooked: recipe.servings, clientOpId: newClientOpId() });
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
        navigate('/recettes', { replace: true });
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

  return (
    <>
      <ScreenHeader title={recipe.title} back="/recettes" subtitle={archived ? 'Archivée' : undefined} />

      <div className="flex flex-col gap-5 px-4 pb-32">
        <section className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
          {recipe.cuisineName && <span>{recipe.cuisineName}</span>}
          {time && <span className="tnum">{time}</span>}
          <span>
            {DIFFICULTY_LABELS_FR[recipe.difficulty]}
            {recipe.difficultyOverride && ' (corrigée)'}
          </span>
          <span className="tnum">
            {recipe.servings} portion{recipe.servings > 1 ? 's' : ''}
          </span>
        </section>

        <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-card bg-surface px-4 py-3 text-[14px]">
          <TimeField label="Préparation" minutes={recipe.prepMinutes} />
          <TimeField label="Cuisson" minutes={recipe.cookMinutes} />
          <TimeField label="Temps actif" minutes={recipe.activeTime} />
          <TimeField label="Repos" minutes={recipe.restMinutes} />
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">Ingrédients</h2>
          <ul className="flex flex-col divide-y divide-line rounded-card bg-surface">
            {recipe.ingredients.map((ingredient) => (
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

        {/* La mention est visible, et pas seulement en infobulle : une infobulle
            ne s'ouvre pas au toucher, or cet écran se lit au téléphone. */}
        <p className="px-1 text-[13px] text-muted">
          La modification d'une recette arrive bientôt.
        </p>
        <div className="flex flex-wrap gap-2 px-1">
          <Button
            size="sm"
            variant="outline"
            disabled
            title="Modification de recette : bientôt disponible"
          >
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
          <p className="mb-2 text-center text-[12px] text-muted">
            Cuisiner avec décompte du stock arrive bientôt : enregistrez la réalisation en attendant.
          </p>
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" disabled title="Cuisson avec décompte du stock : bientôt disponible">
              Cuisiner
            </Button>
            <Button variant="primary" size="lg" className="flex-1" loading={busy === 'log'} onClick={() => void logCooked()}>
              J’ai fait cette recette
            </Button>
          </div>
        </div>
      )}

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
      <ScreenHeader title=" " back="/recettes" />
      <div className="flex flex-col gap-5 px-4" aria-busy>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </>
  );
}
