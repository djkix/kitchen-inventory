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
}

/**
 * Nombre de dimensions actives (B9) : une orientation vide équivaut à la
 * fournée de base. Le type de plat compte désormais à part entière (revue
 * finale du 2026-10-11, voir plus bas) : ce n'est plus un filtre local
 * gratuit, c'est une orientation serveur comme les trois autres.
 */
export function countActiveOrientation(value: SuggestionOrientation): number {
  let count = 0;
  if (value.dishType !== undefined) count += 1;
  if (value.region !== undefined) count += 1;
  if (value.maxMinutes !== undefined) count += 1;
  if (value.difficulty !== undefined) count += 1;
  return count;
}

const SELECT_CLASS =
  'min-h-touch min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-2.5 text-[14px] text-fg focus:border-accent focus:outline-none';

/**
 * Orientation des suggestions par type de plat, région, durée et difficulté
 * (section 12, EF-25, EF-26) : chaque geste relance une recherche ciblée,
 * jamais un simple filtrage de ce qui est déjà affiché — la cascade ne peut
 * pas promettre une recette asiatique si le lot courant n'en contenait
 * aucune.
 *
 * Le type de plat relance désormais lui aussi (revue finale du 2026-10-11) :
 * il filtrait auparavant gratuitement la fournée déjà chargée (D4, décision
 * du 2026-10-08), un choix cohérent tant que la fournée restait mélangée. La
 * question bloquante ajoutée ensuite (D2/D3, même journée) envoie le type
 * répondu au modèle, qui reçoit alors la consigne « Ne propose que des
 * recettes de type X » (`apps/api/src/suggestions/prompt.ts`) — la fournée
 * devient mono-type. Un filtre local sur un seul type déjà présent ne peut
 * donc plus que soit ne rien faire, soit tout vider ; D4 est devenue sans
 * objet et n'a pas été rouverte à temps. Le sélecteur est maintenant le
 * contrôle unique du type (valeur prise directement dans `value.dishType`,
 * plus de prop locale séparée) et se comporte exactement comme les trois
 * autres.
 *
 * Depuis le 2026-10-20, la barre ne vit plus en place permanente : elle est le
 * contenu du panneau « Filtres » de l'écran Suggestions, ouvert par le bouton
 * posé sur la ligne du champ d'ingrédients — même geste que « Mes recettes »
 * (D2 du 2026-10-19). Rien n'y est retiré ni changé : le tiroir pose ses
 * propres marges, cette barre n'en porte donc plus.
 *
 * Quatre `<select>` natifs sur deux lignes de deux (D5, 2026-10-11) plutôt que
 * les quatre rangées de pastilles d'origine, qui prenaient la moitié d'un
 * écran de téléphone. Natif, pas un menu reconstruit en React : au téléphone,
 * le menu système ouvre une roue pleine largeur, confortable au pouce, et
 * gère le clavier et le lecteur d'écran gratuitement — un menu maison ferait
 * moins bien pour plus de code. `min-h-touch` tient par la hauteur du
 * contrôle, pas par sa police (A7).
 *
 * Deux par ligne, pas quatre (revue du 2026-10-11, djkix avait autorisé « 1
 * ou 2 lignes ») : à 375 px, quatre sélecteurs sur une seule ligne ne
 * laissent qu'environ 45 px de texte utile chacun une fois marges, gouttières,
 * padding et flèche native déduits — trop peu pour lire « Latino-américaine »
 * ou « Petit-déjeuner », qui existent réellement dans les taxonomies
 * (`SUGGESTION_REGIONS`, `DISH_TYPES`). Deux lignes de deux donnent environ
 * 160 px par sélecteur, largement suffisant, pour un coût d'environ 40 px de
 * hauteur supplémentaire — on garde l'essentiel du gain d'espace de la
 * fusion sans sacrifier la lisibilité, qui est l'objet de la demande.
 *
 * Choix laissé au jugement (le cahier des charges ne tranche pas) : une seule
 * valeur active par dimension, pas un multi-choix — cohérent avec
 * `SuggestionOrientation`, où `region`, `maxMinutes` et `difficulty` sont chacun
 * un champ scalaire facultatif, pas un tableau.
 */
export function OrientationBar({ value, onChange }: OrientationBarProps) {
  const activeCount = countActiveOrientation(value);

  // `refresh: undefined` posé explicitement à chaque geste normal (revue finale
  // du 2026-10-11) : un `refresh: true` ne doit valoir que pour LA recherche qui
  // l'a demandé, jamais pour les gestes suivants. Sans cette remise à zéro, un
  // `refresh: true` posé ailleurs (relance forcée depuis la question d'entrée,
  // voir `suggestions-screen.tsx`) resterait collé à l'orientation : tout geste
  // suivant ici — cuisine, durée, difficulté, type de plat — contournerait alors
  // le cache de 24 h et consommerait quota et euros à chaque geste, au lieu de
  // ne le faire que pour un changement qui le justifie.
  const clear = () => {
    onChange({ ...value, dishType: undefined, region: undefined, maxMinutes: undefined, difficulty: undefined, refresh: undefined });
  };

  const handleDishType = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, dishType: next === '' ? undefined : (next as DishType), refresh: undefined });
  };

  const handleRegion = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, region: next === '' ? undefined : (next as SuggestionRegion), refresh: undefined });
  };

  const handleDuration = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, maxMinutes: next === '' ? undefined : (Number(next) as SuggestionDuration), refresh: undefined });
  };

  const handleDifficulty = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    onChange({ ...value, difficulty: next === '' ? undefined : (next as Difficulty), refresh: undefined });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">
          {activeCount > 0 ? `${activeCount} orientation${activeCount > 1 ? 's' : ''}` : 'Aucune orientation'}
        </span>
        <button type="button" onClick={clear} className="min-h-touch rounded-xl px-3 text-[14px] font-medium text-accent active:bg-raised">
          Tout effacer
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          {/* Premier des quatre : c'est la question posée avant toutes les autres — entrée, plat ou dessert.
              Relance désormais comme les trois autres (revue finale du 2026-10-11). */}
          <select aria-label="Type de plat" value={value.dishType ?? ''} onChange={handleDishType} className={SELECT_CLASS}>
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
        </div>

        <div className="flex items-center gap-1.5">
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
    </div>
  );
}
