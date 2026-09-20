import { describe, expect, it } from 'vitest';
import { sumMovements } from './quantity.js';

describe('sumMovements', () => {
  it('somme les deltas avec arrondi', () => {
    expect(sumMovements([1, 1, -0.4])).toBe(1.6);
    expect(sumMovements([0.1, 0.2])).toBe(0.3);
  });
  it('ne descend jamais sous zéro', () => {
    expect(sumMovements([1, -2])).toBe(0);
  });
  it('vaut zéro sans mouvement', () => {
    expect(sumMovements([])).toBe(0);
  });
});
