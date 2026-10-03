import { describe, expect, it } from 'vitest';
import { canRate, computeRecipeStats, type CookedLog } from './recipe-stats.js';

const today = new Date('2026-10-03T12:00:00');
const daysAgo = (n: number): Date => new Date(today.getTime() - n * 86_400_000);
const log = (id: string, n: number, stars: number[] = []): CookedLog => ({
  id, cookedAt: daysAgo(n), ratings: stars.map((s, i) => ({ userId: `u${i}`, stars: s })),
});

describe('computeRecipeStats', () => {
  it('rend une recette jamais faite', () => {
    expect(computeRecipeStats([], today)).toMatchObject({
      timesCooked: 0, lastCookedAt: null, averageRating: null, ratingCount: 0, recentTrend: null, tags: ['never'],
    });
  });
  it('moyenne toutes les notes de toutes les réalisations', () => {
    const stats = computeRecipeStats([log('a', 1, [4, 5]), log('b', 10, [3])], today);
    expect(stats).toMatchObject({ timesCooked: 2, averageRating: 4, ratingCount: 3 });
    expect(stats.lastCookedAt).toEqual(daysAgo(1));
  });
  it('arrondit la moyenne au dixième', () => {
    expect(computeRecipeStats([log('a', 1, [4, 5, 5])], today).averageRating).toBe(4.7);
  });
  it('étiquette valeur sûre au-delà de 4 sur au moins deux notes', () => {
    expect(computeRecipeStats([log('a', 1, [4, 5])], today).tags).toContain('trusted');
    expect(computeRecipeStats([log('a', 1, [5])], today).tags).not.toContain('trusted');
  });
  it('étiquette à oublier sous 2 sur au moins deux notes', () => {
    expect(computeRecipeStats([log('a', 1, [1, 2])], today).tags).toContain('disliked');
  });
  it('étiquette oubliée au-delà de soixante jours, seuil réglable', () => {
    expect(computeRecipeStats([log('a', 61)], today).tags).toContain('forgotten');
    expect(computeRecipeStats([log('a', 59)], today).tags).not.toContain('forgotten');
    expect(computeRecipeStats([log('a', 61)], today, 90).tags).not.toContain('forgotten');
  });
  it('ne calcule la tendance qu’à partir de quatre réalisations notées', () => {
    const three = [log('a', 1, [5]), log('b', 2, [5]), log('c', 3, [5])];
    expect(computeRecipeStats(three, today).recentTrend).toBeNull();
    expect(computeRecipeStats([...three, log('d', 4, [1])], today).recentTrend).toBe('up');
  });
  it('qualifie la tendance par l’écart de 0,5', () => {
    const baisse = [log('a', 1, [2]), log('b', 2, [2]), log('c', 3, [2]), log('d', 4, [5]), log('e', 5, [5])];
    expect(computeRecipeStats(baisse, today).recentTrend).toBe('down');
    const stable = [log('a', 1, [4]), log('b', 2, [4]), log('c', 3, [4]), log('d', 4, [4])];
    expect(computeRecipeStats(stable, today).recentTrend).toBe('stable');
  });
  it('ignore les réalisations sans note dans la tendance', () => {
    const logs = [log('a', 1, [5]), log('b', 2), log('c', 3, [5]), log('d', 4, [5]), log('e', 5, [1])];
    expect(computeRecipeStats(logs, today).recentTrend).toBe('up');
  });
});

describe('canRate', () => {
  it('ouvre la notation pendant sept jours (A25)', () => {
    expect(canRate({ cookedAt: daysAgo(0) }, today)).toBe(true);
    expect(canRate({ cookedAt: daysAgo(7) }, today)).toBe(true);
    expect(canRate({ cookedAt: daysAgo(8) }, today)).toBe(false);
  });
});
