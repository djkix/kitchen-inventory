import { describe, expect, it } from 'vitest';
import { capConsumption } from './consumption.js';

describe('capConsumption', () => {
  it('consomme la quantité demandée quand elle est disponible', () => {
    expect(capConsumption(3, 1)).toEqual({ delta: -1, capped: false });
  });
  it('ramène au stock disponible quand la demande dépasse', () => {
    expect(capConsumption(0.4, 1)).toEqual({ delta: -0.4, capped: true });
  });
  it('consomme tout exactement sans plafonnement', () => {
    expect(capConsumption(2, 2)).toEqual({ delta: -2, capped: false });
  });
  it('refuse une quantité nulle ou négative', () => {
    expect(() => capConsumption(2, 0)).toThrow('La quantité doit être positive');
    expect(() => capConsumption(2, -1)).toThrow(RangeError);
  });
  it('ne fait rien sur un stock déjà vide', () => {
    expect(capConsumption(0, 1)).toEqual({ delta: 0, capped: true });
  });
});
