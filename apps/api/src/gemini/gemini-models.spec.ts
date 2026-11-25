import { describe, expect, it } from 'vitest';
import { isStableModel, orderModels, thinkingConfigFor } from './gemini-models.js';

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

describe('thinkingConfigFor', () => {
  // La famille 3 réfléchit à « high » par défaut : sans réglage, une seule
  // recette demandait vingt à quarante secondes sur un appel réussi.
  it.each(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'])('borne la réflexion de %s à « low »', (model) => {
    expect(thinkingConfigFor(model)).toEqual({ thinkingLevel: 'LOW' });
  });

  // « minimal » est refusé par validation sur les Flash les plus récents, et la
  // cascade prend ses modèles dans la liste en direct de Google.
  it('ne demande jamais « minimal »', () => {
    expect(thinkingConfigFor('gemini-3.8-flash')).not.toEqual({ thinkingLevel: 'MINIMAL' });
  });

  // La famille 2 ne connaît pas `thinkingLevel` : lui envoyer ferait tomber
  // l'appel. Aucune n'est en service, mais la liste vient de Google.
  it('coupe la réflexion d’un modèle de la famille 2 par son budget', () => {
    expect(thinkingConfigFor('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
  });

  it('ne règle rien pour un nom hors cascade', () => {
    expect(thinkingConfigFor('gemini-3.5-pro')).toBeUndefined();
  });
});
