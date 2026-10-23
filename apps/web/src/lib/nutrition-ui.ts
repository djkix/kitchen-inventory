import type { NutrientLevels, NutriscoreGrade } from '@kitchen/shared';

/**
 * Habillage des repères nutritionnels d'Open Food Facts (EF-30). Aucun calcul :
 * la lettre et les niveaux viennent tels quels de l'API.
 *
 * Les cinq couleurs sont celles du Nutri-Score officiel, inchangées parce
 * qu'elles font la lisibilité du badge. Elles sortent donc de la palette du
 * thème, qui réserve rouge, orange et ambre à la péremption (`styles.css`) :
 * c'est pour cela que le bloc tient en une ligne et n'affiche pas l'échelle
 * complète — un D orange ne doit jamais se lire comme une alerte de date.
 */
const GRADE_COLORS: Record<NutriscoreGrade, string> = {
  a: '#038141',
  b: '#85bb2f',
  c: '#fecb02',
  d: '#ee8100',
  e: '#e63e11',
};

/** Texte posé sur la pastille : les deux jaunes demandent un texte sombre. */
const GRADE_INK: Record<NutriscoreGrade, string> = {
  a: '#ffffff',
  b: '#1b2a06',
  c: '#412402',
  d: '#412402',
  e: '#ffffff',
};

export function gradeColors(grade: NutriscoreGrade): { background: string; color: string } {
  return { background: GRADE_COLORS[grade], color: GRADE_INK[grade] };
}

const NUTRIENT_LABELS: Record<keyof NutrientLevels, string> = {
  salt: 'sel',
  sugars: 'sucres',
  'saturated-fat': 'graisses saturées',
  fat: 'graisses',
};

/** Ordre d'affichage : le plus parlant d'abord, indépendant de l'ordre d'OFF. */
const NUTRIENT_ORDER = Object.keys(NUTRIENT_LABELS) as Array<keyof NutrientLevels>;

/**
 * Résume les quatre niveaux en une ligne : ce qui est élevé d'abord, à défaut
 * ce qui est modéré, et le silence quand tout est faible — un produit sain n'a
 * rien à signaler. La forme « élevé : sel, sucres » évite les accords, qui
 * tomberaient faux dès qu'on mélange les genres (« sel » et « graisses »).
 */
export function nutrientSentence(levels: NutrientLevels | null): string | null {
  if (!levels) return null;
  const named = (want: 'high' | 'moderate') => NUTRIENT_ORDER.filter((key) => levels[key] === want).map((key) => NUTRIENT_LABELS[key]);
  const high = named('high');
  if (high.length > 0) return `élevé : ${high.join(', ')}`;
  const moderate = named('moderate');
  if (moderate.length > 0) return `modéré : ${moderate.join(', ')}`;
  return 'rien d’élevé';
}
