import { describe, expect, it } from 'vitest';
import { roundQuantity } from '../units.js';
import { scaleIngredients, servingsRatio } from './servings.js';

describe('servingsRatio', () => {
  it('rend 1 pour un nombre de parts inchangé', () => {
    expect(servingsRatio(4, 4)).toBe(1);
  });

  it('double pour deux fois plus de convives', () => {
    expect(servingsRatio(8, 4)).toBe(2);
  });

  it('refuse une base nulle plutôt que de rendre l’infini', () => {
    expect(servingsRatio(4, 0)).toBe(1);
  });

  it('borne aux parts acceptées par le schéma', () => {
    expect(servingsRatio(0, 4)).toBe(servingsRatio(1, 4));
    expect(servingsRatio(99, 4)).toBe(servingsRatio(50, 4));
  });
});

describe('scaleIngredients', () => {
  it('laisse une quantité absente absente : « une pincée » ne se multiplie pas', () => {
    expect(scaleIngredients([{ quantity: null }], 2)[0]!.quantity).toBeNull();
  });

  it('arrondit comme le reste de l’application', () => {
    // Même arrondi que `roundQuantity`, pour qu'une quantité ne s'affiche pas
    // différemment selon l'écran qui l'a calculée.
    expect(scaleIngredients([{ quantity: 1 }], 1 / 3)[0]!.quantity).toBe(roundQuantity(1 / 3));
  });
});
