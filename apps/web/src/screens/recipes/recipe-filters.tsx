import {
  DIET_LABELS_FR,
  DIETS,
  DIFFICULTY_LABELS_FR,
  DISH_TYPE_LABELS_FR,
  DISH_TYPES,
  RECIPE_SORTS,
  RECIPE_SORT_LABELS_FR,
  type Difficulty,
  type DishType,
  type RecipeFilters,
} from '@kitchen/shared';
import type { ChangeEvent, ReactNode } from 'react';
import { Select } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import type { CuisineDto } from '../../lib/types';

const DIFFICULTIES = Object.keys(DIFFICULTY_LABELS_FR) as Difficulty[];
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

/**
 * Une facette à choix multiple vue par un `<select>` à choix unique : la
 * valeur affichée est la première du tableau, et choisir remplace tout le
 * tableau. Les facettes restent des tableaux côté API
 * (`recipeFiltersSchema`), donc rien ne casse si une préférence enregistrée
 * en contient plusieurs — le sélecteur montre la première et le prochain
 * geste ramène à une seule.
 */
function singleOf<T extends string>(list: readonly T[] | undefined): T | '' {
  return list?.[0] ?? '';
}

function pickOne<T extends string>(event: ChangeEvent<HTMLSelectElement>): T[] {
  const next = event.target.value;
  return next === '' ? [] : [next as T];
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

const SELECT_CLASS =
  'min-h-touch min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-2.5 text-[14px] text-fg focus:border-accent focus:outline-none';

/**
 * Filtres et tri de la liste des recettes (EF-21, EF-22, EF-23 ; section 14).
 *
 * Même présentation que l'orientation des suggestions (2026-10-15, demande de
 * Franck : « pour "mes recettes" avoir la même approche au niveau des filtres
 * que pour les suggestions ») : des `<select>` natifs par paires plutôt que
 * six rangées de pastilles défilantes, qui remplissaient un écran de
 * téléphone entier alors que l'application est utilisée en très grande
 * majorité sur mobile. Même ordre que là-bas aussi : type de plat d'abord,
 * puis cuisine, puis les autres.
 *
 * Conséquence assumée : une seule valeur active par facette, là où les
 * pastilles permettaient d'en cumuler plusieurs. C'est le comportement de
 * l'écran Suggestions, et cumuler deux cuisines ou deux régimes ne s'est
 * jamais révélé utile à l'usage ; `singleOf` plus haut dit comment une
 * préférence enregistrée qui en contient plusieurs est rattrapée.
 *
 * Les cinq bascules booléennes (valeurs sûres, réalisables, déjà faites,
 * favoris, archivées) restent des pastilles : une bascule n'est pas un choix
 * parmi N, et elles tiennent déjà sur une seule rangée.
 */
export function RecipeFiltersBar({ value, cuisines, onChange }: RecipeFiltersBarProps) {
  const activeCount = countActiveRecipeFilters(value);

  const clearFilters = () => {
    onChange({ ...EMPTY_RECIPE_FILTERS, sort: value.sort });
  };

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Type de plat"
            value={singleOf(value.dishType)}
            onChange={(event) => onChange({ ...value, dishType: pickOne<DishType>(event) })}
            className={SELECT_CLASS}
          >
            <option value="">Tous les types</option>
            {DISH_TYPES.map((type) => (
              <option key={type} value={type}>
                {DISH_TYPE_LABELS_FR[type]}
              </option>
            ))}
          </select>

          <select
            aria-label="Cuisine"
            value={singleOf(value.cuisine)}
            onChange={(event) => onChange({ ...value, cuisine: pickOne<string>(event) })}
            className={SELECT_CLASS}
            disabled={cuisines.length === 0}
          >
            <option value="">Toutes les cuisines</option>
            {cuisines.map((cuisine) => (
              <option key={cuisine.id} value={cuisine.id}>
                {cuisine.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            aria-label="Durée"
            value={value.maxTime?.toString() ?? ''}
            onChange={(event) => onChange({ ...value, maxTime: event.target.value === '' ? undefined : Number(event.target.value) })}
            className={SELECT_CLASS}
          >
            <option value="">Toutes durées</option>
            {MAX_TIME_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                ≤ {minutes} min
              </option>
            ))}
          </select>

          <select
            aria-label="Facilité"
            value={singleOf(value.difficulty)}
            onChange={(event) => onChange({ ...value, difficulty: pickOne<Difficulty>(event) })}
            className={SELECT_CLASS}
          >
            <option value="">Toutes difficultés</option>
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {DIFFICULTY_LABELS_FR[difficulty]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            aria-label="Régime"
            value={singleOf(value.diet)}
            onChange={(event) => onChange({ ...value, diet: pickOne<(typeof DIETS)[number]>(event) })}
            className={SELECT_CLASS}
          >
            <option value="">Tous régimes</option>
            {DIETS.map((diet) => (
              <option key={diet} value={diet}>
                {DIET_LABELS_FR[diet]}
              </option>
            ))}
          </select>

          <select
            aria-label="Note minimale"
            value={value.minRating?.toString() ?? ''}
            onChange={(event) => onChange({ ...value, minRating: event.target.value === '' ? undefined : Number(event.target.value) })}
            className={SELECT_CLASS}
          >
            <option value="">Toutes notes</option>
            {MIN_RATING_OPTIONS.map((stars) => (
              <option key={stars} value={stars}>
                ★ {stars.toString().replace('.', ',')}+
              </option>
            ))}
          </select>
        </div>
      </div>

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
