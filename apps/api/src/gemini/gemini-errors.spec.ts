import { describe, expect, it } from 'vitest';
import { GENERATION_TIMEOUT_MS, isTimeout, transportMessage } from './gemini-errors.js';

/**
 * Un délai dépassé n'a pas de code HTTP : il ne déclenche donc ni bascule de
 * modèle ni refus nommé, et l'écran le présentait comme un fournisseur
 * injoignable. Le 2026-11-09, une demande de recettes a échoué ainsi quatre
 * fois de suite alors que Gemini répondait en 65 s.
 */
describe('transportMessage', () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  it('reconnaît un délai dépassé et une annulation, pas une panne', () => {
    expect(isTimeout(timeout)).toBe(true);
    expect(isTimeout(Object.assign(new Error('annulé'), { name: 'AbortError' }))).toBe(true);
    expect(isTimeout(new TypeError('fetch failed'))).toBe(false);
    expect(isTimeout('fetch failed')).toBe(false);
  });

  it('dit le délai en secondes plutôt que « injoignable »', () => {
    expect(transportMessage('Fournisseur de suggestions Gemini', timeout)).toBe('Fournisseur de suggestions Gemini : Gemini n’a pas répondu en 120 s');
  });

  it('garde « injoignable » pour une vraie panne de transport', () => {
    expect(transportMessage('Fournisseur de suggestions Gemini', new TypeError('fetch failed'))).toBe('Fournisseur de suggestions Gemini injoignable');
  });

  it('laisse au modèle le temps mesuré en production, deux minutes', () => {
    expect(GENERATION_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000);
  });
});
