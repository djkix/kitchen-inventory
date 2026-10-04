/**
 * Sélection des ingrédients qui amorcent la recherche de recettes par IA
 * (EF-26) : on ne peut pas envoyer tout le stock à Gemini, il faut choisir
 * un sous-ensemble de produits structurants, sans jamais changer de résultat
 * entre deux ouvertures le même jour.
 */
export interface SeedCandidate {
  productId: string;
  name: string;
  /** Chemin de catégorie, de la racine à la feuille, en minuscules sans accent. */
  categoryPath: readonly string[];
}

/** Catégories qui n'ont jamais à décrire un repas (B5). Comparées sur le chemin normalisé. */
export const NON_STRUCTURING_CATEGORIES: readonly string[] = ['epices', 'sel-et-poivre', 'herbes-aromatiques'];

export const SEED_MAX = 8;
export const SEED_STABLE = 5;

export function isStructuring(candidate: SeedCandidate): boolean {
  return !candidate.categoryPath.some((segment) => NON_STRUCTURING_CATEGORIES.includes(segment));
}

/** Numéro du jour, pour que la rotation ne dépende pas de l'heure. */
function dayIndex(today: Date): number {
  return Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86_400_000);
}

/**
 * Cinq places stables, trois tournantes (B4) : les suggestions se renouvellent
 * sans que le stock ait à bouger, tout en gardant un fond reconnaissable. La
 * rotation est fonction du jour et jamais de l'horloge, pour que deux ouvertures
 * le même jour donnent exactement la même fournée.
 */
export function pickSeedIngredients(candidates: readonly SeedCandidate[], today: Date): SeedCandidate[] {
  const eligible = candidates.filter(isStructuring);
  if (eligible.length <= SEED_MAX) return [...eligible];

  const stable = eligible.slice(0, SEED_STABLE);
  const pool = eligible.slice(SEED_STABLE);
  const rotating: SeedCandidate[] = [];
  const offset = dayIndex(today) % pool.length;
  for (let n = 0; n < SEED_MAX - SEED_STABLE; n++) {
    rotating.push(pool[(offset + n) % pool.length]!);
  }
  return [...stable, ...rotating];
}
