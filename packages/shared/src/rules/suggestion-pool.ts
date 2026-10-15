/**
 * Ordre d'affichage du réservoir de suggestions (EF-26, décision D7 du
 * 2026-10-15).
 *
 * Une recette web vérifiée passe avant une composition du modèle quelle que
 * soit sa couverture : la demande de djkix porte d'abord sur l'existence de
 * la recette, la couverture ne départage qu'à statut égal. Puis, à couverture
 * égale, la plus récemment découverte — sans quoi le réservoir, qui ne
 * s'efface jamais, figerait pour toujours le haut de la liste sur ses plus
 * vieilles entrées.
 *
 * Une fournée entière partageant son instant de découverte, les trois premiers
 * critères laissent régulièrement des égalités : le titre puis l'identité les
 * départagent, pour que l'ordre soit **total** et reproductible d'un affichage
 * à l'autre (revue de la tâche 4, 2026-10-15). Le titre vient avant l'identité
 * parce qu'un ordre de hachages FNV-1a ne se lit pas ; l'identité reste
 * nécessaire derrière, deux recettes web pouvant porter le même titre sous des
 * URL différentes.
 */
export interface PoolEntryForSort {
  /** Page source lue avec succès à l'ingestion ; faux pour une composition du modèle. */
  verified: boolean;
  /** Couverture calculée contre le stock du moment, entre 0 et 1. */
  coverage: number;
  /** Date ISO de première apparition dans le réservoir. */
  firstSeenAt: string;
  /** Titre de la recette : départage lisible de deux entrées par ailleurs équivalentes. */
  title: string;
  /** Clé unique de la ligne du réservoir (`suggestionIdentity`) : dernier recours, toujours décisif. */
  identity: string;
}

export function comparePoolEntries(a: PoolEntryForSort, b: PoolEntryForSort): number {
  if (a.verified !== b.verified) return a.verified ? -1 : 1;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  // Comparaison sur l'instant, pas sur la chaîne (revue du 2026-10-15) : deux
  // dates ISO du même instant peuvent s'écrire différemment (« +02:00 » contre
  // « Z », millisecondes présentes ou non), et un tri lexicographique les
  // départagerait alors au hasard. Une date illisible rend `NaN` : le `|| 0`
  // la traite comme une égalité plutôt que de propager un `NaN` qui ferait
  // perdre à l'ordre sa transitivité, et donc à `Array.sort` tout sens.
  const byDate = Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) || 0;
  if (byDate !== 0) return byDate;
  // Locale explicite : sans elle, l'ordre dépendrait de celle de l'hôte, et
  // l'ordre figé d'un test cesserait d'être une propriété du code.
  const byTitle = a.title.localeCompare(b.title, 'fr');
  if (byTitle !== 0) return byTitle;
  return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
}
