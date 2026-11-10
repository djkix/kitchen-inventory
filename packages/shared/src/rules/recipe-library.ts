/**
 * Ce qui fait qu'une recette figure dans « Mes recettes » (D1, 2026-11-09) :
 * on l'a saisie soi-même, on l'a étoilée, ou on l'a réalisée. Tout le reste
 * reste au réservoir des suggestions.
 *
 * La règle vit ici parce que deux endroits en dépendent et doivent dire la
 * même chose : le filtre de la bibliothèque, côté serveur, et l'avertissement
 * au retrait de l'étoile, côté écran. Recopiée, elle se mettrait à mentir dès
 * la première évolution de l'un des deux.
 */
export interface LibraryMembership {
  source: 'HOUSEHOLD' | 'IMPORTED' | 'GENERATED';
  favorite: boolean;
  timesCooked: number;
}

export function inLibrary(recipe: LibraryMembership): boolean {
  return recipe.source === 'HOUSEHOLD' || recipe.favorite || recipe.timesCooked > 0;
}

/**
 * Vrai quand retirer l'étoile ferait sortir la recette de la bibliothèque —
 * donc quand il faut prévenir avant, comme pour un effacement. Une recette
 * saisie au foyer ou déjà réalisée reste, elle : la prévenir serait un
 * mensonge, et un geste de plus pour rien.
 */
export function unfavoriteLeavesLibrary(recipe: LibraryMembership): boolean {
  return recipe.favorite && !inLibrary({ ...recipe, favorite: false });
}
