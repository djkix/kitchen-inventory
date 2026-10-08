/**
 * Détermine la note affichée pour une recette : la note directe prime, sinon
 * la moyenne des réalisations, sinon rien. Jamais d'étoiles vides.
 *
 * Garantit une seule règle partagée entre la carte, la fiche et le tri,
 * pour que ces trois vues restent synchrones (D3, A5).
 */
export function effectiveRating(
  direct: number | null,
  averageFromLogs: number | null,
): { value: number | null; source: 'direct' | 'cooked' | null } {
  if (direct !== null) {
    return { value: direct, source: 'direct' };
  }
  if (averageFromLogs !== null) {
    return { value: averageFromLogs, source: 'cooked' };
  }
  return { value: null, source: null };
}
