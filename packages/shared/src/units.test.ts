import { describe, expect, it } from 'vitest';
import { IncompatibleUnitsError, convertQuantity, roundQuantity, sameFamily, UNIT_LABELS_FR, UNITS } from './units.js';

describe('convertQuantity', () => {
  it('convertit g → kg', () => {
    expect(convertQuantity(1500, 'GRAM', 'KILOGRAM')).toBe(1.5);
  });
  it('convertit l → ml', () => {
    expect(convertQuantity(0.4, 'LITER', 'MILLILITER')).toBe(400);
  });
  it('laisse une quantité inchangée dans la même unité', () => {
    expect(convertQuantity(2, 'PIECE', 'PIECE')).toBe(2);
  });
  it('refuse masse → volume avec un message français', () => {
    expect(() => convertQuantity(1, 'GRAM', 'LITER')).toThrow(IncompatibleUnitsError);
    expect(() => convertQuantity(1, 'GRAM', 'LITER')).toThrow('Unités incompatibles : g et l');
  });
  it('refuse pièce → paquet', () => {
    expect(() => convertQuantity(1, 'PIECE', 'PACK')).toThrow(IncompatibleUnitsError);
  });
  it('arrondit à deux décimales', () => {
    expect(convertQuantity(1, 'GRAM', 'KILOGRAM')).toBe(0);
    expect(convertQuantity(5, 'GRAM', 'KILOGRAM')).toBe(0.01);
  });
});

describe('sameFamily', () => {
  it('reconnaît les familles', () => {
    expect(sameFamily('GRAM', 'KILOGRAM')).toBe(true);
    expect(sameFamily('MILLILITER', 'LITER')).toBe(true);
    expect(sameFamily('GRAM', 'MILLILITER')).toBe(false);
    expect(sameFamily('PACK', 'BOX')).toBe(false);
  });
});

describe('roundQuantity', () => {
  it('arrondit à deux décimales sans -0', () => {
    expect(roundQuantity(1.005)).toBe(1.01);
    expect(roundQuantity(-0)).toBe(0);
    expect(Object.is(roundQuantity(-0.001), 0)).toBe(true);
  });
});

describe('libellés', () => {
  it('a un libellé français pour chaque unité', () => {
    for (const unit of UNITS) {
      expect(UNIT_LABELS_FR[unit].length).toBeGreaterThan(0);
    }
  });
});
