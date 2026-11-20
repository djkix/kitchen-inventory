import { describe, expect, it } from 'vitest';
import { isStableModel, orderModels } from './gemini-models.js';

/**
 * L'ordre décide de ce qu'on obtient. La cascade essaie les modèles dans cet
 * ordre : le premier qui répond compose les recettes. Depuis le 2026-11-20 ce
 * sont les Flash, les Flash-Lite ne servant que s'ils saturent — l'inverse
 * donnait un réservoir de 399 recettes à 3,5 ingrédients.
 */
describe('orderModels', () => {
  it('met tous les Flash avant tous les Flash-Lite, même plus récents', () => {
    expect(orderModels(['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.9-flash-lite', 'gemini-3.8-flash'])).toEqual([
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.9-flash-lite',
      'gemini-3.5-flash-lite',
    ]);
  });

  it('range chaque famille du plus récent au plus ancien', () => {
    expect(orderModels(['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
    ]);
  });

  it('écarte Pro, alias, aperçus et instantanés', () => {
    expect(orderModels(['gemini-3.5-pro', 'gemini-flash-latest', 'gemini-3.8-flash-preview-09-2026', 'gemini-3.8-flash-001', 'gemini-3.8-flash'])).toEqual([
      'gemini-3.8-flash',
    ]);
    expect(isStableModel('gemini-3.5-pro')).toBe(false);
  });

  it('dédoublonne sans changer l’ordre', () => {
    expect(orderModels(['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'])).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });
});
