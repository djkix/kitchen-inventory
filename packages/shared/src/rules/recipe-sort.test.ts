import { describe, expect, it } from 'vitest';
import { RECIPE_SORTS, sortRecipes, type SortableRecipe } from './recipe-sort.js';

const r = (title: string, over: Partial<SortableRecipe> = {}): SortableRecipe => ({
  title, coverage: 0.5, rating: null, averageRating: null, ratingCount: 0, timesCooked: 0, lastCookedAt: null, ...over,
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
  it('par note : directe et par réalisations se classent sur la même échelle (A5)', () => {
    const list = [
      r('Notée par réalisations à 4', { averageRating: 4, ratingCount: 3 }),
      r('Notée directement à 5', { rating: 5 }),
      r('Notée directement à 3', { rating: 3 }),
      r('Jamais notée'),
    ];
    expect(titles(sortRecipes(list, 'rating'))).toEqual([
      'Notée directement à 5',
      'Notée par réalisations à 4',
      'Notée directement à 3',
      'Jamais notée',
    ]);
  });
  it('la note directe prime sur la moyenne des réalisations pour une même recette', () => {
    const list = [r('Avec les deux', { rating: 2, averageRating: 5, ratingCount: 10 }), r('Sans note', { averageRating: 3, ratingCount: 1 })];
    // La note directe (2) prime : la recette se classe moins bien que celle à 3 malgré une moyenne de réalisations à 5.
    expect(titles(sortRecipes(list, 'rating'))).toEqual(['Sans note', 'Avec les deux']);
  });
  it('départage par le titre, accents compris', () => {
    expect(titles(sortRecipes([r('Éclair'), r('Dessert')], 'rating'))).toEqual(['Dessert', 'Éclair']);
  });
  it('par couverture, puis note, puis titre', () => {
    const list = [r('A', { coverage: 0.5 }), r('B', { coverage: 1 }), r('C', { coverage: 1, averageRating: 5, ratingCount: 1 })];
    expect(titles(sortRecipes(list, 'coverage'))).toEqual(['C', 'B', 'A']);
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
