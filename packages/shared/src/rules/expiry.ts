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

/** Minuit civil local du jour de `date` — point de départ de tout calcul en jour civil du paquet. */
export function startOfDay(date: Date): Date {
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

/** Les trois champs de `StockItem` que `expiryStatus` lit sur un lot. */
export interface ExpiryAwareLot {
  effectiveExpiry: Date | null;
  dateType: DateType | null;
  dateEstimated: boolean;
}

/**
 * Lot utilisable pour une recette (défaut 2, C4) : exclut seulement celui
 * dont la DLC est dépassée, jamais un article simplement « bientôt périmé ».
 * Règle unique, partagée par le calcul de couverture
 * (`RecipesCoverageService.snapshot()`, `apps/api`) et par la cuisson
 * (`recipes.cook.ts`) : un correctif apporté à un seul des deux appelants
 * ferait autrement diverger silencieusement la pastille d'emplacement
 * affichée (EF-23) de ce que la cuisson consomme réellement.
 */
export function isUsableForRecipes(lot: ExpiryAwareLot, today: Date, alertDays: number): boolean {
  return !excludedFromRecipes(expiryStatus(lot, today, alertDays));
}

/**
 * Ordre de consommation d'un stock, lot par lot au sein d'un même produit
 * (C4, défaut 2) : donnée pure, pas une requête — une liste de critères de
 * tri sur les colonnes `StockItem` (date effective croissante, une date
 * absente en dernier, puis date de dépôt croissante à égalité), que chaque
 * appelant Prisma passe telle quelle à `orderBy`. Partagée par les deux mêmes
 * fichiers que `isUsableForRecipes`, pour la même raison : le premier lot
 * rendu par cet ordre est celui qui sera consommé en premier, qu'il s'agisse
 * d'y lire l'emplacement à afficher ou d'y décrémenter réellement le stock.
 */
export const STOCK_CONSUMPTION_ORDER = [
  { effectiveExpiry: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
] as const;
