import {
  DIFFICULTY_LABELS_FR,
  DISH_TYPES,
  DISH_TYPE_LABELS_FR,
  SUGGESTION_DURATIONS,
  SUGGESTION_REGIONS,
  SUGGESTION_REGION_LABELS_FR,
  type Difficulty,
  type DishType,
  type SuggestionDuration,
  type SuggestionRegion,
} from '@kitchen/shared';
import type { ChangeEvent } from 'react';
import type { SuggestionOrientation } from '../../lib/suggestions-api';

const DIFFICULTIES = Object.keys(DIFFICULTY_LABELS_FR) as Difficulty[];

interface OrientationBarProps {
  value: SuggestionOrientation;
  onChange: (value: SuggestionOrientation) => void;
  /** Filtre d'écran, local : il ne part pas au serveur et ne relance rien. */
  dishType: DishType | undefined;
  onDishTypeChange: (dishType: DishType | undefined) => void;
}

/** Nombre de dimensions actives (B9) : une orientation vide équivaut à la fournée de base. */
export function countActiveOrientation(value: SuggestionOrientation): number {
  let count = 0;
  if (value.region !== undefined) count += 1;
  if (value.maxMinutes !== undefined) count += 1;
  if (value.difficulty !== undefined) count += 1;
  return count;
}

const SELECT_CLASS =
  'min-h-touch min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-2 text-[13px] text-fg focus:border-accent focus:outline-none';

/**
 * Orientation des suggestions par région, durée et difficulté (section 12, EF-26,
 * décision du 2026-10-04) : chaque geste relance une recherche ciblée, jamais un
 * simple filtrage de ce qui est déjà affiché — la cascade ne peut pas promettre
 * une recette asiatique si le lot courant n'en contenait aucune.
 *
 * Le type de plat fait exception, et vient en premier (demande de djkix du
 * 2026-10-08) : Gemini classe les douze recettes de la fournée, le filtre
 * s'applique donc sur ce qui est déjà chargé, sans appel ni dépense. Quand il
 * ne laisse rien, l'écran propose une relance explicite plutôt que de partir
 * chercher tout seul.
 *
 * Quatre `<select>` natifs sur une ligne (D5, 2026-10-11) plutôt que les
 * quatre rangées de pastilles d'origine, qui prenaient la moitié d'un écran de
 * téléphone. Natif, pas un menu reconstruit en React : au téléphone, le menu
 * système ouvre une roue pleine largeur, confortable au pouce, et gère le
 * clavier et le lecteur d'écran gratuitement — un menu maison ferait moins
 * bien pour plus de code. `min-h-touch` tient par la hauteur du contrôle, pas
 * par sa police (A7) : le texte reste à 13px pour que les quatre tiennent sur
 * une ligne à 375 px de large.
 *
 * Choix laissé au jugement (le cahier des charges ne tranche pas) : une seule
 * valeur active par dimension, pas un multi-choix — cohérent avec
 * `SuggestionOrientation`, où `region`, `maxMinutes` et `difficulty` sont chacun
 * un champ scalaire facultatif, pas un tableau.
 */
export function OrientationBar({ value, onChange, dishType, onDishTypeChange }: OrientationBarProps) {
  const activeCount = countActiveOrientation(value);

  const clear = () => {
    onChange({ ...value, region: undefined, maxMinutes: undefined, difficulty: undefined });
    onDishTypeChange(undefined);
  };

  const handleDishType = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onDishTypeChange(next === '' ? undefined : (next as DishType));
  };

  const handleRegion = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, region: next === '' ? undefined : (next as SuggestionRegion) });
  };

  const handleDuration = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, maxMinutes: next === '' ? undefined : (Number(next) as SuggestionDuration) });
  };

  const handleDifficulty = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, difficulty: next === '' ? undefined : (next as Difficulty) });
  };

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">
          {activeCount > 0 ? `${activeCount} orientation${activeCount > 1 ? 's' : ''}` : 'Aucune orientation'}
        </span>
        <button type="button" onClick={clear} className="min-h-touch rounded-xl px-3 text-[14px] font-medium text-accent active:bg-raised">
          Tout effacer
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Premier de la ligne : c'est la question posée avant toutes les autres — entrée, plat ou dessert. */}
        <select aria-label="Type de plat" value={dishType ?? ''} onChange={handleDishType} className={SELECT_CLASS}>
          <option value="">Tous les types</option>
          {DISH_TYPES.map((type) => (
            <option key={type} value={type}>
              {DISH_TYPE_LABELS_FR[type]}
            </option>
          ))}
        </select>

        {/* Par région, jamais par pays (B10) : le pays reste affiché sur la carte, seule la région se choisit ici. */}
        <select aria-label="Cuisine" value={value.region ?? ''} onChange={handleRegion} className={SELECT_CLASS}>
          <option value="">Toutes les cuisines</option>
          {SUGGESTION_REGIONS.map((region) => (
            <option key={region} value={region}>
              {SUGGESTION_REGION_LABELS_FR[region]}
            </option>
          ))}
        </select>

        <select aria-label="Durée" value={value.maxMinutes?.toString() ?? ''} onChange={handleDuration} className={SELECT_CLASS}>
          <option value="">Toutes durées</option>
          {SUGGESTION_DURATIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              ≤ {minutes} min
            </option>
          ))}
        </select>

        <select aria-label="Facilité" value={value.difficulty ?? ''} onChange={handleDifficulty} className={SELECT_CLASS}>
          <option value="">Toutes difficultés</option>
          {DIFFICULTIES.map((difficulty) => (
            <option key={difficulty} value={difficulty}>
              {DIFFICULTY_LABELS_FR[difficulty]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
