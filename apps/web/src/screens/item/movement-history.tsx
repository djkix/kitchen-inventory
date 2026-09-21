import type { StockMovementDto } from '@kitchen/shared';
import { UNIT_LABELS_FR, type Unit } from '@kitchen/shared';
import { cn } from '../../lib/cn';
import { formatDateTime } from '../../lib/expiry-ui';

const TYPE_LABELS: Record<StockMovementDto['type'], string> = {
  INBOUND: 'Entrée',
  CONSUMPTION: 'Consommation',
  ADJUSTMENT: 'Ajustement',
  LOSS: 'Jeté',
  RECIPE: 'Recette',
};

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, signDisplay: 'always' });

/** Historique des mouvements (EF-10) : la vérité du stock, du plus récent au plus ancien. */
export function MovementHistory({ movements, unit }: { movements: StockMovementDto[]; unit: Unit }) {
  if (movements.length === 0) return <p className="px-1 text-[14px] text-muted">Aucun mouvement enregistré.</p>;
  const sorted = [...movements].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <ol className="flex flex-col divide-y divide-line rounded-card bg-surface">
      {sorted.map((movement) => (
        <li key={movement.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px]">
              {TYPE_LABELS[movement.type]}
              {movement.reason && <span className="text-muted"> — {movement.reason}</span>}
            </p>
            <p className="text-[13px] text-faint">
              {formatDateTime(movement.occurredAt)}
              {movement.userName && ` · ${movement.userName}`}
            </p>
          </div>
          <span className={cn('tnum shrink-0 text-[15px] font-semibold', movement.delta > 0 ? 'text-accent' : 'text-fg')}>
            {NUMBER.format(movement.delta)} {UNIT_LABELS_FR[unit]}
          </span>
        </li>
      ))}
    </ol>
  );
}
