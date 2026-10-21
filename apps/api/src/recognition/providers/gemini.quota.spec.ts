import { describe, expect, it } from 'vitest';
import { parseQuotaRefusal, QuotaRefusalError, quotaRefusalMessage, withQuotaFallback } from './gemini.provider.js';

/**
 * Un 429 de Gemini porte la raison du refus et le délai de reprise. Les lire
 * est la seule façon de dire juste : recopier les limites de Google dans le
 * code les ferait diverger en silence, exactement comme la table de prix l'a
 * fait du 2026-10-15 au 2026-10-21.
 */
describe('parseQuotaRefusal', () => {
  const minuteBody = {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
      ],
    },
  };

  const dayBody = {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }],
        },
      ],
    },
  };

  it('reconnaît la limite par minute et son délai de reprise', () => {
    expect(parseQuotaRefusal(minuteBody)).toEqual({ scope: 'minute', retryAfterSeconds: 12 });
  });

  it('reconnaît la limite par jour, qui ne porte pas de délai', () => {
    expect(parseQuotaRefusal(dayBody)).toEqual({ scope: 'day', retryAfterSeconds: null });
  });

  it('ne tranche pas quand le corps ne dit rien d’exploitable', () => {
    expect(parseQuotaRefusal({ error: { code: 429 } })).toEqual({ scope: 'unknown', retryAfterSeconds: null });
    expect(parseQuotaRefusal(null)).toEqual({ scope: 'unknown', retryAfterSeconds: null });
    expect(parseQuotaRefusal('pas du JSON')).toEqual({ scope: 'unknown', retryAfterSeconds: null });
  });

  it('lit un délai fractionnaire sans le perdre', () => {
    const body = { error: { details: [{ '@type': '…RetryInfo', retryDelay: '0.5s' }] } };
    expect(parseQuotaRefusal(body).retryAfterSeconds).toBe(1);
  });
});

describe('quotaRefusalMessage', () => {
  it('dit la minute et le délai, la seule limite qu’un scan en rafale peut toucher', () => {
    expect(quotaRefusalMessage({ scope: 'minute', retryAfterSeconds: 12 })).toBe(
      'Trop de demandes coup sur coup. Réessayez dans 12 secondes.',
    );
  });

  it('accorde le singulier', () => {
    expect(quotaRefusalMessage({ scope: 'minute', retryAfterSeconds: 1 })).toContain('1 seconde.');
  });

  it('dit la minute sans délai quand Google n’en donne pas', () => {
    expect(quotaRefusalMessage({ scope: 'minute', retryAfterSeconds: null })).toBe(
      'Trop de demandes coup sur coup. Patientez un instant avant de réessayer.',
    );
  });

  it('dit la journée, et quand elle repart', () => {
    expect(quotaRefusalMessage({ scope: 'day', retryAfterSeconds: null })).toBe(
      'Le quota Gemini du jour est épuisé. Il repart à minuit, heure du Pacifique.',
    );
  });

  it('reste compréhensible quand la raison est inconnue', () => {
    expect(quotaRefusalMessage({ scope: 'unknown', retryAfterSeconds: null })).toBe('Quota Gemini atteint');
  });
});

describe('withQuotaFallback', () => {
  const quota = () => new QuotaRefusalError('quota', { scope: 'day', retryAfterSeconds: null });

  it('n’essaie que le modèle principal quand il répond', async () => {
    const vus: Array<string | undefined> = [];
    const r = await withQuotaFallback('a', 'b', async (m) => { vus.push(m); return 'ok'; });
    expect(r).toEqual({ result: 'ok', modelUsed: 'a', fellBack: false });
    expect(vus).toEqual(['a']);
  });

  it('reprend une fois sur le repli quand le quota du principal est épuisé', async () => {
    const vus: Array<string | undefined> = [];
    const r = await withQuotaFallback('a', 'b', async (m) => {
      vus.push(m);
      if (m === 'a') throw quota();
      return 'ok';
    });
    expect(r).toEqual({ result: 'ok', modelUsed: 'b', fellBack: true });
    expect(vus).toEqual(['a', 'b']);
  });

  it('ne reprend jamais deux fois : le refus du repli remonte tel quel', async () => {
    const vus: Array<string | undefined> = [];
    await expect(
      withQuotaFallback('a', 'b', async (m) => { vus.push(m); throw quota(); }),
    ).rejects.toBeInstanceOf(QuotaRefusalError);
    expect(vus).toEqual(['a', 'b']);
  });

  it('ne reprend pas une panne qui n’est pas un quota : le repli échouerait pareil', async () => {
    const vus: Array<string | undefined> = [];
    await expect(
      withQuotaFallback('a', 'b', async (m) => { vus.push(m); throw new Error('clé refusée'); }),
    ).rejects.toThrow('clé refusée');
    expect(vus).toEqual(['a']);
  });

  it('ne reprend pas sans repli configuré, ni sur le même modèle', async () => {
    const sansRepli: Array<string | undefined> = [];
    await expect(withQuotaFallback('a', undefined, async (m) => { sansRepli.push(m); throw quota(); })).rejects.toThrow();
    expect(sansRepli).toEqual(['a']);

    const memeModele: Array<string | undefined> = [];
    await expect(withQuotaFallback('a', 'a', async (m) => { memeModele.push(m); throw quota(); })).rejects.toThrow();
    expect(memeModele).toEqual(['a']);
  });
});
