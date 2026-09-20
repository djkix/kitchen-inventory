import { describe, expect, it } from 'vitest';
import { findDuplicateCandidates, nameSimilarity, normalizeProductName } from './duplicates.js';

describe('normalizeProductName', () => {
  it('met en minuscules, retire les accents et réduit les espaces', () => {
    expect(normalizeProductName('  Crème   Fraîche Épaisse ')).toBe('creme fraiche epaisse');
  });
  it('conserve les idéogrammes', () => {
    expect(normalizeProductName('辛ラーメン')).toBe('辛ラーメン');
  });
});

describe('nameSimilarity', () => {
  it('vaut 1 pour deux noms identiques à la casse près', () => {
    expect(nameSimilarity('Sauce soja', 'sauce SOJA')).toBe(1);
  });
  it('vaut 0 pour deux noms sans rien en commun', () => {
    expect(nameSimilarity('riz', 'thé')).toBe(0);
  });
  it('est élevée pour une faute de frappe', () => {
    expect(nameSimilarity('Nouilles de riz', 'Nouille de riz')).toBeGreaterThan(0.9);
  });
});

describe('findDuplicateCandidates', () => {
  const products = [
    { id: 'a', name: 'Sauce soja Kikkoman', brand: 'Kikkoman' },
    { id: 'b', name: 'Sauce soja sucrée', brand: 'Kikkoman' },
    { id: 'c', name: 'Riz basmati', brand: null },
  ];
  it('propose les produits au-dessus de 90 % de similarité, triés', () => {
    const result = findDuplicateCandidates({ name: 'Sauce Soja Kikkoman', brand: 'kikkoman' }, products);
    expect(result.map((r) => r.product.id)).toEqual(['a']);
    expect(result[0]?.score).toBeGreaterThanOrEqual(0.9);
  });
  it('ne propose rien sous le seuil', () => {
    expect(findDuplicateCandidates({ name: 'Sauce huître', brand: null }, products)).toEqual([]);
  });
  it('tient compte de la marque', () => {
    expect(findDuplicateCandidates({ name: 'Sauce soja Kikkoman', brand: 'Lee Kum Kee' }, products)).toEqual([]);
  });
});
