import { RECIPE_TREND_LABELS_FR, type RecipeLogDto, type RecipeStatsDto } from '@kitchen/shared';
import { Button } from '../../components/ui/button';
import { TrashIcon } from '../../components/ui/icons';
import { formatDateTime } from '../../lib/expiry-ui';

function formatAverage(average: number | null): string {
  if (average === null) return '—';
  return average.toFixed(1).replace('.', ',');
}

interface HistoryPanelProps {
  stats: RecipeStatsDto;
  logs: RecipeLogDto[];
  currentUserId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onRate: (log: RecipeLogDto) => void;
  onDelete: (log: RecipeLogDto) => void;
  deletingLogId: string | null;
}

/** Bloc Historique de la fiche recette (A24, A25, A26) : moyenne, tendance, puis chaque réalisation. */
export function HistoryPanel({ stats, logs, currentUserId, hasNextPage, isFetchingNextPage, onLoadMore, onRate, onDelete, deletingLogId }: HistoryPanelProps) {
  return (
    <section aria-label="Historique" className="flex flex-col gap-3">
      <h2 className="px-1 text-[13px] font-semibold text-muted">Historique</h2>

      <div className="flex items-center gap-4 rounded-card bg-surface px-4 py-3">
        <div>
          <p className="tnum text-[22px] font-semibold leading-none">{formatAverage(stats.averageRating)}</p>
          <p className="text-[12px] text-muted">{stats.ratingCount > 0 ? `sur ${stats.ratingCount} note${stats.ratingCount > 1 ? 's' : ''}` : 'Aucune note'}</p>
        </div>
        <div className="h-8 w-px bg-line" aria-hidden />
        <div>
          <p className="tnum text-[22px] font-semibold leading-none">{stats.timesCooked}</p>
          <p className="text-[12px] text-muted">réalisation{stats.timesCooked > 1 ? 's' : ''}</p>
        </div>
        {stats.recentTrend && (
          <>
            <div className="h-8 w-px bg-line" aria-hidden />
            <div>
              <p className="text-[14px] font-medium leading-none">{RECIPE_TREND_LABELS_FR[stats.recentTrend]}</p>
              <p className="text-[12px] text-muted">Tendance récente</p>
            </div>
          </>
        )}
      </div>

      {logs.length === 0 ? (
        <p className="px-1 text-[14px] text-muted">Jamais faite : aucune réalisation enregistrée.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line rounded-card bg-surface">
          {logs.map((log) => {
            const mine = log.ratings.find((rating) => rating.userId === currentUserId);
            return (
              <li key={log.id} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px]">
                      {formatDateTime(log.cookedAt)}
                      {log.cookedByName && ` · ${log.cookedByName}`}
                    </p>
                    <p className="tnum text-[13px] text-muted">
                      {log.servingsCooked} portion{log.servingsCooked > 1 ? 's' : ''}
                      {log.stockApplied ? ' · stock décrémenté' : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Supprimer cette réalisation"
                    loading={deletingLogId === log.id}
                    onClick={() => onDelete(log)}
                    className="shrink-0 text-danger"
                  >
                    <TrashIcon size={18} />
                  </Button>
                </div>

                {log.ratings.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {log.ratings.map((rating) => (
                      <li key={rating.userId} className="text-[13px] text-muted">
                        <span className="tnum text-accent">{'★'.repeat(rating.stars)}</span> {rating.userName}
                        {rating.comment && <span> — {rating.comment}</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {log.canRate && (
                  <Button size="sm" variant="outline" className="w-fit" onClick={() => onRate(log)}>
                    {mine ? 'Modifier ma note' : 'Noter'}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasNextPage && (
        <Button block onClick={onLoadMore} loading={isFetchingNextPage}>
          Charger plus de réalisations
        </Button>
      )}
    </section>
  );
}
