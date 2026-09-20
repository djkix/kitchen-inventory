import { describe, expect, it } from 'vitest';
import { expandSearchTerms } from './synonyms.js';

describe('expandSearchTerms', () => {
  it('ajoute les synonymes connus', () => {
    const terms = expandSearchTerms('Nouilles');
    expect(terms[0]).toBe('nouilles');
    expect(terms).toEqual(expect.arrayContaining(['ramen', 'udon', 'soba']));
  });
  it('renvoie la requête seule quand aucun synonyme n’existe', () => {
    expect(expandSearchTerms('Kikkoman')).toEqual(['kikkoman']);
  });
  it('renvoie une liste vide pour une requête vide', () => {
    expect(expandSearchTerms('   ')).toEqual([]);
  });
  it('développe les mots d’une requête composée', () => {
    expect(expandSearchTerms('riz thai')).toEqual(expect.arrayContaining(['riz thai', 'basmati']));
  });
});
