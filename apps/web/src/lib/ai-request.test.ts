import type * as ApiModule from './api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginAiRequest, deferredTime, forgetAiRequest, isDeferred, recoverAiRequests, watchAiRequest } from './ai-request';
import { api, ApiClientError } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('./api');
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

const get = vi.mocked(api.get);

beforeEach(() => {
  localStorage.clear();
  get.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('watchAiRequest : « j’ai posé mon téléphone »', () => {
  const hide = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('prévient le serveur quand la page passe en arrière-plan', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const stop = watchAiRequest('req-1');
    hide('hidden');
    expect(beacon).toHaveBeenCalledWith('/api/v1/ai-requests/req-1/background');
    stop();
  });

  it('ne dit rien quand la page redevient visible', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const stop = watchAiRequest('req-2');
    hide('visible');
    expect(beacon).not.toHaveBeenCalled();
    stop();
  });

  // Une demande rendue n'est plus en attente : la surveiller ferait sonner
  // pour un résultat qu'on a déjà vu.
  it('ne dit plus rien une fois la surveillance arrêtée', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const stop = watchAiRequest('req-3');
    stop();
    hide('hidden');
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe('recoverAiRequests : retrouver ce qu’on n’a pas vu aboutir', () => {
  it('rend les demandes abouties et les oublie', async () => {
    const id = beginAiRequest();
    get.mockResolvedValue({ id, kind: 'RECEIPT', state: 'DONE', result: {}, error: null, retryAt: null });
    expect(await recoverAiRequests()).toHaveLength(1);
    // Oubliée : elle ne doit pas être annoncée une seconde fois au prochain retour.
    expect(await recoverAiRequests()).toHaveLength(0);
  });

  it('garde pour plus tard une demande encore différée', async () => {
    const id = beginAiRequest();
    get.mockResolvedValue({ id, kind: 'VOICE', state: 'DEFERRED', result: null, error: null, retryAt: '2026-11-02T23:40:00Z' });
    expect(await recoverAiRequests()).toHaveLength(0);
    expect(get).toHaveBeenCalledTimes(1);
    await recoverAiRequests();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('oublie une demande introuvable plutôt que d’insister indéfiniment', async () => {
    beginAiRequest();
    get.mockRejectedValue(new ApiClientError(404, 'not_found', 'Demande introuvable'));
    expect(await recoverAiRequests()).toHaveLength(0);
    await recoverAiRequests();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('n’appelle rien quand il n’y a rien en attente', async () => {
    expect(await recoverAiRequests()).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('oublie une demande à la demande', async () => {
    const id = beginAiRequest();
    forgetAiRequest(id);
    await recoverAiRequests();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('isDeferred et deferredTime', () => {
  const differe = new ApiClientError(429, 'rate_limited', 'Gardée.', { deferred: true, retryAt: '2026-11-02T22:40:00Z' });

  it('reconnaît une demande gardée', () => {
    expect(isDeferred(differe)).toBe(true);
    expect(isDeferred(new ApiClientError(429, 'rate_limited', 'Quota atteint.'))).toBe(false);
  });

  it('rend l’heure de reprise, et null quand il n’y en a pas', () => {
    expect(deferredTime(differe)).toMatch(/^\d\d:\d\d$/);
    expect(deferredTime(new ApiClientError(500, 'unknown', 'Panne'))).toBeNull();
  });
});
