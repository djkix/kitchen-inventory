/**
 * Règles de dates de la section 15.
 *
 * Toutes les comparaisons se font au jour civil, dans le fuseau du processus
 * (celui de l'instance, variable TZ) : une DLC « au 20 » reste valable toute
 * la journée du 20.
 */
export type DateType = 'USE_BY' | 'BEST_BEFORE';
export type ExpiryStatus = 'none' | 'ok' | 'soon' | 'expired_use_by' | 'expired_best_before';

const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

/** Nombre de jours civils entre aujourd'hui et la date (négatif si passée). */
export function daysUntil(date: Date, today: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / DAY_MS);
}

/**
 * Date effective = min(DLC, date d'ouverture + durée après ouverture).
 * Sans DLC ni ouverture, il n'y a pas de date effective.
 */
export function computeEffectiveExpiry(input: {
  expiryDate: Date | null;
  openedAt: Date | null;
  afterOpeningDays: number | null;
}): Date | null {
  const candidates: Date[] = [];
  if (input.expiryDate) candidates.push(input.expiryDate);
  if (input.openedAt && input.afterOpeningDays !== null) candidates.push(addDays(input.openedAt, input.afterOpeningDays));
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d.getTime() < min.getTime() ? d : min));
}

/** Décision 6 : DLC estimée d'un périssable non emballé = saisie + conservation indicative. */
export function estimateExpiry(from: Date, shelfLifeDays: number): Date {
  return addDays(from, shelfLifeDays);
}

export function expiryStatus(
  item: { effectiveExpiry: Date | null; dateType: DateType | null; dateEstimated: boolean },
  today: Date,
  alertDays: number,
): ExpiryStatus {
  if (!item.effectiveExpiry) return 'none';
  const days = daysUntil(item.effectiveExpiry, today);
  if (days < 0) {
    // Une date estimée ne sert qu'à classer, jamais à exclure.
    if (item.dateEstimated) return 'soon';
    return item.dateType === 'BEST_BEFORE' ? 'expired_best_before' : 'expired_use_by';
  }
  return days <= alertDays ? 'soon' : 'ok';
}

/** Seule la DLC dépassée exclut un article des suggestions de recettes. */
export function excludedFromRecipes(status: ExpiryStatus): boolean {
  return status === 'expired_use_by';
}
