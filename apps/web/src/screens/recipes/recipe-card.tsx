import { COVERAGE_GROUP_LABELS_FR, DIFFICULTY_LABELS_FR, type RecipeSummaryDto } from '@kitchen/shared';
import { formatRelativeDays } from '../../lib/expiry-ui';
import { cn } from '../../lib/cn';
import { formatMinutes, formatRatingAverage } from '../../lib/quantity-ui';

interface RecipeCardProps {
  recipe: RecipeSummaryDto;
}

const GROUP_LOOK: Record<RecipeSummaryDto['group'], string> = {
  ready: 'bg-accent-deep text-accent',
  almost: 'bg-soon-deep text-soon',
  excluded: 'bg-raised text-faint',
};

/** « Faite 7 fois · il y a 12 jours · ★ 4,3 », ou « Jamais faite » (section 14). */
function formatHistory(stats: RecipeSummaryDto['stats']): string {
  if (stats.timesCooked === 0) return 'Jamais faite';
  const parts = [`Faite ${stats.timesCooked} fois`];
  if (stats.lastCookedAt) parts.push(formatRelativeDays(stats.lastCookedAt));
  const averageLabel = formatRatingAverage(stats.averageRating);
  if (averageLabel !== null) parts.push(`★ ${averageLabel}`);
  return parts.join(' · ');
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const time = formatMinutes(recipe.totalMinutes);
  return (
    <article className="flex flex-col gap-2 rounded-card bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-medium leading-tight">{recipe.title}</h3>
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

      <p className="tnum text-[13px] text-muted">{formatHistory(recipe.stats)}</p>

      {recipe.bonus > 0 && (
        <span className="inline-flex w-fit items-center rounded-md bg-warn-deep px-1.5 py-0.5 text-[12px] font-semibold text-warn">Anti-gaspillage</span>
      )}

      {recipe.missingLabels.length > 0 && (
        <p className="truncate text-[13px] text-faint">Manque : {recipe.missingLabels.join(', ')}</p>
      )}
    </article>
  );
}
