import { cn } from '../../lib/cn';
import { SearchIcon } from '../../components/ui/icons';

export type GroupBy = 'location' | 'expiry';
export type StockChip = 'all' | 'soon' | 'expired' | 'archived';

const CHIPS: Array<{ value: StockChip; label: string }> = [
  { value: 'all', label: 'Tout' },
  { value: 'soon', label: 'Bientôt' },
  { value: 'expired', label: 'Dépassés' },
  { value: 'archived', label: 'Terminés' },
];

interface StockFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
  chip: StockChip;
  onChipChange: (value: StockChip) => void;
}

/** Recherche en haut, regroupement et filtres d'état sous forme de pastilles (section 14). */
export function StockFilters({ query, onQueryChange, groupBy, onGroupByChange, chip, onChipChange }: StockFiltersProps) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      <label className="relative block">
        <span className="sr-only">Rechercher un article</span>
        <SearchIcon size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Rechercher (« nouilles » trouve « ramen »)"
          enterKeyHint="search"
          autoComplete="off"
          className="min-h-touch w-full rounded-xl border border-line bg-surface pl-11 pr-3.5 text-[16px] placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </label>
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <div role="group" aria-label="Regrouper par" className="flex shrink-0 rounded-xl bg-surface p-0.5">
          {(['location', 'expiry'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={groupBy === value}
              onClick={() => onGroupByChange(value)}
              className={cn('min-h-[40px] rounded-[10px] px-3 text-[14px] font-medium', groupBy === value ? 'bg-raised text-fg' : 'text-muted')}
            >
              {value === 'location' ? 'Emplacement' : 'Péremption'}
            </button>
          ))}
        </div>
        <div className="h-6 w-px shrink-0 bg-line" aria-hidden />
        {CHIPS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={chip === option.value}
            onClick={() => onChipChange(option.value)}
            className={cn(
              'min-h-[40px] shrink-0 rounded-full border px-3.5 text-[14px] font-medium',
              chip === option.value ? 'border-accent bg-accent-deep text-accent' : 'border-line text-muted',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
