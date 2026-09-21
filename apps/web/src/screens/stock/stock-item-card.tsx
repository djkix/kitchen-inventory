import type { StockItemDto } from '@kitchen/shared';
import { useNavigate } from 'react-router';
import { EstimatedIcon, MinusIcon, OpenIcon } from '../../components/ui/icons';
import { useLongPress } from '../../hooks/use-long-press';
import { mediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { daysLabel, daysSentence, expiryLook } from '../../lib/expiry-ui';
import { consumeStep, formatQuantity } from '../../lib/quantity-ui';

interface StockItemCardProps {
  item: StockItemDto;
  /** Affiche l'emplacement (utile quand la liste n'est pas groupée par emplacement). */
  showLocation?: boolean;
  onConsume: (item: StockItemDto, quantity: number) => void;
  busy?: boolean;
}

/**
 * Carte d'article : rail coloré selon `expiryStatus`, compte à rebours tabulaire,
 * bouton « consommer » (un pas) avec appui long pour « tout consommer ».
 */
export function StockItemCard({ item, showLocation = false, onConsume, busy = false }: StockItemCardProps) {
  const navigate = useNavigate();
  const look = expiryLook(item.expiryStatus);
  const step = consumeStep(item.unit, item.quantity);
  const archived = item.archivedAt !== null || item.quantity <= 0;
  const image = mediaUrl(item.product.imagePath);

  const press = useLongPress({
    onLongPress: () => onConsume(item, item.quantity),
    onClick: () => onConsume(item, step),
  });

  return (
    <article className={cn('relative flex items-stretch overflow-hidden rounded-card bg-surface', archived && 'opacity-60')}>
      <div className={cn('w-1 shrink-0', look.rail)} aria-hidden />
      <button
        type="button"
        onClick={() => navigate(`/stock/${item.id}`)}
        className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-1 text-left active:bg-raised"
        aria-label={`${item.product.name}, ${formatQuantity(item.quantity, item.unit)}, ${daysSentence(item.daysUntilExpiry, item.dateEstimated)}`}
      >
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-raised text-[22px]">
          {image ? <img src={image} alt="" loading="lazy" className="size-full object-cover" /> : <span aria-hidden>{item.product.category?.icon ?? '🍽️'}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-medium leading-tight">{item.product.name}</p>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {item.product.brand && <span>{item.product.brand} — </span>}
            <span className="tnum text-fg">{formatQuantity(item.quantity, item.unit)}</span>
            {showLocation && <span> — {item.location.name}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pr-1">
          <span className={cn('tnum inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-semibold', look.chip)}>
            {item.dateEstimated && item.expiryStatus !== 'none' && <EstimatedIcon size={14} />}
            {item.opened && <OpenIcon size={14} />}
            {daysLabel(item.daysUntilExpiry)}
          </span>
        </div>
      </button>
      {!archived && (
        <button
          type="button"
          disabled={busy}
          aria-label={`Consommer ${formatQuantity(step, item.unit)} ; appui long pour tout consommer`}
          className="my-2 mr-2 flex w-touch shrink-0 items-center justify-center rounded-xl bg-raised text-fg active:bg-line disabled:text-faint"
          {...press}
        >
          <MinusIcon size={22} strokeWidth={2.4} />
        </button>
      )}
    </article>
  );
}
