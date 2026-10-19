import { normalizeProductName } from './duplicates.js';

/**
 * Ingrédients dictés à la main sur l'écran Suggestions (spécification du
 * 2026-10-19, EF-25, EF-26) : « j'ai des pommes de terre et un reste de
 * merguez ». Du texte libre, et non une sélection dans l'inventaire — un reste
 * n'est pas en stock, il ne se scanne pas.
 *
 * Tout est ici, en règles pures : le découpage, la normalisation et le
 * rapprochement au réservoir. Le serveur les applique à la signature, au filtre
 * du réservoir et au DTO ; l'écran réutilise le schéma Zod qui s'appuie
 * dessus. Jamais deux implémentations.
 */

/** Cinq ingrédients au plus (D7) : bornent la signature, la taille du prompt et le coût du rapprochement. */
export const SUGGESTION_INGREDIENTS_MAX = 5;
/** Trente caractères par ingrédient (D7) : un ingrédient, pas une phrase. */
export const SUGGESTION_INGREDIENT_LENGTH_MAX = 30;

/**
 * Termes tels que saisis, découpés sur la virgule et débarrassés des vides.
 * Non normalisés : ce sont ces longueurs-là que les bornes de D7 mesurent, et
 * c'est cette saisie-là que le message d'erreur doit désigner.
 */
export function splitIngredientTerms(raw: string): string[] {
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
 * ni « oeuf » « Œufs » : l'exemple littéral de la demande. Selon que djkix
 * tapait au singulier ou au pluriel, il déclenchait un appel payant au lieu de
 * lire son réservoir, et voyait son propre ingrédient annoncé comme manquant.
 *
 * C'est une tolérance au nombre, **pas une lemmatisation** : « cheval » et
 * « chevaux » restent étrangers l'un à l'autre, « journal »/« journaux » aussi.
 * Le seuil de quatre lettres protège les mots courts dont le `s` ou le `x`
 * final fait partie du mot (« os », « ananas » garde son sens une fois les
 * deux côtés repliés de la même façon).
 */
function foldForComparison(value: string): string {
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

/** Un libellé d'ingrédient de recette porte-t-il l'un des termes dictés (D5, D8) ? */
export function labelMatchesTerms(label: string, terms: readonly string[]): boolean {
  const folded = foldForComparison(label);
  return terms.some((term) => folded.includes(foldForComparison(term)));
}

/**
 * La recette utilise-t-elle **tous** les termes dictés (D1) ? Rapprochement
 * par inclusion sur les libellés normalisés (D8) : « pomme de terre » trouve
 * « pommes de terre nouvelles ». Volontairement généreux — un faux positif
 * coûte une recette un peu à côté, un faux négatif coûte un appel au modèle.
 */
export function recipeUsesAllTerms(labels: readonly string[], terms: readonly string[]): boolean {
  // Le test d'inclusion n'existe qu'en un seul endroit (`labelMatchesTerms`) :
  // le recopier ici ferait diverger les deux lectures de D5 et D8.
  return terms.every((term) => labels.some((label) => labelMatchesTerms(label, [term])));
}
