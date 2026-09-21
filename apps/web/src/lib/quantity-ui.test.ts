import { describe, expect, it } from 'vitest';
import { consumeStep, formatQuantity, unitStep } from './quantity-ui';

describe('quantity-ui', () => {
  it('formate la quantité avec le libellé français de l’unité', () => {
    expect(formatQuantity(1, 'PIECE')).toBe('1 pièce');
    expect(formatQuantity(3, 'PIECE')).toBe('3 pièces');
    expect(formatQuantity(0.4, 'LITER')).toBe('0,4 l');
    expect(formatQuantity(250, 'GRAM')).toBe('250 g');
  });

  it('plafonne le pas au stock disponible', () => {
    expect(consumeStep('PIECE', 5)).toBe(1);
    expect(consumeStep('GRAM', 500)).toBe(100);
    expect(consumeStep('GRAM', 40)).toBe(40);
    expect(consumeStep('LITER', 0.05)).toBe(0.05);
  });
});

describe('unitStep', () => {
  it('donne un pas naturel par famille d’unité', () => {
    expect(unitStep('PIECE')).toBe(1);
    expect(unitStep('GRAM')).toBe(100);
    expect(unitStep('MILLILITER')).toBe(100);
    expect(unitStep('KILOGRAM')).toBe(0.1);
    expect(unitStep('LITER')).toBe(0.1);
  });
});
