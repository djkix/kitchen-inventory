import { describe, expect, it } from 'vitest';
import { estimateCostCents, unpricedModelWarning } from './gemini.provider.js';

describe('unpricedModelWarning', () => {
  it('ne dit rien pour un modèle tarifé', () => {
    expect(unpricedModelWarning('gemini', 'gemini-3.5-pro')).toBeNull();
  });

  it('ne dit rien quand aucun modèle n’est imposé : le défaut du fournisseur est tarifé', () => {
    expect(unpricedModelWarning('gemini', undefined)).toBeNull();
  });

  it('nomme le modèle et la conséquence quand il est absent de la table', () => {
    const warning = unpricedModelWarning('gemini', 'gemini-4-ultra');
    expect(warning).toContain('gemini-4-ultra');
    expect(warning).toMatch(/plafond mensuel/i);
    expect(warning).toContain('VISION_MONTHLY_CAP_CENTS');
    // La conséquence exacte : aucun appel chiffré, donc rien de compté.
    expect(estimateCostCents('gemini-4-ultra', { promptTokenCount: 1000, candidatesTokenCount: 1000 })).toBeNull();
  });

  it('se tait pour un autre fournisseur, qui a son propre barème', () => {
    expect(unpricedModelWarning('anthropic', 'claude-inconnu')).toBeNull();
    expect(unpricedModelWarning('none', undefined)).toBeNull();
  });
});
