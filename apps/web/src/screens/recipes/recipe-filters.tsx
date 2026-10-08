import {
  DIET_LABELS_FR,
  DIETS,
  DIFFICULTY_LABELS_FR,
  DISH_TYPE_LABELS_FR,
  DISH_TYPES,
  RECIPE_SORTS,
  RECIPE_SORT_LABELS_FR,
  type RecipeFilters,
} from '@kitchen/shared';
import type { ReactNode } from 'react';
import { Select } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import type { CuisineDto } from '../../lib/types';

const MAX_TIME_OPTIONS = [15, 30, 45, 60, 90] as const;
const MIN_RATING_OPTIONS = [3, 4, 4.5] as const;

/** Valeurs par défaut : aucun filtre, tri par note (reflète `recipeFiltersSchema`). */
export const EMPTY_RECIPE_FILTERS: RecipeFilters = {
  difficulty: [],
  cuisine: [],
  dishType: [],
  diet: [],
  tag: [],
  group: [],
  archived: false,
  cooked: false,
  // Pastille « Favoris » (A4, EF-21) : aucun favori actif par défaut.
  favorite: false,
  sort: 'rating',
};

interface RecipeFiltersBarProps {
  value: RecipeFilters;
  cuisines: CuisineDto[];
  onChange: (value: RecipeFilters) => void;
}

function toggleIn<T>(list: readonly T[] | undefined, item: T): T[] {
  const current = list ?? [];
  return current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item];
}

/** Nombre de facettes actives, tri exclu (le tri n'est jamais un « filtre » affiché). */
export function countActiveRecipeFilters(value: RecipeFilters): number {
  let count = 0;
  if ((value.difficulty?.length ?? 0) > 0) count += 1;
  if ((value.cuisine?.length ?? 0) > 0) count += 1;
  if ((value.dishType?.length ?? 0) > 0) count += 1;
  if ((value.diet?.length ?? 0) > 0) count += 1;
  if ((value.tag?.length ?? 0) > 0) count += 1;
  if ((value.group?.length ?? 0) > 0) count += 1;
  if (value.maxTime !== undefined) count += 1;
  if (value.minRating !== undefined) count += 1;
  if (value.archived) count += 1;
  if (value.cooked) count += 1;
  if (value.favorite) count += 1;
  return count;
}

/** Filtres et tri de la liste des recettes (EF-21, EF-22, EF-23 ; section 14). */
export function RecipeFiltersBar({ value, cuisines, onChange }: RecipeFiltersBarProps) {
  const activeCount = countActiveRecipeFilters(value);

  const clearFilters = () => {
    onChange({ ...EMPTY_RECIPE_FILTERS, sort: value.sort });
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{activeCount > 0 ? `${activeCount} filtre${activeCount > 1 ? 's' : ''}` : 'Aucun filtre'}</span>
        <button type="button" onClick={clearFilters} className="min-h-touch rounded-xl px-3 text-[14px] font-medium text-accent active:bg-raised">
          Tout effacer
        </button>
      </div>

      <ChipRow label="Pastilles rapides">
        <Chip active={(value.tag ?? []).includes('trusted')} onClick={() => onChange({ ...value, tag: toggleIn(value.tag, 'trusted') })}>
          Valeurs sûres
        </Chip>
        <Chip active={(value.group ?? []).includes('ready')} onClick={() => onChange({ ...value, group: toggleIn(value.group, 'ready') })}>
          Réalisables maintenant
        </Chip>
        <Chip active={value.cooked} onClick={() => onChange({ ...value, cooked: !value.cooked })}>
          Déjà faites
        </Chip>
        <Chip active={value.favorite} onClick={() => onChange({ ...value, favorite: !value.favorite })}>
          Favoris
        </Chip>
        <Chip active={value.archived} onClick={() => onChange({ ...value, archived: !value.archived })}>
          Archivées
        </Chip>
      </ChipRow>

      <ChipRow label="Type de plat">
        {DISH_TYPES.map((key) => (
          <Chip key={key} active={(value.dishType ?? []).includes(key)} onClick={() => onChange({ ...value, dishType: toggleIn(value.dishType, key) })}>
            {DISH_TYPE_LABELS_FR[key]}
          </Chip>
        ))}
      </ChipRow>

      {cuisines.length > 0 && (
        <ChipRow label="Cuisine">
          {cuisines.map((cuisine) => (
            <Chip key={cuisine.id} active={(value.cuisine ?? []).includes(cuisine.id)} onClick={() => onChange({ ...value, cuisine: toggleIn(value.cuisine, cuisine.id) })}>
              {cuisine.name}
            </Chip>
          ))}
        </ChipRow>
      )}

      <ChipRow label="Difficulté">
        {(Object.entries(DIFFICULTY_LABELS_FR) as Array<[keyof typeof DIFFICULTY_LABELS_FR, string]>).map(([key, label]) => (
          <Chip key={key} active={(value.difficulty ?? []).includes(key)} onClick={() => onChange({ ...value, difficulty: toggleIn(value.difficulty, key) })}>
            {label}
          </Chip>
        ))}
      </ChipRow>



      <ChipRow label="Régime">
        {DIETS.map((key) => (
          <Chip key={key} active={(value.diet ?? []).includes(key)} onClick={() => onChange({ ...value, diet: toggleIn(value.diet, key) })}>
            {DIET_LABELS_FR[key]}
          </Chip>
        ))}
      </ChipRow>

      <ChipRow label="Temps maximum">
        {MAX_TIME_OPTIONS.map((minutes) => (
          <Chip key={minutes} active={value.maxTime === minutes} onClick={() => onChange({ ...value, maxTime: value.maxTime === minutes ? undefined : minutes })}>
            ≤ {minutes} min
          </Chip>
        ))}
      </ChipRow>

      <ChipRow label="Note minimale">
        {MIN_RATING_OPTIONS.map((stars) => (
          <Chip key={stars} active={value.minRating === stars} onClick={() => onChange({ ...value, minRating: value.minRating === stars ? undefined : stars })}>
            ★ {stars.toString().replace('.', ',')}+
          </Chip>
        ))}
      </ChipRow>

      <Select
        label="Trier par"
        value={value.sort}
        onChange={(event) => onChange({ ...value, sort: event.target.value as RecipeFilters['sort'] })}
        options={RECIPE_SORTS.map((sort) => ({ value: sort, label: RECIPE_SORT_LABELS_FR[sort] }))}
      />
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={Boolean(active)}
      onClick={onClick}
      className={cn(
        'min-h-touch shrink-0 rounded-full border px-3.5 text-[14px] font-medium',
        active ? 'border-accent bg-accent-deep text-accent' : 'border-line text-muted',
      )}
    >
      {children}
    </button>
  );
}
