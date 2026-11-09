import { describe, expect, it } from 'vitest';
import { GENERATION_TIMEOUT_MS, isTimeout, transportMessage } from './gemini-errors.js';
import { isRetired } from './gemini-quota.js';

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

/**
 * Un 404 d'URL mal formée n'est pas un retrait : seul le message de Google,
 * « no longer available to new users », justifie d'écarter un modèle pour de bon.
 */
describe('isRetired', () => {
  it('reconnaît le retrait annoncé par Google', () => {
    expect(isRetired({ error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.' } })).toBe(true);
  });

  it('laisse passer un 404 ordinaire', () => {
    expect(isRetired({ error: { code: 404, message: 'Requested entity was not found.' } })).toBe(false);
    expect(isRetired(null)).toBe(false);
    expect(isRetired({ error: {} })).toBe(false);
  });
});
