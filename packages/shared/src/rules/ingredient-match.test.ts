import { describe, expect, it } from 'vitest';
import { classifyMatch, MATCH_SIMILARITY_FLOOR } from './ingredient-match.js';

describe('classifyMatch', () => {
  it('rend « sûr » sur une correspondance exacte, accents et casse ignorés', () => {
    expect(classifyMatch('Crème fraîche', [{ productId: 'p1', name: 'creme fraiche', similarity: 0.8 }]))
      .toEqual({ state: 'sure', productId: 'p1', productName: 'creme fraiche' });
  });
  it('rend « probable » au-dessus du seuil (B11)', () => {
    expect(classifyMatch('crème', [{ productId: 'p1', name: 'Crème fraîche épaisse 30%', similarity: 0.55 }]))
      .toMatchObject({ state: 'probable', productId: 'p1' });
  });
  it('rend « absent » en dessous du seuil', () => {
    expect(classifyMatch('safran', [{ productId: 'p1', name: 'Sauce soja', similarity: 0.2 }]))
      .toEqual({ state: 'absent', productId: null, productName: null });
  });
  it('rend « absent » sans candidat', () => {
    expect(classifyMatch('safran', [])).toEqual({ state: 'absent', productId: null, productName: null });
  });
  it('retient le meilleur candidat, pas le premier', () => {
    expect(classifyMatch('crème', [
      { productId: 'p1', name: 'Crème de marrons', similarity: 0.45 },
      { productId: 'p2', name: 'Crème fraîche', similarity: 0.7 },
    ])).toMatchObject({ productId: 'p2' });
  });
  it('préfère une correspondance exacte à un meilleur score trigramme', () => {
    expect(classifyMatch('Crème', [
      { productId: 'p1', name: 'Crème fraîche épaisse', similarity: 0.9 },
      { productId: 'p2', name: 'crème', similarity: 0.5 },
    ])).toMatchObject({ state: 'sure', productId: 'p2' });
  });
  it('rend « absent » sur un libellé vide, sans planter (vigilance 2)', () => {
    expect(classifyMatch('   ', [{ productId: 'p1', name: 'Riz', similarity: 0.9 }]).state).toBe('absent');
  });
  it('expose un seuil de 0,40', () => {
    expect(MATCH_SIMILARITY_FLOOR).toBe(0.4);
  });
});
