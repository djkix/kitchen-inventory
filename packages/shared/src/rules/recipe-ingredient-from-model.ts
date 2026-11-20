import type { Unit } from '../units.js';

/** Ce que le modèle rend pour un ingrédient : la quantité et l'unité sont facultatives, chacune de son côté. */
export interface ModelIngredientLike {
  label: string;
  quantity: number | null;
  unit: Unit | null;
}

/** Ce qu'une recette accepte : quantité et unité vont ensemble, ou ni l'une ni l'autre. */
export interface RecipeIngredientQuantity {
  quantity: number | null;
  unit: Unit | null;
}

/**
 * Accorde un ingrédient rendu par le modèle avec ce qu'une recette accepte
 * (2026-11-20).
 *
 * Deux schémas se contredisaient sans que personne les ait comparés :
 *
 * - `modelRecipeIngredientSchema` (suggestions) autorise une quantité **sans**
 *   unité. C'est voulu depuis le 2026-11-14 : « 2 œufs » est une quantité
 *   parfaitement claire, et la perdre appauvrissait la recette ;
 * - `recipeIngredientInputSchema` (recettes) l'**interdit** : « une quantité
 *   exige une unité », règle du formulaire de saisie, où l'utilisateur choisit
 *   toujours dans une liste.
 *
 * Tant que le modèle écrivait des recettes de trois ingrédients tirés du
 * stock scanné, il rendait surtout des grammes et des millilitres, et la
 * contradiction dormait. La consigne du 2026-11-20 l'a réveillée : elle
 * autorise le placard de base, dont tout est compté à l'unité — « 2 gousses
 * d'ail », « 1 oignon », « 3 œufs ». Relevé en service le jour même, quatre
 * recettes sur quatre refusées à l'entrée dans « Mes recettes » :
 * `Une quantité exige une unité`, sur les ingrédients 6 et 7, c'est-à-dire
 * précisément ceux que la nouvelle consigne a fait apparaître.
 *
 * Un nombre nu désigne des objets entiers : c'est la définition de `PIECE`,
 * déjà l'unité des produits comptés à la pièce (`COUNTABLE_UNITS`). On la pose
 * donc, plutôt que de jeter la quantité — « Oignon » sans son « 1 » n'aide
 * personne à cuisiner — et plutôt que de relâcher la règle du formulaire, qui
 * est juste là où elle s'applique.
 *
 * Une unité sans quantité est l'erreur symétrique, interdite elle aussi par le
 * schéma des recettes : elle ne dit rien (« des grammes de farine ») et part.
 */
export function recipeIngredientFromModel(ingredient: ModelIngredientLike): RecipeIngredientQuantity {
  const quantity = ingredient.quantity ?? null;
  const unit = ingredient.unit ?? null;
  if (quantity === null) return { quantity: null, unit: null };
  return { quantity, unit: unit ?? 'PIECE' };
}
