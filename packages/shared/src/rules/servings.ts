import { roundQuantity } from '../units.js';

/** Parts acceptées par le schéma (`createRecipeSchema`, `cookRecipeSchema`, section 15). */
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 50;

function clampServings(servings: number): number {
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, servings));
}

/**
 * Ratio de mise à l'échelle entre le nombre de parts demandé et celui de la
 * recette (F2). Borné aux parts acceptées par le schéma (1 à 50) : un
 * appelant qui transmettrait une valeur hors bornes (ou que le modèle
 * n'arrondirait pas, EF-26) obtient le même ratio qu'aux bornes elles-mêmes,
 * plutôt qu'un résultat absurde. Une base nulle ou négative — recette mal
 * formée, jamais censée arriver — rend 1 plutôt que l'infini ou `NaN`.
 */
export function servingsRatio(target: number, base: number): number {
  if (base <= 0) return 1;
  return clampServings(target) / clampServings(base);
}

/**
 * Quantités à l'échelle (F2) : `null` reste `null`, « une pincée » ne se
 * multiplie jamais. Même arrondi que le reste de l'application
 * (`roundQuantity`), pour qu'une quantité ne s'affiche pas différemment selon
 * l'écran qui l'a calculée — c'est pourquoi aucun arrondi n'est réécrit ici.
 */
export function scaleIngredients<T extends { quantity: number | null }>(ingredients: readonly T[], ratio: number): T[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: ingredient.quantity === null ? null : roundQuantity(ingredient.quantity * ratio),
  }));
}
