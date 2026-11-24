import { describe, expect, it } from 'vitest';
import { formatKitchenEquivalent, formatQuantityWithEquivalent } from './kitchen-equivalent-ui';

describe('formatKitchenEquivalent', () => {
  it('écrit le libellé en français', () => {
    expect(formatKitchenEquivalent(45, 'MILLILITER')).toBe('3 c. à soupe');
    expect(formatKitchenEquivalent(20, 'MILLILITER')).toBe('1,5 c. à soupe');
    expect(formatKitchenEquivalent(10, 'GRAM')).toBe('2 c. à café');
  });

  it('ne rend rien quand il n’y a rien à dire', () => {
    expect(formatKitchenEquivalent(2, 'PIECE')).toBeNull();
    expect(formatKitchenEquivalent(250, 'GRAM')).toBeNull();
  });
});

describe('formatQuantityWithEquivalent', () => {
  it('garde les deux mesures côte à côte', () => {
    expect(formatQuantityWithEquivalent(45, 'MILLILITER')).toBe('45 ml (3 c. à soupe)');
  });

  it('n’affiche que la mesure exacte quand il n’y a pas d’équivalent', () => {
    expect(formatQuantityWithEquivalent(250, 'GRAM')).toBe('250 g');
    expect(formatQuantityWithEquivalent(2, 'PIECE')).toBe('2 pièces');
  });
});
