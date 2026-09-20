import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api, buildUrl, errorMessage, isApiError, mediaUrl, newClientOpId, setUnauthenticatedHandler, toClientError } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('buildUrl', () => {
  it('préfixe /api/v1 et ignore les paramètres vides', () => {
    expect(buildUrl('/stock', { q: '', page: 2, location: undefined, status: 'active' })).toBe('/api/v1/stock?page=2&status=active');
    expect(buildUrl('stock')).toBe('/api/v1/stock');
  });
});

describe('toClientError', () => {
  it('lit l’enveloppe normalisée {error:{code,message,details}}', async () => {
    const error = await toClientError(jsonResponse(429, { error: { code: 'rate_limited', message: 'Quota atteint', details: { callsToday: 50, dailyQuota: 50 } } }));
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.message).toBe('Quota atteint');
    expect(error.detail<number>('callsToday')).toBe(50);
    expect(isApiError(error, 'rate_limited')).toBe(true);
  });

  it('retombe sur un message français par statut quand le corps n’est pas une enveloppe', async () => {
    const error = await toClientError(new Response('<html>', { status: 503 }));
    expect(error.code).toBe('unknown');
    expect(error.message).toMatch(/indisponible/);
  });
});

describe('api.request', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setUnauthenticatedHandler((target) => window.location.assign(target));
  });

  it('envoie le JSON avec les cookies et renvoie undefined sur 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await api.post<void>('/auth/login', { email: 'a@b.fr', password: 'x' });
    expect(result).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.fr', password: 'x' });
  });

  it('traduit une panne réseau en erreur « network »', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(api.get('/me')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('redirige vers /connexion sur 401 hors des écrans d’authentification, sauf si demandé', async () => {
    const redirect = vi.fn();
    setUnauthenticatedHandler(redirect);
    globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(401, { error: { code: 'unauthenticated', message: 'Session absente' } }))) as unknown as typeof fetch;

    await expect(api.get('/stock')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/connexion\?next=/));

    redirect.mockClear();
    await expect(api.get('/me', { skipAuthRedirect: true })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('utilitaires', () => {
  it('construit l’URL d’un média derrière la session', () => {
    expect(mediaUrl('products/ab c.jpg')).toBe('/api/v1/media/products/ab%20c.jpg');
    expect(mediaUrl(null)).toBeNull();
  });

  it('génère des clientOpId uniques d’au moins 8 caractères', () => {
    const a = newClientOpId();
    const b = newClientOpId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it('donne un message lisible pour toute erreur', () => {
    expect(errorMessage(new ApiClientError(404, 'not_found', 'Introuvable'))).toBe('Introuvable');
    expect(errorMessage('bizarre', 'Repli')).toBe('Repli');
  });
});
