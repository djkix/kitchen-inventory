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

  it('signale GOOGLE_CERTS_URL comme une dégradation : la racine de confiance a bougé', async () => {
    // Le montage de tests bout en bout la pose légitimement ; une production
    // ne doit pas pouvoir la porter sans que `/health` le dise.
    const degrade = await createTestApp({ GOOGLE_CERTS_URL: 'http://stub:3101/certs' });
    try {
      const res = await degrade.api.get('/api/v1/health').expect(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.degraded).toContain('google_certs_url');
    } finally {
      await degrade.close();
    }
  });

  it('ne signale rien de tel quand la variable est absente', async () => {
    const res = await t.api.get('/api/v1/health').expect(200);
    expect(res.body.degraded).not.toContain('google_certs_url');
  });

  it('enveloppe une route inconnue en not_found', async () => {
    const res = await t.api.get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Ressource introuvable' } });
  });
});
