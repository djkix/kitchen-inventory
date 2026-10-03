import { normalizeProductName } from './duplicates.js';

export type Difficulty = 'VERY_EASY' | 'EASY' | 'INTERMEDIATE' | 'HARD';

/**
 * Techniques qui font monter la difficulté (décision 9 du cahier). Chaque forme
 * est écrite explicitement : A11 interdit la racinisation et la correspondance
 * partielle, qui trouvaient « saisir » dans « dessaisir ».
 */
export const TECHNIQUE_FORMS: Readonly<Record<string, readonly string[]>> = {
  emulsionner: ['emulsionner', 'emulsionnez', 'emulsionne', 'emulsionnee', 'emulsion'],
  'monter en neige': ['monter en neige', 'montez en neige'],
  carameliser: ['carameliser', 'caramelisez', 'caramelise', 'caramelisee'],
  flamber: ['flamber', 'flambez', 'flambe', 'flambee'],
  pocher: ['pocher', 'pochez', 'poche', 'pochee', 'pochees'],
  reduire: ['reduire', 'reduisez', 'reduit', 'reduite', 'reduction'],
  clarifier: ['clarifier', 'clarifiez', 'clarifie', 'clarifiee'],
  petrir: ['petrir', 'petrissez', 'petri', 'petrie'],
  lever: ['lever', 'levez', 'levee', 'laisser lever'],
  saisir: ['saisir', 'saisissez', 'saisi', 'saisie'],
  deglacer: ['deglacer', 'deglacez', 'deglace', 'deglacee'],
  temperer: ['temperer', 'temperez', 'tempere', 'temperee'],
  blanchir: ['blanchir', 'blanchissez', 'blanchi', 'blanchie'],
  confire: ['confire', 'confisez', 'confit', 'confite'],
};

/** Expressions retirées du texte avant la recherche : elles ne décrivent pas une technique. */
export const TECHNIQUE_EXCEPTIONS: readonly string[] = [
  'reduire le feu', 'reduisez le feu', 'reduire la flamme', 'reduisez la flamme',
  'baisser la flamme', 'baissez la flamme',
];

/** Vrai si `needle` apparaît dans `haystack` délimité par autre chose qu'une lettre ou un chiffre. */
function containsWord(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? ' ' : haystack[at - 1]!;
    const after = haystack[at + needle.length] ?? ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

export function detectTechniques(steps: readonly string[]): string[] {
  let haystack = normalizeProductName(steps.join(' . '));
  for (const exception of TECHNIQUE_EXCEPTIONS) haystack = haystack.split(exception).join(' ');
  return Object.entries(TECHNIQUE_FORMS)
    .filter(([, forms]) => forms.some((form) => containsWord(haystack, form)))
    .map(([technique]) => technique);
}

function bucket(value: number, thresholds: readonly [number, number, number]): number {
  if (value <= thresholds[0]) return 0;
  if (value <= thresholds[1]) return 1;
  if (value <= thresholds[2]) return 2;
  return 3;
}

interface DifficultyInput {
  steps: readonly string[];
  /** Temps réellement passé aux fourneaux ; à défaut, le temps de préparation (A12). */
  activeTime: number | null;
  prepMinutes: number | null;
}

export function difficultyScore(input: DifficultyInput): number {
  const steps = bucket(input.steps.length, [3, 6, 10]);
  const time = bucket(input.activeTime ?? input.prepMinutes ?? 0, [10, 25, 45]);
  const techniques = Math.min(3, detectTechniques(input.steps).length);
  return steps + time + techniques;
}

export function computeDifficulty(input: DifficultyInput): Difficulty {
  const score = difficultyScore(input);
  if (score <= 1) return 'VERY_EASY';
  if (score <= 3) return 'EASY';
  if (score <= 6) return 'INTERMEDIATE';
  return 'HARD';
}
