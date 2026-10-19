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

/** Un libellé d'ingrédient de recette porte-t-il l'un des termes dictés (D5, D8) ? */
export function labelMatchesTerms(label: string, terms: readonly string[]): boolean {
  const normalized = normalizeProductName(label);
  return terms.some((term) => normalized.includes(term));
}

/**
 * La recette utilise-t-elle **tous** les termes dictés (D1) ? Rapprochement
 * par inclusion sur les libellés normalisés (D8) : « pomme de terre » trouve
 * « pommes de terre nouvelles ». Volontairement généreux — un faux positif
 * coûte une recette un peu à côté, un faux négatif coûte un appel au modèle.
 */
export function recipeUsesAllTerms(labels: readonly string[], terms: readonly string[]): boolean {
  return terms.every((term) => labels.some((label) => normalizeProductName(label).includes(term)));
}
