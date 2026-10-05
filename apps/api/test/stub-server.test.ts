import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStubServer } from '../../../e2e/fixtures/stub-server.js';

/**
 * Teste la doublure du montage bout en bout (section 19) : un serveur HTTP
 * autonome qui rejoue les fixtures de apps/api/test/fixtures pour remplacer
 * Open Food Facts et Gemini. Démarré ici sur un port éphémère, jamais sur le
 * réseau — aucune de ces assertions ne dépend de Docker.
 */
describe('doublure OFF/Gemini (stub-server.ts)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const stub = await startStubServer(0);
    baseUrl = stub.url;
    close = stub.close;
  });
  afterAll(() => close());

  it('rend une fiche Open Food Facts connue', async () => {
    const res = await fetch(`${baseUrl}/api/v2/product/3017620422003`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { product?: { product_name?: string } };
    expect(body.product?.product_name).toBe('Nutella');
  });

  it('rend 404 sur un code-barres inconnu', async () => {
    const res = await fetch(`${baseUrl}/api/v2/product/00000000`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { status?: number };
    expect(body.status).toBe(0);
  });

  it('rend une reconnaissance de vision depuis la fixture', async () => {
    const res = await fetch(`${baseUrl}/v1beta/models/gemini-3.5-flash:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'Identifie ce produit.' }] }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const parsed = JSON.parse(body.candidates[0]?.content.parts[0]?.text ?? '{}') as { name?: string };
    expect(parsed.name).toBe('Pâte de piment coréenne (gochujang)');
  });

  it('rend une fournée de suggestions depuis la fixture, et la distingue par le corps', async () => {
    const res = await fetch(`${baseUrl}/v1beta/models/gemini-3.5-pro:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Propose des recettes à partir du stock.' }] }],
        tools: [{ google_search: {} }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
    const parsed = JSON.parse(body.candidates[0]?.content.parts[0]?.text ?? '{}') as { recipes?: unknown[] };
    expect(Array.isArray(parsed.recipes)).toBe(true);
    expect(parsed.recipes?.length).toBeGreaterThan(0);
  });

  it('rend 500 quand on le lui demande, pour jouer la panne', async () => {
    const res = await fetch(`${baseUrl}/api/v2/product/3017620422003`, { headers: { 'x-stub-force-status': '500' } });
    expect(res.status).toBe(500);
  });
});
