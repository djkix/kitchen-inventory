import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { anthropicFixture, FakeHttp, TINY_PNG } from '../../test/fake-http.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('scan par code-barres (EF-01, EF-02, EF-14)', () => {
  let t: TestApp;
  let agent: TestAgent;
  let http: FakeHttp;
  beforeAll(async () => {
    http = new FakeHttp();
    t = await createTestApp({}, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });
  afterAll(() => t.close());

  it('résout un code-barres connu depuis le cache local sans appel réseau', async () => {
    await agent.post('/api/v1/products').send({ name: 'Nutella', barcode: '3017620422003' }).expect(201);
    const res = await agent.post('/api/v1/scan/barcode').send({ barcode: '3017620422003' }).expect(200);
    expect(res.body.source).toBe('cache');
    expect(res.body.product.name).toBe('Nutella');
    expect(http.calls).toHaveLength(0);
  });

  it('interroge Open Food Facts pour un code inconnu et met le produit en cache', async () => {
    http.fixture('/api/v2/product/3017620422003', 'off-3017620422003.json');
    http.on('images.openfoodfacts.org', () => new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const res = await agent.post('/api/v1/scan/barcode').send({ barcode: '3017620422003' }).expect(200);
    expect(res.body.source).toBe('off');
    expect(res.body.product).toMatchObject({
      name: 'Nutella pâte à tartiner aux noisettes et au cacao',
      brand: 'Nutella',
      barcode: '3017620422003',
      netContent: 400,
      netContentUnit: 'GRAM',
      recognitionSource: 'OPEN_FOOD_FACTS',
    });
    expect(res.body.product.imagePath).toMatch(/^products\//);
    const offCall = http.calls.find((c) => c.url.includes('/api/v2/product/'));
    expect(new Headers(offCall?.init?.headers).get('user-agent')).toContain('KitchenInventory');

    // Second scan : cache, plus aucun appel.
    http.reset();
    const again = await agent.post('/api/v1/scan/barcode').send({ barcode: '3017620422003' }).expect(200);
    expect(again.body.source).toBe('cache');
    expect(http.calls).toHaveLength(0);
  });

  it('conserve le nom d’origine non latin renvoyé par Open Food Facts (EF-04)', async () => {
    http.fixture('/api/v2/product/8801043015608', 'off-8801043015608.json');
    const res = await agent.post('/api/v1/scan/barcode').send({ barcode: '8801043015608' }).expect(200);
    expect(res.body.product).toMatchObject({ name: 'Shin Ramyun', originalName: '신라면', brand: 'Nongshim' });
    expect(res.body.product.category?.name).toBe('Épicerie sèche');
  });

  it('renvoie 404 quand le code est inconnu partout', async () => {
    http.fixture('/api/v2/product/00000000', 'off-not-found.json', 404);
    const res = await agent.post('/api/v1/scan/barcode').send({ barcode: '00000000' }).expect(404);
    expect(res.body.error).toMatchObject({ code: 'not_found', details: { barcode: '00000000' } });
  });

  it('un Open Food Facts injoignable donne un 404 journalisé, pas un 502', async () => {
    http.fail('/api/v2/product/');
    const res = await agent.post('/api/v1/scan/barcode').send({ barcode: '12345670' }).expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('mémorise la correction manuelle pour le même code-barres', async () => {
    await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').field('barcode', '4901515001010').expect(422);
    const created = await agent.post('/api/v1/products').send({ name: 'Sauce soja Kikkoman', barcode: '4901515001010' }).expect(201);
    const res = await agent.post('/api/v1/scan/barcode').send({ barcode: '4901515001010' }).expect(200);
    expect(res.body.product.id).toBe(created.body.id);
  });
});

describe('reconnaissance photo (EF-03, EF-04, EF-08)', () => {
  let t: TestApp;
  let agent: TestAgent;
  let http: FakeHttp;
  beforeAll(async () => {
    http = new FakeHttp();
    t = await createTestApp({ VISION_PROVIDER: 'anthropic', VISION_API_KEY: 'sk-ant-test', VISION_DAILY_QUOTA: '2' }, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });
  afterAll(() => t.close());

  it('propose une fiche avec date de péremption, nom d’origine et catégorie rapprochée', async () => {
    http.on('api.anthropic.com', () => anthropicFixture('vision-gochujang.json'));
    const res = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').field('hint', 'pot rouge').expect(200);
    expect(res.body.suggestion).toMatchObject({ name: 'Pâte de piment coréenne (gochujang)', originalName: '고추장 (gochujang)', expiryDate: '2027-03-15' });
    expect(res.body).toMatchObject({ confidence: 0.92, needsReview: false, rejected: false });
    expect(res.body.categoryId).toBeTruthy();
    expect(res.body.imagePath).toMatch(/^scans\//);
    const call = http.calls.find((c) => c.url.includes('api.anthropic.com'));
    const body = JSON.parse(String(call?.init?.body));
    expect(body.model).toBe('claude-opus-5');
    expect(new Headers(call?.init?.headers).get('x-api-key')).toBe('sk-ant-test');
    expect(JSON.stringify(body)).toContain('pot rouge');
    const log = await t.prisma.recognitionLog.findFirstOrThrow();
    expect(log).toMatchObject({ provider: 'anthropic', succeeded: true, confidence: 0.92 });
    expect(log.costCents?.toNumber()).toBeGreaterThan(0);
    // La photo est servie derrière la session.
    await agent.get(`/api/v1/media/${res.body.imagePath}`).expect(200);
    await t.api.get(`/api/v1/media/${res.body.imagePath}`).expect(401);
  });

  it('signale les champs à vérifier entre 50 et 80 % et refuse la fiche sous 50 %', async () => {
    http.on('api.anthropic.com', () => anthropicFixture('vision-uncertain.json'));
    const uncertain = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(200);
    expect(uncertain.body).toMatchObject({ needsReview: true, rejected: false });
    http.reset();
    http.on('api.anthropic.com', () => anthropicFixture('vision-low-confidence.json'));
    const low = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(200);
    expect(low.body.rejected).toBe(true);
  });

  it('applique le quota journalier avec le compteur du jour', async () => {
    http.on('api.anthropic.com', () => anthropicFixture('vision-gochujang.json'));
    await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(200);
    await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(200);
    const res = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(429);
    expect(res.body.error).toMatchObject({ code: 'rate_limited', details: { callsToday: 2, dailyQuota: 2 } });
    const stats = await agent.get('/api/v1/recognition/stats').expect(200);
    expect(stats.body).toMatchObject({ visionCallsToday: 2, dailyQuota: 2, provider: 'anthropic' });
  });

  it('un fournisseur injoignable donne 502 provider_unavailable et garde la photo « à identifier »', async () => {
    http.fail('api.anthropic.com');
    const res = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(502);
    expect(res.body.error.code).toBe('provider_unavailable');
    expect(res.body.error.details.imagePath).toMatch(/^scans\//);
    const log = await t.prisma.recognitionLog.findFirstOrThrow();
    expect(log.succeeded).toBe(false);
    const stats = await agent.get('/api/v1/recognition/stats').expect(200);
    expect(stats.body.pendingIdentification).toBe(1);
  });

  it('une réponse non conforme au JSON strict est un échec, jamais une fiche inventée', async () => {
    http.on('api.anthropic.com', () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Je pense que c’est du riz.' }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 }));
    const res = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(502);
    expect(res.body.error.code).toBe('provider_unavailable');
  });

  it('enregistre la correction d’une reconnaissance (EF-14)', async () => {
    http.on('api.anthropic.com', () => anthropicFixture('vision-gochujang.json'));
    const scan = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(200);
    const product = await agent.post('/api/v1/products').send({ name: 'Gochujang', recognitionLogId: scan.body.rawId, imagePath: scan.body.imagePath }).expect(201);
    const log = await t.prisma.recognitionLog.findUniqueOrThrow({ where: { id: scan.body.rawId } });
    expect(log.correctedTo).toBe(product.body.id);
    expect(product.body.imagePath).toBe(scan.body.imagePath);
  });

  it('refuse un fichier qui n’est pas une image', async () => {
    const res = await agent.post('/api/v1/scan/image').attach('image', Buffer.from('bonjour'), 'note.txt').expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});

describe('fournisseur de vision désactivé', () => {
  it('répond 422 avec un message explicite', async () => {
    const t = await createTestApp({ VISION_PROVIDER: 'none' });
    await t.reset();
    const agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const res = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(422);
    expect(res.body.error.message).toBe('Fournisseur de vision désactivé : renseignez VISION_PROVIDER et VISION_API_KEY');
    await t.close();
  });
});
