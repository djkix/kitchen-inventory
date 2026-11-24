import { describe, expect, it } from 'vitest';
import { labelMatchesTerms, normalizeIngredientTerms } from './suggestion-ingredients.js';


describe('normalizeIngredientTerms (D3, D7)', () => {
  it('trie les termes : « merguez, pommes de terre » est la même demande que l’ordre inverse', () => {
    // Sans le tri, les deux saisies formeraient deux signatures distinctes,
    // donc deux appels payants pour une seule et même question.
    expect(normalizeIngredientTerms('merguez, pommes de terre')).toEqual(normalizeIngredientTerms('pommes de terre, merguez'));
    expect(normalizeIngredientTerms('merguez, pommes de terre')).toEqual(['merguez', 'pommes de terre']);
  });
  it('normalise accents, casse et espaces, et dédoublonne', () => {
    expect(normalizeIngredientTerms('Crème,  CREME , crème')).toEqual(['creme']);
  });
  it('ne rend rien pour une saisie vide', () => {
    expect(normalizeIngredientTerms('')).toEqual([]);
  });
});


describe('labelMatchesTerms (D5)', () => {
  it('reconnaît le libellé qui porte un terme dicté', () => {
    expect(labelMatchesTerms('Merguez d’agneau', ['merguez'])).toBe(true);
  });
  it('reconnaît aussi le pluriel du terme dicté', () => {
    expect(labelMatchesTerms('Merguez d’agneau', ['merguez'])).toBe(true);
    expect(labelMatchesTerms('Pomme de terre', ['pommes de terre'])).toBe(true);
    expect(labelMatchesTerms('Pommes de terre nouvelles', ['pomme de terre'])).toBe(true);
  });

  it('laisse les autres libellés tranquilles', () => {
    expect(labelMatchesTerms('Huile d’olive', ['merguez'])).toBe(false);
    expect(labelMatchesTerms('Merguez', [])).toBe(false);
  });
});

