import { describe, expect, it } from 'vitest';
import { isStableModel, orderModels } from './gemini-models.js';

/**
 * L'ordre décide de l'attente : la cascade essaie les modèles dans cet ordre,
 * et chaque refus coûte de quelques secondes à deux minutes. Le 2026-11-09, en
 * production, cinq modèles ont refusé avant que `gemini-3.5-flash-lite` ne
 * réponde en 3,7 s — dont un délai dépassé de 120 s.
 */
describe('orderModels', () => {
  it('met tous les Flash-Lite avant tous les Flash, même plus anciens', () => {
    expect(orderModels(['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'])).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
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
    expect(orderModels(['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'])).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  });
});
