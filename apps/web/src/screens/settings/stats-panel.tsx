import { ErrorState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { errorMessage } from '../../lib/api';
import { useRecognitionStatsQuery } from '../../lib/queries';

const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Compteurs de la section 21 : appels, coût, taux automatique, part du cache, articles à identifier. */
export function StatsPanel() {
  const stats = useRecognitionStatsQuery();

  if (stats.isPending) {
    return (
      <div className="grid grid-cols-2 gap-2" aria-busy>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[76px] rounded-card" />
        ))}
      </div>
    );
  }
  if (stats.isError) return <ErrorState message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />;

  const s = stats.data;
  const disabled = s.provider === 'none';
  const tiles: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Photos aujourd’hui', value: `${s.visionCallsToday} / ${s.dailyQuota}`, note: s.visionCallsToday >= s.dailyQuota ? 'Quota atteint' : undefined },
    {
      label: 'Photos ce mois',
      value: String(s.visionCallsThisMonth),
      note:
        s.monthlyCapCents > 0
          ? `${EUROS.format(s.visionCostCentsThisMonth / 100)} sur ${EUROS.format(s.monthlyCapCents / 100)}`
          : EUROS.format(s.visionCostCentsThisMonth / 100),
    },
    { label: 'Reconnaissance automatique (30 j)', value: s.automaticRate30d === null ? '—' : PERCENT.format(s.automaticRate30d) },
    { label: 'Part du cache (30 j)', value: s.cacheShare30d === null ? '—' : PERCENT.format(s.cacheShare30d) },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className={`rounded-xl px-3 py-2 text-[14px] ${disabled ? 'bg-soon-deep text-soon' : 'bg-surface text-muted'}`}>
        Fournisseur de vision : <span className="font-medium text-fg">{disabled ? 'désactivé' : s.provider}</span>
        {disabled && ' — définissez VISION_PROVIDER et VISION_API_KEY sur le serveur pour activer la photo.'}
      </p>
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex min-h-[76px] flex-col justify-center rounded-card bg-surface px-4 py-3">
            <dt className="text-[12px] text-muted">{tile.label}</dt>
            <dd className="tnum text-[20px] font-semibold leading-tight">{tile.value}</dd>
            {tile.note && <dd className="text-[12px] text-faint">{tile.note}</dd>}
          </div>
        ))}
      </dl>
      {s.pendingIdentification > 0 && (
        <p className="rounded-xl bg-soon-deep px-3 py-2 text-[14px] text-soon">
          {s.pendingIdentification} photo{s.pendingIdentification > 1 ? 's' : ''} en attente d’identification (fournisseur injoignable au moment du scan).
        </p>
      )}
    </div>
  );
}
