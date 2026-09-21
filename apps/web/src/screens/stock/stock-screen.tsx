import type { StockItemDto } from '@kitchen/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { ClockIcon } from '../../components/ui/icons';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useUndo } from '../../hooks/use-undo';
import { errorMessage } from '../../lib/api';
import { useStockInfiniteQuery } from '../../lib/queries';
import { formatQuantity } from '../../lib/quantity-ui';
import { stockApi } from '../../lib/stock-api';
import { StockFilters, type GroupBy, type StockChip } from './stock-filters';
import { StockList } from './stock-list';

const GROUP_KEY = 'kitchen.stock.groupBy';

function readGroupBy(): GroupBy {
  try {
    return window.localStorage.getItem(GROUP_KEY) === 'expiry' ? 'expiry' : 'location';
  } catch {
    return 'location';
  }
}

export function StockScreen() {
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy);
  const [chip, setChip] = useState<StockChip>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const undo = useUndo();

  const stock = useStockInfiniteQuery({ q: debouncedQuery || undefined, status: chip === 'archived' ? 'archived' : 'active' });

  const items = useMemo(() => {
    const all = stock.data?.pages.flatMap((page) => page.items) ?? [];
    if (chip === 'soon') return all.filter((item) => item.expiryStatus === 'soon');
    if (chip === 'expired') return all.filter((item) => item.expiryStatus === 'expired_use_by' || item.expiryStatus === 'expired_best_before');
    return all;
  }, [stock.data, chip]);

  const total = stock.data?.pages[0]?.total ?? 0;

  const changeGroupBy = (value: GroupBy) => {
    setGroupBy(value);
    try {
      window.localStorage.setItem(GROUP_KEY, value);
    } catch {
      /* stockage indisponible : le choix ne survit pas au rechargement */
    }
  };

  const consume = async (item: StockItemDto, quantity: number) => {
    setBusyId(item.id);
    try {
      const result = await stockApi.consume(item.id, quantity);
      const consumed = result.movement ? Math.abs(result.movement.delta) : quantity;
      const all = quantity >= item.quantity;
      undo.announce({
        message: all ? `${item.product.name} : tout consommé` : `${formatQuantity(consumed, item.unit)} de ${item.product.name} consommé`,
        itemId: item.id,
        appliedDelta: -consumed,
      });
    } catch (error) {
      undo.fail(error, 'Consommation impossible');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <ScreenHeader
        title="Stock"
        subtitle={stock.isSuccess ? <span className="tnum">{total} article{total > 1 ? 's' : ''}</span> : undefined}
        actions={
          <Link to="/perime-bientot" className="inline-flex min-h-touch items-center gap-1.5 rounded-xl px-3 text-[14px] font-medium text-soon active:bg-raised">
            <ClockIcon size={18} />
            Périme bientôt
          </Link>
        }
      />
      <StockFilters query={query} onQueryChange={setQuery} groupBy={groupBy} onGroupByChange={changeGroupBy} chip={chip} onChipChange={setChip} />

      {stock.isPending ? (
        <ListSkeleton />
      ) : stock.isError ? (
        <ErrorState message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />
      ) : items.length === 0 ? (
        <StockEmpty query={debouncedQuery} chip={chip} />
      ) : (
        <>
          <StockList items={items} groupBy={groupBy} onConsume={(item, quantity) => void consume(item, quantity)} busyId={busyId} />
          {stock.hasNextPage && (
            <div className="px-4 pt-4">
              <Button block onClick={() => void stock.fetchNextPage()} loading={stock.isFetchingNextPage}>
                Charger plus ({items.length} sur {total})
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function StockEmpty({ query, chip }: { query: string; chip: StockChip }) {
  if (query) {
    return (
      <EmptyState
        title={`Rien ne correspond à « ${query} »`}
        description="La recherche tolère les fautes et les synonymes. Si l’article n’est pas encore en stock, scannez-le ou créez-le à la main."
        action={
          <Link to={`/produits/nouveau?name=${encodeURIComponent(query)}`} className="inline-flex min-h-touch items-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-ink">
            Créer « {query} »
          </Link>
        }
      />
    );
  }
  if (chip === 'soon') return <EmptyState title="Rien ne périme bientôt" description="Aucun article n’atteint le seuil d’alerte. Le seuil se règle dans Réglages." />;
  if (chip === 'expired') return <EmptyState title="Aucune date dépassée" description="Tout ce qui porte une date est encore bon. Les articles sans date n’apparaissent jamais ici." />;
  if (chip === 'archived') return <EmptyState title="Aucun article terminé" description="Les lots consommés ou jetés apparaîtront ici avec leur historique." />;
  return (
    <EmptyState
      title="Le stock est vide"
      description="Placez-vous devant un placard, choisissez l’emplacement, puis scannez les articles en rafale : la caméra reste ouverte entre deux produits."
      action={
        <Link to="/scan" className="inline-flex min-h-[52px] items-center rounded-xl bg-accent px-5 text-[16px] font-semibold text-ink">
          Commencer à scanner
        </Link>
      }
    />
  );
}
