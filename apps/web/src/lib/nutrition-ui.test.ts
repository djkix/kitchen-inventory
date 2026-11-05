import { describe, expect, it } from 'vitest';
import { gradeColors, nutrientSentence } from './nutrition-ui';

describe('nutrientSentence (EF-30)', () => {
  it('ne retient que les niveaux élevés quand il y en a', () => {
    expect(nutrientSentence({ salt: 'high', sugars: 'low', fat: 'moderate', 'saturated-fat': 'high' })).toBe('élevé : sel, graisses saturées');
  });

  it('se rabat sur les niveaux modérés faute d’élevé', () => {
    expect(nutrientSentence({ salt: 'low', fat: 'moderate' })).toBe('modéré : graisses');
  });

  it('le dit quand rien n’est élevé', () => {
    expect(nutrientSentence({ salt: 'low', sugars: 'low' })).toBe('rien d’élevé');
  });

  it('ne dit rien sans données', () => {
    expect(nutrientSentence(null)).toBeNull();
  });

  it('garde les deux jaunes lisibles par un texte sombre', () => {
    expect(gradeColors('c').color).not.toBe('#ffffff');
    expect(gradeColors('e').color).toBe('#ffffff');
  });
});
