import { describe, expect, it } from 'vitest';
import { createStockItemSchema, paginationQuerySchema, scanBarcodeSchema, setupSchema, visionSuggestionSchema } from './index.js';

describe('scanBarcodeSchema', () => {
  it('accepte un EAN-13 et un EAN-8', () => {
    expect(scanBarcodeSchema.parse({ barcode: '3017620422003' }).barcode).toBe('3017620422003');
    expect(scanBarcodeSchema.safeParse({ barcode: '12345670' }).success).toBe(true);
  });
  it('refuse un code non numérique', () => {
    expect(scanBarcodeSchema.safeParse({ barcode: 'abc' }).success).toBe(false);
  });
});

describe('createStockItemSchema', () => {
  it('refuse une quantité nulle', () => {
    expect(createStockItemSchema.safeParse({ productId: 'p', locationId: 'l', quantity: 0 }).success).toBe(false);
  });
  it('refuse plus de deux décimales', () => {
    expect(createStockItemSchema.safeParse({ productId: 'p', locationId: 'l', quantity: 0.123 }).success).toBe(false);
  });
  it('accepte une date civile et vaut 1 par défaut', () => {
    const parsed = createStockItemSchema.parse({ productId: 'p', locationId: 'l', expiryDate: '2026-10-01' });
    expect(parsed.quantity).toBe(1);
  });
});

describe('paginationQuerySchema', () => {
  it('convertit les chaînes et plafonne à 200', () => {
    expect(paginationQuerySchema.parse({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 });
    expect(paginationQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('setupSchema', () => {
  it('exige 12 caractères de mot de passe et normalise l’e-mail', () => {
    expect(setupSchema.safeParse({ email: 'a@b.fr', name: 'A', password: 'court' }).success).toBe(false);
    expect(setupSchema.parse({ email: ' Franck@Example.org ', name: 'Franck', password: 'motdepasse-long' }).email).toBe('franck@example.org');
  });
});

describe('visionSuggestionSchema', () => {
  it('applique les valeurs par défaut nulles', () => {
    const parsed = visionSuggestionSchema.parse({ name: 'Gochujang', confidence: 0.9 });
    expect(parsed.brand).toBeNull();
    expect(parsed.expiryDate).toBeNull();
  });
  it('refuse une confiance hors bornes', () => {
    expect(visionSuggestionSchema.safeParse({ name: 'X', confidence: 1.5 }).success).toBe(false);
  });
});
