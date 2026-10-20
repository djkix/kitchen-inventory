import { DIFFICULTY_LABELS_FR, scaleIngredients, servingsRatio, type Difficulty, type RecipeDto } from '@kitchen/shared';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { ErrorState } from '../../components/ui/empty-state';
import { FavoriteStar } from '../../components/ui/favorite-star';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { errorMessage, isApiError } from '../../lib/api';
import { useRecipeDirectPatch, useRecipeQuery } from '../../lib/queries';
import { cn } from '../../lib/cn';
import { formatMinutes } from '../../lib/quantity-ui';
import { IngredientRow } from './ingredient-row';

/** Parts acceptées (`recipeDetailQuerySchema`, section 15) : mêmes bornes côté écran que côté serveur. */
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 50;

/**
 * Échelle de difficulté (D9) : du céladon de l'accent — la couleur de ce qui
 * est à portée — à l'orange d'avertissement. Jetons du thème uniquement.
 */
const DIFFICULTY_LOOK: Record<Difficulty, string> = {
  VERY_EASY: 'bg-accent-deep text-accent',
  EASY: 'bg-accent-deep text-accent',
  INTERMEDIATE: 'bg-soon-deep text-soon',
  HARD: 'bg-warn-deep text-warn',
};

/** Échelle de durée (D9), distincte de celle de la difficulté : une demi-heure, une heure, au-delà. */
function timeLook(totalMinutes: number | null): string {
  if (totalMinutes === null) return 'bg-raised text-muted';
  if (totalMinutes <= 30) return 'bg-accent-deep text-accent';
  if (totalMinutes <= 60) return 'bg-soon-deep text-soon';
  return 'bg-warn-deep text-warn';
}

/**
 * Fiche recette (section 14/15), en lecture seule depuis le 2026-10-20
 * (demande de Franck) : repères, ingrédients face au stock réel, étapes.
 *
 * Ce qu'elle ne fait plus : cuisiner avec décrément du stock, enregistrer une
 * réalisation, noter, modifier, archiver, restaurer ou supprimer. Ces
 * fonctions restent entières côté serveur, et leurs composants
 * (`CookSheet`, `HistoryPanel`, `RatingSheet`) restent dans le dépôt, prêts à
 * être réaffichés — ils ne sont simplement plus rendus ici.
 */
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
  /** Parts actuellement sélectionnées (EF-26) : elles mettent les quantités des ingrédients à l'échelle. */
  servings: number;
  onServingsChange: (servings: number) => void;
}

function RecipeDetails({ recipe, servings, onServingsChange }: RecipeDetailsProps) {
  const toast = useToast();
  const patchRecipe = useRecipeDirectPatch();
  const [busy, setBusy] = useState(false);
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

  /**
   * Favori (A2, D1) : `useRecipeDirectPatch` écrit déjà le cache avant même
   * l'appel réseau — la fiche se met à jour d'elle-même (elle lit `recipe` via
   * `useRecipeQuery`, abonné au même cache), aucun état local à prévoir ici.
   * `busy` empêche seulement un double envoi, il ne retarde pas l'affichage.
   */
  const toggleFavorite = async () => {
    setBusy(true);
    try {
      await patchRecipe(recipe.id, { favorite: !recipe.favorite });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Impossible de mettre à jour le favori'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const time = formatMinutes(recipe.totalMinutes);

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

      <div className="flex flex-col gap-5 px-4 pb-8">
        {/*
          2026-10-20 : un seul bloc en tête, le détail des durées ayant rejoint
          les repères — « pour combien, et combien de temps » se lit d'un coup.
          Seules les durées renseignées s'affichent : un tiret à lire n'apprend
          rien. D9 : durée totale et difficulté sont des blocs colorés sur deux
          échelles distinctes. La couleur ne porte JAMAIS l'information seule —
          le texte reste lu, pour le daltonisme comme pour le mode sombre. Les
          teintes viennent des jetons du thème (`styles.css`), jamais d'une
          couleur en dur : une pastille codée en dur a déjà disparu dans son
          conteneur ici.
        */}
        <section role="group" aria-label="Résumé de la recette" className="flex flex-col gap-3 rounded-card bg-surface px-4 py-3 text-[14px]">
          <div className="flex flex-wrap items-center gap-2">
            {recipe.cuisineName && <span className="text-muted">{recipe.cuisineName}</span>}
            {time && <span className={cn('tnum rounded-md px-2 py-1 font-medium', timeLook(recipe.totalMinutes))}>{time}</span>}
            <span className={cn('rounded-md px-2 py-1 font-medium', DIFFICULTY_LOOK[recipe.difficulty])}>
              {DIFFICULTY_LABELS_FR[recipe.difficulty]}
              {recipe.difficultyOverride && ' (corrigée)'}
            </span>
            <FavoriteStar favorite={recipe.favorite} recipeTitle={recipe.title} onToggle={() => void toggleFavorite()} disabled={busy} className="ml-auto" />
          </div>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <TimeField label="Préparation" minutes={recipe.prepMinutes} />
            <TimeField label="Cuisson" minutes={recipe.cookMinutes} />
            <TimeField label="Temps actif" minutes={recipe.activeTime} />
            <TimeField label="Repos" minutes={recipe.restMinutes} />
            <Input
              label="Nombre de parts"
              // Champ texte et non « number » : le clavier décimal français
              // produit une virgule, qu'un champ numérique rejette en silence.
              type="text"
              inputMode="numeric"
              value={rawServings}
              onChange={(event) => onServingsTyped(event.target.value)}
              className="w-24"
            />
          </div>
        </section>

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
      </div>
    </>
  );
}

/** Une durée du détail : absente, elle ne s'affiche pas du tout (demande de Franck, 2026-10-20). */
function TimeField({ label, minutes }: { label: string; minutes: number | null }) {
  const value = formatMinutes(minutes);
  if (value === null) return null;
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="tnum font-medium">{value}</p>
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
