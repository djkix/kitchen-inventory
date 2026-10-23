import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp, json } from '../../test/fake-http.js';

const ADMIN = { email: 'proprietaire@example.org', name: 'djkix' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre' };

describe('rattrapage nutritionnel depuis Réglages (EF-30)', () => {
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
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  it('rend un état au repos avant tout passage', async () => {
    const res = await agent.get('/api/v1/products/nutrition/backfill').expect(200);
    expect(res.body).toMatchObject({ running: false, updated: 0, finishedAt: null });
  });

  it('lance le rattrapage et renseigne les produits', async () => {
    http.on('/api/v2/product/', () => json({ status: 1, product: { nutriscore_grade: 'b' } }));
    const product = await agent.post('/api/v1/products').send({ name: 'Nutella', barcode: '3017620422003' }).expect(201);

    const started = await agent.post('/api/v1/products/nutrition/backfill').send({ all: false }).expect(202);
    expect(started.body.running).toBe(true);

    await vi.waitFor(async () => {
      expect((await t.prisma.product.findUniqueOrThrow({ where: { id: product.body.id } })).nutriscoreGrade).toBe('b');
      const status = await agent.get('/api/v1/products/nutrition/backfill').expect(200);
      expect(status.body).toMatchObject({ running: false, updated: 1 });
      expect(status.body.finishedAt).not.toBeNull();
    });
  });

  it('refuse un second passage tant que le premier tourne', async () => {
    // Une réponse qui ne vient jamais : le premier passage reste en vol.
    http.on('/api/v2/product/', () => new Promise<Response>(() => undefined));
    await agent.post('/api/v1/products').send({ name: 'Nutella', barcode: '3017620422003' }).expect(201);
    await agent.post('/api/v1/products/nutrition/backfill').send({ all: false }).expect(202);
    await agent.post('/api/v1/products/nutrition/backfill').send({ all: false }).expect(409);
  });

  it('réservé aux administrateurs, mais l’état est lisible par tous', async () => {
    const membre = t.agent();
    await t.addMember(agent, MEMBRE);
    await t.signIn(membre, MEMBRE);
    await membre.get('/api/v1/products/nutrition/backfill').expect(200);
    await membre.post('/api/v1/products/nutrition/backfill').send({ all: false }).expect(403);
  });
});
