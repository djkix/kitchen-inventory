import { describe, expect, it } from 'vitest';
import { GeminiPausedError, GeminiQuotaError } from './gemini-errors.js';
import { isLightModel, isStableModel, orderModels } from './gemini-models.js';
import { GeminiLimiter, pauseAfter429 } from './gemini-quota.js';

const LIMITS = { rpm: 2, tpm: 1000, rpd: 3 };
const at = (iso: string) => new Date(iso);

describe('modèles légers', () => {
  it('refuse Pro et les noms qui sortiraient de l’adresse', () => {
    expect(isLightModel('gemini-3.8-flash')).toBe(true);
    expect(isLightModel('gemini-3.5-flash-lite')).toBe(true);
    expect(isLightModel('gemini-3.5-pro')).toBe(false);
    expect(isLightModel('gemini-flash/../pro')).toBe(false);
  });

  it('ne garde que les Flash et Flash-Lite stables', () => {
    expect(isStableModel('gemini-3.8-flash')).toBe(true);
    expect(isStableModel('gemini-flash-latest')).toBe(false);
    expect(isStableModel('gemini-3.8-flash-preview-09-2026')).toBe(false);
    expect(isStableModel('gemini-3.5-flash-image')).toBe(false);
    expect(isStableModel('gemini-2.5-flash-001')).toBe(false);
  });

  it('classe du plus récent au plus ancien, Flash avant Flash-Lite', () => {
    expect(orderModels(['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-pro', 'gemini-3.8-flash'])).toEqual([
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
    ]);
  });
});

describe('GeminiLimiter', () => {
  it('refuse la requête de trop dans la minute, reprise quand la plus ancienne sort (+1 s)', () => {
    const limiter = new GeminiLimiter();
    limiter.reserve('m', LIMITS, at('2026-10-22T12:00:00Z'));
    limiter.reserve('m', LIMITS, at('2026-10-22T12:00:10Z'));
    const refusal = limiter.check('m', LIMITS, at('2026-10-22T12:00:20Z'));
    expect(refusal).toBeInstanceOf(GeminiQuotaError);
    expect(refusal?.reason).toBe('minute');
    expect(refusal?.until.toISOString()).toBe('2026-10-22T12:01:01.000Z');
    // La fenêtre glisse : une minute plus tard, la place est libre.
    expect(limiter.check('m', LIMITS, at('2026-10-22T12:01:02Z'))).toBeNull();
  });

  it('refuse quand les jetons de la minute atteignent la limite', () => {
    const limiter = new GeminiLimiter();
    limiter.reserve('m', LIMITS, at('2026-10-22T12:00:00Z'));
    limiter.addTokens('m', 1200, at('2026-10-22T12:00:05Z'));
    const refusal = limiter.check('m', LIMITS, at('2026-10-22T12:00:30Z'));
    expect(refusal?.reason).toBe('tokens');
    expect(refusal?.until.toISOString()).toBe('2026-10-22T12:01:06.000Z');
  });

  it('quota du jour d’abord, jusqu’à minuit du Pacifique, et compté par modèle', () => {
    const limiter = new GeminiLimiter();
    for (const t of ['10:00', '10:05', '10:10']) limiter.reserve('m', LIMITS, at(`2026-10-22T${t}:00Z`));
    const refusal = limiter.check('m', LIMITS, at('2026-10-22T11:00:00Z'));
    expect(refusal?.reason).toBe('day');
    expect(refusal?.until.toISOString()).toBe('2026-10-23T07:00:00.000Z');
    expect(limiter.check('autre', LIMITS, at('2026-10-22T11:00:00Z'))).toBeNull();
    // Nouveau jour du Pacifique : compteur à zéro.
    expect(limiter.check('m', LIMITS, at('2026-10-23T07:00:00Z'))).toBeNull();
  });

  it('un modèle marqué épuisé (429 journalier de Google) l’est jusqu’à minuit du Pacifique', () => {
    const limiter = new GeminiLimiter();
    limiter.markExhausted('m', at('2026-10-22T12:00:00Z'));
    expect(limiter.check('m', LIMITS, at('2026-10-22T20:00:00Z'))?.reason).toBe('day');
    expect(limiter.check('m', LIMITS, at('2026-10-23T07:00:00Z'))).toBeNull();
  });

  it('repart du journal au redémarrage', () => {
    const limiter = new GeminiLimiter();
    limiter.seed('m', [at('2026-10-22T10:00:00Z'), at('2026-10-22T10:01:00Z'), at('2026-10-22T11:59:50Z')], at('2026-10-22T12:00:00Z'));
    expect(limiter.usage('m', at('2026-10-22T12:00:00Z'))).toMatchObject({ minuteRequests: 1, dayRequests: 3 });
    expect(limiter.check('m', LIMITS, at('2026-10-22T12:00:00Z'))?.reason).toBe('day');
  });

  it('le refus est une pause, avec un message qui nomme la limite', () => {
    const limiter = new GeminiLimiter();
    limiter.reserve('m', LIMITS, at('2026-10-22T12:00:00Z'));
    limiter.reserve('m', LIMITS, at('2026-10-22T12:00:00Z'));
    const refusal = limiter.check('m', LIMITS, at('2026-10-22T12:00:00Z'), 'Europe/Paris');
    expect(refusal).toBeInstanceOf(GeminiPausedError);
    expect(refusal?.message).toBe('Limite de 2 requêtes par minute atteinte : reprise à 14:02.');
  });
});

describe('pauseAfter429', () => {
  const now = at('2026-10-22T12:00:00Z');
  it('lit retryDelay', () => {
    expect(pauseAfter429({ error: { details: [{ retryDelay: '37.2s' }] } }, now).toISOString()).toBe('2026-10-22T12:00:38.000Z');
  });
  it('une heure sans indication', () => {
    expect(pauseAfter429(null, now).toISOString()).toBe('2026-10-22T13:00:00.000Z');
  });
});
