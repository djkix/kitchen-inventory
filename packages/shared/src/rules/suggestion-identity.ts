/**
 * Identité d'une suggestion dans une fournée (EF-26).
 *
 * Un rang dans le tableau (`"0"`, `"1"`…) ne désigne rien de stable : deux
 * fournées successives rangent des recettes différentes aux mêmes rangs. Avec
 * un rafraîchissement en arrière-plan (`refetchOnWindowFocus`) sur la seule
 * route payante du module, un tiroir resté ouvert pouvait opposer le rang d'une
 * fournée à l'identifiant d'une autre, et conserver une recette pour une autre.
 *
 * L'identité est donc dérivée du contenu : titre normalisé et URL source. Elle
 * vaut la même chose d'une fournée à l'autre, ce qui est exactement le sens
 * attendu — et rend par la même occasion le `clientOpId` de la conservation
 * (dérivé de cet identifiant) déterministe comme il l'était déjà.
 */

/** Hachage FNV-1a 32 bits, rendu en hexadécimal : déterministe, sans dépendance, identique côté serveur et navigateur. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Multiplication par le nombre premier FNV (16777619) en arithmétique 32 bits non signée.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Identifiant stable d'une suggestion, dérivé de son titre et de son URL source.
 * Deux suggestions au même titre et à la même source portent le même identifiant :
 * c'est voulu, ce sont la même recette.
 */
export function suggestionIdentity(recipe: { title: string; sourceUrl: string | null }): string {
  // Deux champs séparés par un caractère qui n'apparaît dans aucun des deux,
  // pour qu'un titre finissant par l'URL d'une autre ne puisse pas collisionner.
  const material = `${recipe.title.trim().toLowerCase()}\u0000${recipe.sourceUrl?.trim().toLowerCase() ?? ''}`;
  return fnv1a(material);
}
