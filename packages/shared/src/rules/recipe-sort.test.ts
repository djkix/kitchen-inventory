import { describe, expect, it } from 'vitest';
import { RECIPE_SORTS, sortRecipes, type SortableRecipe } from './recipe-sort.js';

const r = (title: string, over: Partial<SortableRecipe> = {}): SortableRecipe => ({
  title, coverage: 0.5, bonus: 0, averageRating: null, ratingCount: 0, timesCooked: 0, lastCookedAt: null, ...over,
});
const titles = (list: SortableRecipe[]): string[] => list.map((x) => x.title);

describe('sortRecipes', () => {
  it('par note : notées d’abord, moyenne puis nombre d’avis, puis titre', () => {
    const list = [
      r('Jamais notée'),
      r('Bonne sur un avis', { averageRating: 5, ratingCount: 1 }),
      r('Bonne sur dix avis', { averageRating: 5, ratingCount: 10 }),
      r('Moyenne', { averageRating: 3, ratingCount: 4 }),
    ];
    expect(titles(sortRecipes(list, 'rating'))).toEqual(['Bonne sur dix avis', 'Bonne sur un avis', 'Moyenne', 'Jamais notée']);
  });
  it('départage par le titre, accents compris', () => {
    expect(titles(sortRecipes([r('Éclair'), r('Dessert')], 'rating'))).toEqual(['Dessert', 'Éclair']);
  });
  it('par couverture, puis note, puis titre', () => {
    const list = [r('A', { coverage: 0.5 }), r('B', { coverage: 1 }), r('C', { coverage: 1, averageRating: 5, ratingCount: 1 })];
    expect(titles(sortRecipes(list, 'coverage'))).toEqual(['C', 'B', 'A']);
  });
  it('par anti-gaspillage, puis couverture, puis titre', () => {
    const list = [r('A', { bonus: 0, coverage: 1 }), r('B', { bonus: 2 }), r('C', { bonus: 2, coverage: 0.9 })];
    expect(titles(sortRecipes(list, 'antiWaste'))).toEqual(['C', 'B', 'A']);
  });
  it('par nombre de réalisations', () => {
    expect(titles(sortRecipes([r('A'), r('B', { timesCooked: 3 })], 'mostCooked'))).toEqual(['B', 'A']);
  });
  it('par ancienneté, jamais faites en premier', () => {
    const list = [
      r('Hier', { lastCookedAt: new Date('2026-10-02') }),
      r('Jamais'),
      r('L’an dernier', { lastCookedAt: new Date('2025-10-02') }),
    ];
    expect(titles(sortRecipes(list, 'leastRecent'))).toEqual(['Jamais', 'L’an dernier', 'Hier']);
  });
  it('est stable : deux égales gardent leur ordre d’entrée', () => {
    const list = [r('Même'), r('Même')];
    expect(sortRecipes(list, 'rating')[0]).toBe(list[0]);
  });
  it('ne modifie pas le tableau reçu', () => {
    const list = [r('B'), r('A')];
    sortRecipes(list, 'rating');
    expect(titles(list)).toEqual(['B', 'A']);
  });

  it.each(RECIPE_SORTS)('est stable et ne modifie pas le tableau reçu (%s)', (sort) => {
    const list = [r('Même'), r('Même')];
    const sorted = sortRecipes(list, sort);
    expect(sorted[0]).toBe(list[0]);
    expect(sorted[1]).toBe(list[1]);
    expect(titles(list)).toEqual(['Même', 'Même']);
  });
});
