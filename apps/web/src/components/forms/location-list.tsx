import type { LocationNode } from '@kitchen/shared';
import { cn } from '../../lib/cn';
import { flattenLocations } from '../../lib/queries';
import { CheckIcon, PinIcon } from '../ui/icons';

interface LocationListProps {
  tree: LocationNode[];
  selectedId: string | null;
  onSelect: (location: LocationNode) => void;
  /** Identifiants non sélectionnables (par exemple l'emplacement courant lors d'un déplacement). */
  disabledIds?: string[];
}

/** Liste indentée de l'arbre des emplacements, lignes de 48 px pour le pouce. */
export function LocationList({ tree, selectedId, onSelect, disabledIds = [] }: LocationListProps) {
  const rows = flattenLocations(tree);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[14px] text-muted">Aucun emplacement pour l’instant. Créez-en un dans Réglages › Emplacements.</p>;
  }
  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const selected = row.id === selectedId;
        const disabled = disabledIds.includes(row.id);
        return (
          <li key={row.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(row)}
              aria-pressed={selected}
              className={cn(
                'flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left active:bg-raised disabled:opacity-40',
                selected && 'bg-accent-deep text-accent',
              )}
              style={{ paddingLeft: `${8 + row.depth * 20}px` }}
            >
              <PinIcon size={18} className={selected ? 'text-accent' : 'text-faint'} />
              <span className="flex-1 truncate text-[15px]">{row.name}</span>
              {row.itemCount > 0 && <span className="tnum text-[13px] text-faint">{row.itemCount}</span>}
              {selected && <CheckIcon size={18} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
