import type { StockItemDto } from '@kitchen/shared';
import { EXPIRY_GROUP_LABELS, expiryGroupOf, type ExpiryGroupKey } from '../../lib/expiry-ui';
import { StockItemCard } from './stock-item-card';
import type { GroupBy } from './stock-filters';

interface StockListProps {
  items: StockItemDto[];
  groupBy: GroupBy;
  onConsume: (item: StockItemDto, quantity: number) => void;
  busyId: string | null;
}

interface Group {
  key: string;
  title: string;
  items: StockItemDto[];
}

const EXPIRY_ORDER: ExpiryGroupKey[] = ['expired', 'soon', 'later', 'none'];

export function groupItems(items: StockItemDto[], groupBy: GroupBy): Group[] {
  if (groupBy === 'expiry') {
    const buckets = new Map<ExpiryGroupKey, StockItemDto[]>();
    for (const item of items) {
      const key = expiryGroupOf(item.expiryStatus);
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
    return EXPIRY_ORDER.filter((key) => buckets.has(key)).map((key) => ({
      key,
      title: EXPIRY_GROUP_LABELS[key],
      items: (buckets.get(key) ?? []).sort((a, b) => (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity)),
    }));
  }
  const buckets = new Map<string, Group>();
  for (const item of items) {
    const existing = buckets.get(item.locationId);
    if (existing) existing.items.push(item);
    else buckets.set(item.locationId, { key: item.locationId, title: item.location.path.replace(/\//g, ' › '), items: [item] });
  }
  return [...buckets.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

export function StockList({ items, groupBy, onConsume, busyId }: StockListProps) {
  const groups = groupItems(items, groupBy);
  return (
    <div className="flex flex-col gap-5 px-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.title}>
          <h2 className="mb-2 flex items-baseline justify-between px-1 text-[13px] font-semibold text-muted">
            <span className="truncate">{group.title}</span>
            <span className="tnum text-faint">{group.items.length}</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {group.items.map((item) => (
              <li key={item.id}>
                <StockItemCard item={item} showLocation={groupBy !== 'location'} onConsume={onConsume} busy={busyId === item.id} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
