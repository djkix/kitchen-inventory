import { COVERAGE_GROUP_LABELS_FR, DIFFICULTY_LABELS_FR, effectiveRating, type RecipeSummaryDto } from '@kitchen/shared';
import { FavoriteStar } from '../../components/ui/favorite-star';
import { formatRelativeDays } from '../../lib/expiry-ui';
import { cn } from '../../lib/cn';
import { formatMinutes, formatRatingAverage } from '../../lib/quantity-ui';

interface RecipeCardProps {
  recipe: RecipeSummaryDto;
  /** Omis (ex. dans les tests existants), la carte reste muette sur le favori plutôt que de planter. */
  onToggleFavorite?: () => void;
}

const GROUP_LOOK: Record<RecipeSummaryDto['group'], string> = {
  ready: 'bg-accent-deep text-accent',
  almost: 'bg-soon-deep text-soon',
  excluded: 'bg-raised text-faint',
};

/**
 * « Faite 7 fois · il y a 12 jours · ★ 4,3 », ou « Jamais faite », ou encore
 * « Jamais faite · ★ 4,3 » pour une recette jamais cuisinée mais déjà notée
 * directement (section 14). La note affichée passe toujours par
 * `effectiveRating` (D3, A5) : jamais la moyenne des réalisations recalculée
 * à la main ici, jamais d'étoiles vides.
 */
function formatHistory(recipe: RecipeSummaryDto): string {
  const { stats } = recipe;
  const { value } = effectiveRating(recipe.rating, stats.averageRating);
  const ratingLabel = formatRatingAverage(value);

  if (stats.timesCooked === 0) {
    return ratingLabel !== null ? `Jamais faite · ★ ${ratingLabel}` : 'Jamais faite';
  }
  const parts = [`Faite ${stats.timesCooked} fois`];
  if (stats.lastCookedAt) parts.push(formatRelativeDays(stats.lastCookedAt));
  if (ratingLabel !== null) parts.push(`★ ${ratingLabel}`);
  return parts.join(' · ');
}

/**
 * Nom accessible du lien qui enveloppe la carte (EF-23) : l'intitulé du rôle
 * `article` ne remonte pas dans le nom calculé d'un lien ancêtre (Chromium),
 * le lien resterait donc sans nom pour un lecteur d'écran — et introuvable
 * par une requête rôle + nom, qu'elle vienne d'un test de bout en bout ou
 * d'une technologie d'assistance. Le titre seul identifierait la recette,
 * mais pas si elle est cuisinable maintenant : on y ajoute l'état de
 * couverture (même information que le badge coloré, en mots).
 */
export function recipeAccessibleName(recipe: RecipeSummaryDto): string {
  return `${recipe.title}, ${COVERAGE_GROUP_LABELS_FR[recipe.group]} à ${Math.round(recipe.coverage * 100)} %`;
}

/**
 * RÈGLE pour qui ajoute un élément interactif à cette carte : il sera INERTE
 * par défaut. La liste pose `pointer-events-none` sur la carte entière pour que
 * le clic traverse jusqu'au lien de navigation posé dessous (voir
 * `recipes-screen.tsx`). Tout bouton ou lien ajouté ici doit donc reprendre
 * explicitement `pointer-events-auto`, comme le fait `FavoriteStar` — et rester
 * frère du lien, jamais son descendant : un élément interactif dans un autre est
 * du HTML invalide, et les lecteurs d'écran tactiles l'absorbent.
 */
export function RecipeCard({ recipe, onToggleFavorite }: RecipeCardProps) {
  const time = formatMinutes(recipe.totalMinutes);
  return (
    <article className="flex flex-col gap-2 rounded-card bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-medium leading-tight">{recipe.title}</h3>
        {onToggleFavorite && (
          <FavoriteStar favorite={recipe.favorite} recipeTitle={recipe.title} onToggle={onToggleFavorite} className="-my-2.5" />
        )}
        <span className={cn('tnum shrink-0 rounded-md px-1.5 py-0.5 text-[13px] font-semibold', GROUP_LOOK[recipe.group])}>
          {COVERAGE_GROUP_LABELS_FR[recipe.group]} · {Math.round(recipe.coverage * 100)} %
        </span>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted">
        {recipe.cuisineName && <span>{recipe.cuisineName}</span>}
        {recipe.cuisineName && (time || recipe.difficulty) && <span aria-hidden>·</span>}
        {time && <span className="tnum">{time}</span>}
        {time && recipe.difficulty && <span aria-hidden>·</span>}
        <span>{DIFFICULTY_LABELS_FR[recipe.difficulty]}</span>
      </p>

      <p className="tnum text-[13px] text-muted">{formatHistory(recipe)}</p>

      {recipe.missingLabels.length > 0 && (
        <p className="truncate text-[13px] text-faint">Manque : {recipe.missingLabels.join(', ')}</p>
      )}
    </article>
  );
}
