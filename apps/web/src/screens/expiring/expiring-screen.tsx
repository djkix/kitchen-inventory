import type { StockItemDto } from '@kitchen/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { TrashIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useUndo } from '../../hooks/use-undo';
import { errorMessage } from '../../lib/api';
import { useExpiringQuery } from '../../lib/queries';
import { formatQuantity } from '../../lib/quantity-ui';
import { stockApi } from '../../lib/stock-api';
import { StockItemCard } from '../stock/stock-item-card';

/** EF-09 : articles périmant sous X jours, X étant le seuil d'alerte de l'instance. */
export function ExpiringScreen() {
  const expiring = useExpiringQuery();
  const undo = useUndo();
  const [busyId, setBusyId] = useState<string | null>(null);

  const consume = async (item: StockItemDto, quantity: number) => {
    setBusyId(item.id);
    try {
      const result = await stockApi.consume(item.id, quantity);
      const consumed = result.movement ? Math.abs(result.movement.delta) : quantity;
      undo.announce({ message: `${formatQuantity(consumed, item.unit)} de ${item.product.name} consommé`, itemId: item.id, appliedDelta: -consumed });
      await expiring.refetch();
    } catch (error) {
      undo.fail(error, 'Consommation impossible');
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (item: StockItemDto) => {
    setBusyId(item.id);
    try {
      const result = await stockApi.discard(item.id);
      const lost = result.movement ? Math.abs(result.movement.delta) : item.quantity;
      undo.announce({ message: `${item.product.name} jeté`, itemId: item.id, appliedDelta: -lost });
      await expiring.refetch();
    } catch (error) {
      undo.fail(error, 'Suppression impossible');
    } finally {
      setBusyId(null);
    }
  };

  const alertDays = expiring.data?.alertDays;

  return (
    <>
      <ScreenHeader
        title="Périme bientôt"
        back="/"
        subtitle={alertDays !== undefined ? `Sous ${alertDays} jour${alertDays > 1 ? 's' : ''}, dates dépassées comprises` : undefined}
        actions={
          <Link to="/reglages" className="inline-flex min-h-touch items-center rounded-xl px-3 text-[14px] text-muted active:bg-raised">
            Seuil
          </Link>
        }
      />
      {expiring.isPending ? (
        <ListSkeleton />
      ) : expiring.isError ? (
        <ErrorState message={errorMessage(expiring.error)} onRetry={() => void expiring.refetch()} />
      ) : expiring.data.items.length === 0 ? (
        <EmptyState
          title="Rien à surveiller"
          description={`Aucun article daté ne périme sous ${alertDays} jours. Les articles sans date n’apparaissent jamais ici : ajoutez-leur une date depuis leur fiche pour être prévenu.`}
        />
      ) : (
        <ul className="flex flex-col gap-2 px-4">
          {expiring.data.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <StockItemCard item={item} showLocation onConsume={(target, quantity) => void consume(target, quantity)} busy={busyId === item.id} />
              <div className="flex justify-end pr-1">
                <Button variant="ghost" size="sm" icon={<TrashIcon size={16} />} disabled={busyId === item.id} onClick={() => void discard(item)} className="text-danger">
                  Jeter
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
