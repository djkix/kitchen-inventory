import { normalizeProductName } from './duplicates.js';

/**
 * Ingrédients dictés à la main sur l'écran Suggestions (spécification du
 * 2026-10-19, EF-25, EF-26) : « j'ai des pommes de terre et un reste de
 * merguez ». Du texte libre, et non une sélection dans l'inventaire — un reste
 * n'est pas en stock, il ne se scanne pas.
 *
 * Les ingrédients imposés ont disparu le 2026-11-24 avec le champ à pastilles,
 * remplacé par une phrase en clair. Ce qui reste ici sert toujours : la
 * normalisation et le repli comparable portent le champ « déclaré » des
 * suggestions (D5 du 2026-10-19) et le rapprochement des lignes d'un ticket de
 * caisse. Règles pures, une seule implémentation.
 */


/**
 * Termes tels que saisis, découpés sur la virgule et débarrassés des vides.
 * Non normalisés : ce sont ces longueurs-là que les bornes de D7 mesurent, et
 * c'est cette saisie-là que le message d'erreur doit désigner.
 */
function splitIngredientTerms(raw: string): string[] {
  return raw
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

/**
 * Termes normalisés, dédoublonnés et **triés** (D3). Le tri n'est pas un
 * détail de présentation : sans lui, « merguez, pommes de terre » et « pommes
 * de terre, merguez » formeraient deux signatures d'orientation distinctes,
 * donc deux appels payants pour une seule et même question.
 */
export function normalizeIngredientTerms(raw: string): string[] {
  return [...new Set(splitIngredientTerms(raw).map(normalizeProductName).filter((term) => term.length > 0))].sort();
}

/**
 * Forme comparable d'un libellé ou d'un terme : normalisée, puis **tolérante
 * au nombre** — un `s` ou un `x` final est retiré de chaque mot d'au moins
 * quatre lettres (tour de correction 1 du 2026-10-19).
 *
 * Sans cela, « pomme de terre » ne trouvait pas « Pommes de terre nouvelles »,
 * ni « oeuf » « Œufs » : l'exemple littéral de la demande. Selon que le propriétaire
 * tapait au singulier ou au pluriel, il déclenchait un appel payant au lieu de
 * lire son réservoir, et voyait son propre ingrédient annoncé comme manquant.
 *
 * C'est une tolérance au nombre, **pas une lemmatisation** : « cheval » et
 * « chevaux » restent étrangers l'un à l'autre, « journal »/« journaux » aussi.
 * Le seuil de quatre lettres protège les mots courts dont le `s` ou le `x`
 * final fait partie du mot (« os », « ananas » garde son sens une fois les
 * deux côtés repliés de la même façon).
 */
export function foldForComparison(value: string): string {
  return (
    normalizeProductName(value)
      // Les ligatures survivent à la décomposition NFD de `normalizeProductName`
      // (elles ne sont pas des lettres accentuées) : « Œufs » resterait donc
      // étranger à « oeuf », tapé au clavier par tout le monde.
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .split(' ')
      .map((word) => (word.length > 3 ? word.replace(/[sx]$/, '') : word))
      .join(' ')
  );
}

/**
 * Mots trop courts ou trop vides de sens pour porter un rapprochement à eux
 * seuls : « de » apparaît dans un libellé sur deux.
 */
const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'au', 'aux', 'et', 'a', 'en', 'avec']);

/** Mots d'un terme qui portent réellement le sens, forme comparable. */
export function significantWords(term: string): string[] {
  return foldForComparison(term)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Un libellé d'ingrédient de recette porte-t-il l'un des termes dictés (D5, D8) ?
 * Inclusion du terme entier seulement : c'est la question « ce libellé-ci
 * est-il celui que le propriétaire a déclaré ? », qui se pose libellé par libellé.
 */
export function labelMatchesTerms(label: string, terms: readonly string[]): boolean {
  const folded = foldForComparison(label);
  return terms.some((term) => folded.includes(foldForComparison(term)));
}


