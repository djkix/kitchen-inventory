import { daysUntil } from './expiry.js';

/** Fenêtre pendant laquelle une réalisation reste notable (A25). */
export const RATING_WINDOW_DAYS = 7;
/** Au-delà, une recette est « pas faite depuis longtemps ». Réglable par Setting. */
export const FORGOTTEN_AFTER_DAYS = 60;
/** Écart minimal pour qualifier une tendance. */
const TREND_DELTA = 0.5;
/** Nombre de réalisations notées sous lequel la tendance n'a pas de sens. */
const TREND_MIN_LOGS = 4;

export type RecipeTag = 'trusted' | 'disliked' | 'never' | 'forgotten';
export type RecentTrend = 'up' | 'stable' | 'down';

export interface CookedLog {
  id: string;
  cookedAt: Date;
  ratings: readonly { userId: string; stars: number }[];
}

export interface RecipeStats {
  timesCooked: number;
  lastCookedAt: Date | null;
  averageRating: number | null;
  ratingCount: number;
  recentTrend: RecentTrend | null;
  tags: RecipeTag[];
}

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
const round1 = (value: number): number => Math.round(value * 10) / 10;
/** Jours écoulés depuis une date passée. */
const daysSince = (date: Date, today: Date): number => -daysUntil(date, today);

export function computeRecipeStats(
  logs: readonly CookedLog[],
  today: Date,
  forgottenAfterDays = FORGOTTEN_AFTER_DAYS,
): RecipeStats {
  const sorted = [...logs].sort((a, b) => b.cookedAt.getTime() - a.cookedAt.getTime());
  const allStars = sorted.flatMap((log) => log.ratings.map((rating) => rating.stars));
  const averageRating = allStars.length > 0 ? round1(mean(allStars)) : null;

  const rated = sorted.filter((log) => log.ratings.length > 0);
  let recentTrend: RecentTrend | null = null;
  if (rated.length >= TREND_MIN_LOGS && averageRating !== null) {
    const recent = mean(rated.slice(0, 3).flatMap((log) => log.ratings.map((r) => r.stars)));
    const delta = recent - averageRating;
    recentTrend = delta >= TREND_DELTA ? 'up' : delta <= -TREND_DELTA ? 'down' : 'stable';
  }

  const lastCookedAt = sorted[0]?.cookedAt ?? null;
  const tags: RecipeTag[] = [];
  if (averageRating !== null && allStars.length >= 2 && averageRating >= 4) tags.push('trusted');
  if (averageRating !== null && allStars.length >= 2 && averageRating <= 2) tags.push('disliked');
  if (lastCookedAt === null) tags.push('never');
  else if (daysSince(lastCookedAt, today) > forgottenAfterDays) tags.push('forgotten');

  return { timesCooked: sorted.length, lastCookedAt, averageRating, ratingCount: allStars.length, recentTrend, tags };
}

export function canRate(log: { cookedAt: Date }, today: Date): boolean {
  return daysSince(log.cookedAt, today) <= RATING_WINDOW_DAYS;
}
