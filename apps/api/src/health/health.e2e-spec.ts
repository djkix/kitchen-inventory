import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

describe('GET /api/v1/health', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('rend les trois contrôles et la version', async () => {
    const res = await t.api.get('/api/v1/health').expect(200);
    expect(res.body.checks).toEqual({ database: 'ok', media: 'ok', migrations: 'ok' });
    expect(res.body.version).toBe('0.0.0-dev');
    // Fournisseur de vision désactivé : dégradé, mais 200 (section 21).
    expect(res.body.status).toBe('degraded');
    expect(res.body.degraded).toContain('vision_disabled');
  });

  it('pose l’en-tête noindex sur toutes les réponses', async () => {
    const res = await t.api.get('/api/v1/health');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('enveloppe une route inconnue en not_found', async () => {
    const res = await t.api.get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Ressource introuvable' } });
  });
});
