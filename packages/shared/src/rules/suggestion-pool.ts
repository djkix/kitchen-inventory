/**
 * Ordre d'affichage du réservoir de suggestions (EF-26, décision D7 du
 * 2026-10-15).
 *
 * Une recette web vérifiée passe avant une composition du modèle quelle que
 * soit sa couverture : la demande de Franck porte d'abord sur l'existence de
 * la recette, la couverture ne départage qu'à statut égal. Puis, à couverture
 * égale, la plus récemment découverte — sans quoi le réservoir, qui ne
 * s'efface jamais, figerait pour toujours le haut de la liste sur ses plus
 * vieilles entrées.
 */
export interface PoolEntryForSort {
  /** Page source lue avec succès à l'ingestion ; faux pour une composition du modèle. */
  verified: boolean;
  /** Couverture calculée contre le stock du moment, entre 0 et 1. */
  coverage: number;
  /** Date ISO de première apparition dans le réservoir. */
  firstSeenAt: string;
}

export function comparePoolEntries(a: PoolEntryForSort, b: PoolEntryForSort): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  return b.firstSeenAt.localeCompare(a.firstSeenAt);
}
