import { afterEach, describe, expect, it, vi } from 'vitest';
import { suggestionsApi } from './suggestions-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('suggestionsApi.list', () => {
  it('cherche en POST, orientation dans le corps — GET /suggestions ne fait que lire le réservoir', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ fromCache: true, items: [], notice: null, poolCount: 0, poolTotal: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await suggestionsApi.list({ dishType: 'MAIN', refresh: true, limit: 24 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/suggestions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ dishType: 'MAIN', refresh: true, limit: 24 });
  });
});
