import { describe, expect, it } from 'vitest';
import { labelMatchesTerms, normalizeIngredientTerms, recipeUsesAllTerms, splitIngredientTerms } from './suggestion-ingredients.js';

describe('splitIngredientTerms (D7)', () => {
  it('découpe sur la virgule, sans normaliser : c’est la saisie telle quelle qui est bornée', () => {
    expect(splitIngredientTerms('Pommes de terre, Merguez')).toEqual(['Pommes de terre', 'Merguez']);
  });
  it('ignore les séparateurs vides : une virgule de trop n’est pas un ingrédient', () => {
    expect(splitIngredientTerms(' , pommes ,, ')).toEqual(['pommes']);
  });
  it('rend une liste vide pour une saisie vide : absence de contrainte, pas contrainte vide', () => {
    expect(splitIngredientTerms('   ')).toEqual([]);
  });
});

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

describe('recipeUsesAllTerms (D1, D8)', () => {
  const labels = ['Pommes de terre nouvelles', 'Merguez d’agneau', 'Huile d’olive'];

  it('exige TOUS les termes : c’est le sens de la demande, écouler des restes', () => {
    expect(recipeUsesAllTerms(labels, ['merguez', 'pommes de terre'])).toBe(true);
    expect(recipeUsesAllTerms(labels, ['merguez', 'courgette'])).toBe(false);
  });
  it('rapproche par inclusion : « pomme de terre » trouve « pommes de terre nouvelles »', () => {
    expect(recipeUsesAllTerms(['Pommes de terre nouvelles'], ['pommes de terre'])).toBe(true);
  });
  it('sans terme, aucune contrainte', () => {
    expect(recipeUsesAllTerms([], [])).toBe(true);
  });
});

describe('labelMatchesTerms (D5)', () => {
  it('reconnaît le libellé qui porte un terme dicté', () => {
    expect(labelMatchesTerms('Merguez d’agneau', ['merguez'])).toBe(true);
  });
  it('laisse les autres libellés tranquilles', () => {
    expect(labelMatchesTerms('Huile d’olive', ['merguez'])).toBe(false);
    expect(labelMatchesTerms('Merguez', [])).toBe(false);
  });
});
