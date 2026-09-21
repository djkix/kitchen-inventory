import type { LocationNode, StockItemDto, UpdateStockItemInput } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { EstimatedIcon, OpenIcon, PinIcon, TrashIcon } from '../../components/ui/icons';
import { Skeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { useUndo } from '../../hooks/use-undo';
import { errorMessage, isApiError, mediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { dateTypeLabel, daysLabel, daysSentence, expiryLook, formatDate } from '../../lib/expiry-ui';
import { queryKeys, useStockItemQuery } from '../../lib/queries';
import { formatQuantity } from '../../lib/quantity-ui';
import { stockApi } from '../../lib/stock-api';
import { ConsumeSheet } from './consume-sheet';
import { DateSheet } from './date-sheet';
import { MoveSheet } from './move-sheet';
import { MovementHistory } from './movement-history';

type SheetName = 'consume' | 'move' | 'date' | null;

/** Fiche article (section 14) : photo, identité, quantité, emplacement, date, actions et historique. */
export function ItemScreen() {
  const { id } = useParams<{ id: string }>();
  const item = useStockItemQuery(id);

  if (item.isPending) return <ItemSkeleton />;
  if (item.isError) {
    const missing = isApiError(item.error, 'not_found');
    return (
      <>
        <ScreenHeader title="Article" back="/" />
        <ErrorState
          title={missing ? 'Article introuvable' : undefined}
          message={missing ? 'Ce lot n’existe plus : il a peut-être été fusionné ou supprimé depuis un autre téléphone.' : errorMessage(item.error)}
          onRetry={missing ? undefined : () => void item.refetch()}
        />
      </>
    );
  }
  return <ItemDetails item={item.data} />;
}

function ItemDetails({ item }: { item: StockItemDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const undo = useUndo();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const look = expiryLook(item.expiryStatus);
  const image = mediaUrl(item.product.imagePath);
  const archived = item.archivedAt !== null || item.quantity <= 0;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.stockItem(item.id) });
    await undo.invalidateStock();
  };

  const consume = async (quantity: number) => {
    try {
      const result = await stockApi.consume(item.id, quantity);
      const consumed = result.movement ? Math.abs(result.movement.delta) : quantity;
      undo.announce({
        message: result.capped ? (result.message ?? 'Quantité ramenée au stock disponible') : `${formatQuantity(consumed, item.unit)} consommé`,
        itemId: item.id,
        appliedDelta: -consumed,
      });
      await refresh();
    } catch (error) {
      undo.fail(error, 'Consommation impossible');
      throw error;
    }
  };

  const discard = async () => {
    setBusy('discard');
    try {
      const result = await stockApi.discard(item.id);
      const lost = result.movement ? Math.abs(result.movement.delta) : item.quantity;
      undo.announce({ message: `${item.product.name} jeté`, itemId: item.id, appliedDelta: -lost });
      await refresh();
      navigate('/', { replace: true });
    } catch (error) {
      undo.fail(error, 'Suppression impossible');
    } finally {
      setBusy(null);
    }
  };

  const openItem = async () => {
    setBusy('open');
    try {
      await stockApi.open(item.id);
      toast.show({ message: 'Ouverture enregistrée, date effective recalculée', tone: 'success', durationMs: 3000 });
      await refresh();
    } catch (error) {
      undo.fail(error, 'Ouverture impossible');
    } finally {
      setBusy(null);
    }
  };

  const move = async (location: LocationNode) => {
    try {
      await stockApi.move(item.id, location.id);
      toast.show({ message: `Déplacé vers ${location.name}`, tone: 'success', durationMs: 3000 });
      await refresh();
    } catch (error) {
      undo.fail(error, 'Déplacement impossible');
      throw error;
    }
  };

  const updateDate = async (input: UpdateStockItemInput) => {
    await stockApi.update(item.id, input);
    toast.show({ message: 'Date enregistrée', tone: 'success', durationMs: 2500 });
    await refresh();
  };

  return (
    <>
      <ScreenHeader title={item.product.name} back="/" subtitle={item.product.brand ?? undefined} />
      <div className="flex flex-col gap-5 px-4">
        <section className="flex gap-4">
          <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-card bg-surface text-[44px]">
            {image ? <img src={image} alt={item.product.name} className="size-full object-cover" /> : <span aria-hidden>{item.product.category?.icon ?? '🍽️'}</span>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <p className="tnum text-[34px] font-semibold leading-none">{formatQuantity(item.quantity, item.unit)}</p>
            {item.product.originalName && <p className="truncate text-[14px] text-muted">{item.product.originalName}</p>}
            <p className="text-[14px] text-muted">
              {item.product.category?.name ?? 'Sans catégorie'}
              {item.product.barcode && <span className="tnum"> · {item.product.barcode}</span>}
            </p>
            {archived && <p className="text-[13px] font-medium text-faint">Lot terminé</p>}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setSheet('move')} disabled={archived} className="flex min-h-[72px] flex-col items-start justify-center gap-1 rounded-card bg-surface px-4 text-left active:bg-raised disabled:opacity-60">
            <span className="flex items-center gap-1.5 text-[13px] text-muted">
              <PinIcon size={15} /> Emplacement
            </span>
            <span className="truncate text-[15px] font-medium">{item.location.name}</span>
          </button>
          <button type="button" onClick={() => setSheet('date')} disabled={archived} className="flex min-h-[72px] flex-col items-start justify-center gap-1 rounded-card bg-surface px-4 text-left active:bg-raised disabled:opacity-60">
            <span className="flex items-center gap-1.5 text-[13px] text-muted">
              {item.dateEstimated ? <EstimatedIcon size={15} /> : null}
              {dateTypeLabel(item.dateType)}
              {item.dateEstimated && ' estimée'}
            </span>
            {item.expiryDate ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="tnum text-[15px] font-medium">{formatDate(item.effectiveExpiry ?? item.expiryDate)}</span>
                <span className={cn('tnum rounded-md px-1.5 py-0.5 text-[13px] font-semibold', look.chip)}>{daysLabel(item.daysUntilExpiry)}</span>
              </span>
            ) : (
              <span className="text-[15px] font-medium text-muted">Ajouter une date</span>
            )}
          </button>
        </section>

        {(item.opened || (item.effectiveExpiry && item.effectiveExpiry !== item.expiryDate)) && (
          <p className="flex items-center gap-2 rounded-xl bg-surface px-4 py-2.5 text-[14px] text-muted">
            <OpenIcon size={16} />
            {item.opened ? `Ouvert le ${formatDate(item.openedAt)}` : ''}
            {item.effectiveExpiry && item.effectiveExpiry !== item.expiryDate && ` — date effective ${formatDate(item.effectiveExpiry)}`}
          </p>
        )}

        <p className="sr-only">{daysSentence(item.daysUntilExpiry, item.dateEstimated)}</p>

        <section aria-label="Historique">
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">Mouvements</h2>
          <MovementHistory movements={item.movements ?? []} unit={item.unit} />
        </section>
      </div>

      {!archived && (
        <div className="safe-bottom fixed inset-x-0 bottom-[calc(var(--spacing-nav)+env(safe-area-inset-bottom,0px))] z-20 mx-auto max-w-lg bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-3 pt-6">
          <div className="flex gap-2">
            <Button variant="primary" size="lg" className="flex-[2]" onClick={() => setSheet('consume')}>
              Consommer
            </Button>
            {!item.opened && (
              <Button size="lg" className="flex-1" loading={busy === 'open'} onClick={() => void openItem()} icon={<OpenIcon size={18} />}>
                Ouvrir
              </Button>
            )}
            <Button variant="danger" size="lg" aria-label="Jeter" loading={busy === 'discard'} onClick={() => void discard()} className="px-4">
              <TrashIcon size={20} />
            </Button>
          </div>
        </div>
      )}

      <ConsumeSheet item={item} open={sheet === 'consume'} onClose={() => setSheet(null)} onConfirm={consume} />
      <MoveSheet item={item} open={sheet === 'move'} onClose={() => setSheet(null)} onConfirm={move} />
      {sheet === 'date' && <DateSheet item={item} open onClose={() => setSheet(null)} onConfirm={updateDate} />}
    </>
  );
}

function ItemSkeleton() {
  return (
    <>
      <ScreenHeader title=" " back="/" />
      <div className="flex flex-col gap-5 px-4" aria-busy>
        <div className="flex gap-4">
          <Skeleton className="size-28 rounded-card" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-[72px] rounded-card" />
          <Skeleton className="h-[72px] rounded-card" />
        </div>
        <Skeleton className="h-40 rounded-card" />
      </div>
    </>
  );
}
