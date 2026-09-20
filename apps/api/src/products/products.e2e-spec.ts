import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('produits (EF-05, EF-11, EF-14)', () => {
  let t: TestApp;
  let agent: TestAgent;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });
  afterAll(() => t.close());

  it('expose les catégories de la section 22, créées une seule fois', async () => {
    const res = await agent.get('/api/v1/categories').expect(200);
    expect(res.body).toHaveLength(14);
    const laitiers = res.body.find((c: { name: string }) => c.name === 'Produits laitiers');
    expect(laitiers).toMatchObject({ shelfLifeDays: 14, afterOpeningDays: 4 });
  });

  it('crée un produit avec code-barres et refuse le doublon de code', async () => {
    const created = await agent
      .post('/api/v1/products')
      .send({ name: 'Nutella', barcode: '3017620422003', brand: 'Ferrero', defaultUnit: 'PIECE', netContent: 400, netContentUnit: 'GRAM' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Nutella', barcode: '3017620422003', netContent: 400, recognitionSource: 'MANUAL' });
    const dup = await agent.post('/api/v1/products').send({ name: 'Autre', barcode: '3017620422003' }).expect(409);
    expect(dup.body.error.details).toEqual({ existingId: created.body.id });
    await agent.get('/api/v1/products/by-barcode/3017620422003').expect(200);
    await agent.get('/api/v1/products/by-barcode/00000000').expect(404);
  });

  it('refuse une contenance dont l’unité n’est pas mesurable', async () => {
    const res = await agent.post('/api/v1/products').send({ name: 'X', netContent: 2, netContentUnit: 'PIECE' }).expect(422);
    expect(res.body.error.code).toBe('business_rule');
  });

  it('recherche tolérante aux fautes et aux synonymes', async () => {
    await agent.post('/api/v1/products').send({ name: 'Ramen Shin', brand: 'Nongshim', originalName: '신라면' }).expect(201);
    await agent.post('/api/v1/products').send({ name: 'Tomates pelées', brand: 'Mutti' }).expect(201);
    await agent.post('/api/v1/products').send({ name: 'Sauce soja', brand: 'Kikkoman' }).expect(201);

    const nouilles = await agent.get('/api/v1/products?q=nouilles').expect(200);
    expect(nouilles.body.items.map((p: { name: string }) => p.name)).toEqual(['Ramen Shin']);

    const tomat = await agent.get('/api/v1/products?q=tomat').expect(200);
    expect(tomat.body.items.map((p: { name: string }) => p.name)).toEqual(['Tomates pelées']);

    const faute = await agent.get('/api/v1/products?q=tomates pelee').expect(200);
    expect(faute.body.items[0].name).toBe('Tomates pelées');

    const marque = await agent.get('/api/v1/products?q=kikoman').expect(200);
    expect(marque.body.items[0].name).toBe('Sauce soja');

    const original = await agent.get('/api/v1/products?q=신라면').expect(200);
    expect(original.body.items[0].name).toBe('Ramen Shin');

    const all = await agent.get('/api/v1/products?limit=2').expect(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(all.body.items).toHaveLength(2);
  });

  it('filtre par catégorie et exclut les produits fusionnés', async () => {
    const categories = (await agent.get('/api/v1/categories')).body as Array<{ id: string; name: string }>;
    const sauces = categories.find((c) => c.name === 'Sauces et condiments')!;
    await agent.post('/api/v1/products').send({ name: 'Sauce soja', categoryId: sauces.id }).expect(201);
    await agent.post('/api/v1/products').send({ name: 'Riz' }).expect(201);
    const res = await agent.get(`/api/v1/products?category=${sauces.id}`).expect(200);
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Sauce soja']);
  });

  it('modifie un produit', async () => {
    const created = await agent.post('/api/v1/products').send({ name: 'Riz' }).expect(201);
    const updated = await agent.patch(`/api/v1/products/${created.body.id}`).send({ brand: 'Taureau Ailé', minThreshold: 1 }).expect(200);
    expect(updated.body).toMatchObject({ brand: 'Taureau Ailé', minThreshold: 1 });
    await agent.patch('/api/v1/products/inconnu').send({ brand: 'X' }).expect(404);
  });

  it('propose les doublons probables sans fusionner d’office', async () => {
    const a = await agent.post('/api/v1/products').send({ name: 'Sauce soja Kikkoman', brand: 'Kikkoman' }).expect(201);
    await agent.post('/api/v1/products').send({ name: 'Riz basmati' }).expect(201);
    const check = await agent.get('/api/v1/products/check-duplicates?name=Sauce%20Soja%20Kikkoman&brand=kikkoman').expect(200);
    expect(check.body.map((d: { product: { id: string } }) => d.product.id)).toEqual([a.body.id]);
    expect(check.body[0].score).toBeGreaterThanOrEqual(0.9);
    const none = await agent.get('/api/v1/products/check-duplicates?name=Sauce%20huître').expect(200);
    expect(none.body).toEqual([]);
  });

  it('fusionne deux produits : transfert des lots et archivage du doublon', async () => {
    const source = await agent.post('/api/v1/products').send({ name: 'Sauce soja', barcode: '4901515001010' }).expect(201);
    const target = await agent.post('/api/v1/products').send({ name: 'Sauce soja Kikkoman', brand: 'Kikkoman' }).expect(201);
    const location = await t.prisma.location.findFirstOrThrow();
    await t.prisma.stockItem.createMany({
      data: [
        { productId: source.body.id, locationId: location.id, quantity: 1, unit: 'PIECE' },
        { productId: source.body.id, locationId: location.id, quantity: 2, unit: 'PIECE' },
      ],
    });
    const merged = await agent.post(`/api/v1/products/${source.body.id}/merge`).send({ targetId: target.body.id }).expect(200);
    expect(merged.body.id).toBe(target.body.id);
    // Le code-barres suit vers la cible : le prochain scan tombe directement dessus.
    expect(merged.body.barcode).toBe('4901515001010');
    expect(await t.prisma.stockItem.count({ where: { productId: target.body.id } })).toBe(2);
    const archived = await t.prisma.product.findUniqueOrThrow({ where: { id: source.body.id } });
    expect(archived.mergedIntoId).toBe(target.body.id);
    const list = await agent.get('/api/v1/products').expect(200);
    expect(list.body.total).toBe(1);
    const again = await agent.post(`/api/v1/products/${source.body.id}/merge`).send({ targetId: target.body.id }).expect(422);
    expect(again.body.error.code).toBe('business_rule');
    await agent.post(`/api/v1/products/${target.body.id}/merge`).send({ targetId: target.body.id }).expect(422);
  });
});
