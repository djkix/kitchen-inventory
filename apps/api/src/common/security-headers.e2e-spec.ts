import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

/** En-têtes de sécurité (revue de sécurité du 2026-10-22), sur l'API comme sur le front compilé. */
describe('en-têtes de sécurité', () => {
  let t: TestApp;
  beforeAll(async () => {
    const dist = await mkdtemp(join(tmpdir(), 'kitchen-web-'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    t = await createTestApp({ WEB_DIST_DIR: dist });
  });
  afterAll(() => t.close());

  it.each(['/api/v1/health', '/', '/stock'])('protège %s', async (path) => {
    const res = await t.api.get(path);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Google Identity Services doit rester utilisable.
    expect(csp).toContain('script-src \'self\' \'wasm-unsafe-eval\' https://accounts.google.com/gsi/client');
    expect(csp).toContain('frame-src https://accounts.google.com/gsi/');
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['permissions-policy']).toContain('camera=(self)');
    expect(res.headers['permissions-policy']).toContain('microphone=(self)');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });
});

describe('HSTS seulement derrière HTTPS', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ PUBLIC_URL: 'http://localhost:3000' });
  });
  afterAll(() => t.close());

  it('n’envoie pas Strict-Transport-Security quand PUBLIC_URL est en clair', async () => {
    const res = await t.api.get('/api/v1/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
