import { describe, expect, it } from 'vitest';
import { matchReceiptLine, normalizeReceiptLabel } from './receipt-match.js';

describe('receipt-match (EF-29)', () => {
  it('un alias connu l’emporte sur toute recherche', () => {
    expect(matchReceiptLine('PT DEJ CHOCO 500G', 'p1', [])).toEqual({ state: 'MATCHED', productId: 'p1', candidateIds: [] });
  });

  it('un seul candidat donne un rapprochement certain', () => {
    const r = matchReceiptLine('RIZ BASMATI 1KG', null, [{ id: 'p2', name: 'Riz basmati', defaultUnit: 'PIECE' }]);
    expect(r).toEqual({ state: 'MATCHED', productId: 'p2', candidateIds: ['p2'] });
  });

  it('deux candidats ne sont jamais tranchés en silence', () => {
    const r = matchReceiptLine('H OLIVE VIERGE 75CL', null, [
      { id: 'p3', name: 'Huile d’olive cuisson', defaultUnit: 'PIECE' },
      { id: 'p4', name: 'Huile d’olive assaisonnement', defaultUnit: 'PIECE' },
    ]);
    expect(r.state).toBe('AMBIGUOUS');
    expect(r.productId).toBeNull();
    expect(r.candidateIds).toEqual(['p3', 'p4']);
  });

  it('aucun candidat laisse la ligne inconnue', () => {
    expect(matchReceiptLine('SCE TOM BASILIC', null, []).state).toBe('UNKNOWN');
  });

  it('un candidat sans mot en commun est écarté', () => {
    const r = matchReceiptLine('RIZ BASMATI', null, [{ id: 'p9', name: 'Farine', defaultUnit: 'PIECE' }]);
    expect(r.state).toBe('UNKNOWN');
  });

  // Review Focus 4 : « 3 × » sur un produit suivi en grammes écrirait trois grammes.
  it('un produit qui ne se compte pas à la pièce n’est jamais coché d’office', () => {
    const r = matchReceiptLine('FARINE T55', null, [{ id: 'p5', name: 'Farine T55', defaultUnit: 'GRAM' }]);
    expect(r.state).toBe('AMBIGUOUS');
    expect(r.productId).toBeNull();
    expect(r.candidateIds).toEqual(['p5']);
  });

  // Review Focus 5 : alias orphelin (le serveur passe null quand le produit a disparu).
  it('un alias dont le produit a disparu rend la ligne inconnue', () => {
    expect(matchReceiptLine('PT DEJ CHOCO 500G', null, []).state).toBe('UNKNOWN');
  });

  it('normalise contenance, casse et accents', () => {
    expect(normalizeReceiptLabel('H OLIVE VIERGE 75CL')).toBe(normalizeReceiptLabel('h olive vierge'));
    expect(normalizeReceiptLabel('3 X Crème 20CL')).toBe(normalizeReceiptLabel('creme'));
  });
});
