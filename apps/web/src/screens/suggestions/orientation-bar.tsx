import {
  DIFFICULTY_LABELS_FR,
  SUGGESTION_DURATIONS,
  SUGGESTION_REGIONS,
  SUGGESTION_REGION_LABELS_FR,
  type Difficulty,
  type SuggestionDuration,
  type SuggestionRegion,
} from '@kitchen/shared';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { SuggestionOrientation } from '../../lib/suggestions-api';

const DIFFICULTIES = Object.keys(DIFFICULTY_LABELS_FR) as Difficulty[];

interface OrientationBarProps {
  value: SuggestionOrientation;
  onChange: (value: SuggestionOrientation) => void;
}

/** Nombre de dimensions actives (B9) : une orientation vide équivaut à la fournée de base. */
export function countActiveOrientation(value: SuggestionOrientation): number {
  let count = 0;
  if (value.region !== undefined) count += 1;
  if (value.maxMinutes !== undefined) count += 1;
  if (value.difficulty !== undefined) count += 1;
  return count;
}

/**
 * Orientation des suggestions par région, durée et difficulté (section 12, EF-26,
 * décision du 2026-10-04) : chaque geste relance une recherche ciblée, jamais un
 * simple filtrage de ce qui est déjà affiché — la cascade ne peut pas promettre
 * une recette asiatique si le lot courant n'en contenait aucune.
 *
 * Choix laissé au jugement (le cahier des charges ne tranche pas) : une seule
 * valeur active par dimension, pas un multi-choix — cohérent avec
 * `SuggestionOrientation`, où `region`, `maxMinutes` et `difficulty` sont chacun
 * un champ scalaire facultatif, pas un tableau. Cliquer la valeur déjà active la
 * désélectionne (retour à « pas de contrainte » sur cette seule dimension).
 */
export function OrientationBar({ value, onChange }: OrientationBarProps) {
  const activeCount = countActiveOrientation(value);

  const clear = () => {
    onChange({ ...value, region: undefined, maxMinutes: undefined, difficulty: undefined });
  };

  const setRegion = (region: SuggestionRegion) => {
    onChange({ ...value, region: value.region === region ? undefined : region });
  };

  const setDuration = (maxMinutes: SuggestionDuration) => {
    onChange({ ...value, maxMinutes: value.maxMinutes === maxMinutes ? undefined : maxMinutes });
  };

  const setDifficulty = (difficulty: Difficulty) => {
    onChange({ ...value, difficulty: value.difficulty === difficulty ? undefined : difficulty });
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">
          {activeCount > 0 ? `${activeCount} orientation${activeCount > 1 ? 's' : ''}` : 'Aucune orientation'}
        </span>
        <button type="button" onClick={clear} className="min-h-touch rounded-xl px-3 text-[14px] font-medium text-accent active:bg-raised">
          Tout effacer
        </button>
      </div>

      {/* Par région, jamais par pays (B10) : le pays reste affiché sur la carte, seule la région se choisit ici. */}
      <ChipRow label="Région">
        {SUGGESTION_REGIONS.map((region) => (
          <Chip key={region} active={value.region === region} onClick={() => setRegion(region)}>
            {SUGGESTION_REGION_LABELS_FR[region]}
          </Chip>
        ))}
      </ChipRow>

      <ChipRow label="Durée">
        {SUGGESTION_DURATIONS.map((minutes) => (
          <Chip key={minutes} active={value.maxMinutes === minutes} onClick={() => setDuration(minutes)}>
            ≤ {minutes} min
          </Chip>
        ))}
      </ChipRow>

      <ChipRow label="Difficulté">
        {DIFFICULTIES.map((difficulty) => (
          <Chip key={difficulty} active={value.difficulty === difficulty} onClick={() => setDifficulty(difficulty)}>
            {DIFFICULTY_LABELS_FR[difficulty]}
          </Chip>
        ))}
      </ChipRow>
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
