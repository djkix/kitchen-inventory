/**
 * Ce que le foyer possède, tel qu'il part au modèle (EF-26, décision du
 * propriétaire du 2026-11-24).
 *
 * Remplace la sélection de huit ingrédients (`pickSeedIngredients`, supprimée)
 * : le modèle ne pouvait rien dire d'utile sur un placard qu'il ne voyait pas
 * — ni « tu n'as pas d'ail frais, j'ai pris de l'ail semoule », ni « ta purée
 * de cacahuètes est au congélateur ».
 *
 * **Ni quantité, ni date**, et c'est une décision, pas un oubli : une recette
 * n'a pas besoin de savoir qu'il reste 250 g de farine plutôt que 2 kg, seule
 * la présence du produit compte ; et les dates de péremption n'interviennent
 * pas dans le module recettes (cahier des charges, section 12, amendement du
 * 2026-10-04).
 */
export interface HouseholdProduct {
  name: string;
  /** Emplacements où ce produit est rangé, triés et dédoublonnés par l'appelant. */
  locations: readonly string[];
}

/**
 * Une ligne par produit, « Nom (Emplacement, Emplacement) ». L'emplacement est
 * là pour que le modèle puisse prévenir d'une surprise — une purée de
 * cacahuètes au congélateur se sort avant de s'employer.
 */
export function formatHouseholdInventory(products: readonly HouseholdProduct[]): string {
  if (products.length === 0) return 'aucun';
  return products
    .map(({ name, locations }) => (locations.length > 0 ? `${name} (${locations.join(', ')})` : name))
    .join('\n');
}
