import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('export (EF-16), front statique et robots', () => {
  let t: TestApp;
  let webDist: string;
  beforeAll(async () => {
    webDist = await mkdtemp(join(tmpdir(), 'kitchen-web-'));
    await writeFile(join(webDist, 'index.html'), '<!doctype html><title>Inventaire</title>');
    t = await createTestApp({ WEB_DIST_DIR: webDist });
    await t.reset();
  });
  afterAll(() => t.close());

  it('exporte l’inventaire actif en CSV et en JSON', async () => {
    const agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const product = await agent.post('/api/v1/products').send({ name: 'Sauce; soja "Kikkoman"', originalName: '醤油' }).expect(201);
    const location = await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } });
    await agent.post('/api/v1/stock').send({ productId: product.body.id, locationId: location.id, quantity: 2 }).expect(201);
    const consumed = await agent.post('/api/v1/stock').send({ productId: product.body.id, locationId: location.id, quantity: 1, expiryDate: '2030-01-01' }).expect(201);
    await agent.post(`/api/v1/stock/${consumed.body.item.id}/consume`).send({ quantity: 1 }).expect(200);

    const csv = await agent.get('/api/v1/export/inventory.csv').expect(200);
    const lines = csv.text.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^produit;nom_origine;marque/);
    expect(lines[1]).toContain('"Sauce; soja ""Kikkoman""";醤油;;;;Placard;/cuisine/placard;2;pièce');

    const json = await agent.get('/api/v1/export/inventory.json').expect(200);
    expect(json.body).toHaveLength(1);
    expect(json.body[0]).toMatchObject({ product: 'Sauce; soja "Kikkoman"', quantity: 2, unit: 'PIECE' });
    await t.api.get('/api/v1/export/inventory.csv').expect(401);
  });

  it('sert le front sur les routes hors API et interdit les robots', async () => {
    const home = await t.api.get('/').expect(200);
    expect(home.text).toContain('<title>Inventaire</title>');
    const deep = await t.api.get('/stock/abc').expect(200);
    expect(deep.text).toContain('<title>Inventaire</title>');
    const robots = await t.api.get('/robots.txt').expect(200);
    expect(robots.text).toBe('User-agent: *\nDisallow: /\n');
    await t.api.get('/api/v1/inconnu').expect(404);
  });
});
