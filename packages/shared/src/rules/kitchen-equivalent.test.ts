import { describe, expect, it } from 'vitest';
import { kitchenEquivalent } from './kitchen-equivalent.js';

describe('kitchenEquivalent', () => {
  it.each(['PIECE', 'PACK', 'BOX', 'SACHET'] as const)('ne convertit pas %s', (unit) => {
    expect(kitchenEquivalent(3, unit)).toBeNull();
  });

  it('convertit un volume en cuillères à soupe', () => {
    expect(kitchenEquivalent(45, 'MILLILITER')).toEqual({ spoons: 3, spoon: 'tablespoon' });
  });

  it('convertit une masse avec les mêmes équivalences', () => {
    expect(kitchenEquivalent(30, 'GRAM')).toEqual({ spoons: 2, spoon: 'tablespoon' });
  });

  it('ramène les grandes unités à leur base', () => {
    expect(kitchenEquivalent(0.06, 'LITER')).toEqual({ spoons: 4, spoon: 'tablespoon' });
    expect(kitchenEquivalent(0.03, 'KILOGRAM')).toEqual({ spoons: 2, spoon: 'tablespoon' });
  });

  it('bascule sur la cuillère à café en dessous de 15', () => {
    expect(kitchenEquivalent(14, 'GRAM')).toEqual({ spoons: 3, spoon: 'teaspoon' });
    expect(kitchenEquivalent(15, 'GRAM')).toEqual({ spoons: 1, spoon: 'tablespoon' });
  });

  it('ne rend rien sous une demi-cuillère à café', () => {
    expect(kitchenEquivalent(2.4, 'MILLILITER')).toBeNull();
    expect(kitchenEquivalent(2.5, 'MILLILITER')).toEqual({ spoons: 0.5, spoon: 'teaspoon' });
  });

  it('ne rend rien au-delà de huit cuillères à soupe', () => {
    expect(kitchenEquivalent(120, 'GRAM')).toEqual({ spoons: 8, spoon: 'tablespoon' });
    expect(kitchenEquivalent(121, 'GRAM')).toBeNull();
  });

  it('arrondit au demi', () => {
    expect(kitchenEquivalent(20, 'MILLILITER')).toEqual({ spoons: 1.5, spoon: 'tablespoon' });
  });

  it('ignore une quantité nulle ou négative', () => {
    expect(kitchenEquivalent(0, 'GRAM')).toBeNull();
    expect(kitchenEquivalent(-10, 'GRAM')).toBeNull();
  });
});
