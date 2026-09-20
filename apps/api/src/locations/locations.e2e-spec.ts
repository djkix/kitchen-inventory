import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('emplacements (EF-06)', () => {
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

  const byPath = async (path: string) => t.prisma.location.findUniqueOrThrow({ where: { path } });

  it('rend l’arbre complet avec le nombre de lots par emplacement', async () => {
    const res = await agent.get('/api/v1/locations').expect(200);
    expect(res.body).toHaveLength(2);
    const cuisine = res.body.find((n: { name: string }) => n.name === 'Cuisine');
    expect(cuisine.children.map((c: { name: string }) => c.name)).toEqual(['Placard', 'Réfrigérateur', 'Congélateur']);
    expect(cuisine.itemCount).toBe(0);
    expect(cuisine.children[0].path).toBe('/cuisine/placard');
  });

  it('crée des emplacements imbriqués à profondeur libre', async () => {
    const placard = await byPath('/cuisine/placard');
    const etagere = await agent.post('/api/v1/locations').send({ name: 'Étagère du haut', parentId: placard.id, kind: 'étagère' }).expect(201);
    expect(etagere.body).toMatchObject({ path: '/cuisine/placard/etagere-du-haut', depth: 2 });
    const bac = await agent.post('/api/v1/locations').send({ name: 'Bac à épices', parentId: etagere.body.id }).expect(201);
    expect(bac.body).toMatchObject({ path: '/cuisine/placard/etagere-du-haut/bac-a-epices', depth: 3 });
  });

  it('refuse un doublon de nom sous le même parent', async () => {
    const cuisine = await byPath('/cuisine');
    const res = await agent.post('/api/v1/locations').send({ name: 'Placard', parentId: cuisine.id }).expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('renommer propage le chemin aux descendants', async () => {
    const cuisine = await byPath('/cuisine');
    await agent.patch(`/api/v1/locations/${cuisine.id}`).send({ name: 'Grande cuisine' }).expect(200);
    const placard = await byPath('/grande-cuisine/placard');
    expect(placard.depth).toBe(1);
  });

  it('déplacer un emplacement recalcule chemin et profondeur, et refuse les cycles', async () => {
    const cellier = await byPath('/cellier');
    const placard = await byPath('/cuisine/placard');
    await agent.patch(`/api/v1/locations/${placard.id}`).send({ parentId: cellier.id }).expect(200);
    expect((await byPath('/cellier/placard')).depth).toBe(1);
    const cuisine = await byPath('/cuisine');
    const cycle = await agent.patch(`/api/v1/locations/${cuisine.id}`).send({ parentId: cuisine.id }).expect(422);
    expect(cycle.body.error.code).toBe('business_rule');
  });

  it('refuse la suppression avec des enfants ou du stock, puis l’accepte après déplacement du contenu', async () => {
    const cuisine = await byPath('/cuisine');
    const withChildren = await agent.delete(`/api/v1/locations/${cuisine.id}`).expect(409);
    expect(withChildren.body.error.details).toMatchObject({ childCount: 3, itemCount: 0 });

    const placard = await byPath('/cuisine/placard');
    const product = await t.prisma.product.create({ data: { name: 'Riz', defaultUnit: 'PIECE' } });
    await t.prisma.stockItem.create({ data: { productId: product.id, locationId: placard.id, quantity: 1, unit: 'PIECE' } });
    const withStock = await agent.delete(`/api/v1/locations/${placard.id}`).expect(409);
    expect(withStock.body.error.details).toMatchObject({ itemCount: 1, parentId: cuisine.id });

    await agent.post(`/api/v1/locations/${placard.id}/move-contents`).expect(200);
    expect((await t.prisma.stockItem.findFirstOrThrow()).locationId).toBe(cuisine.id);
    await agent.delete(`/api/v1/locations/${placard.id}`).expect(204);
  });

  it('un emplacement racine sans parent ne peut pas déplacer son contenu', async () => {
    const cellier = await byPath('/cellier');
    const res = await agent.post(`/api/v1/locations/${cellier.id}/move-contents`).expect(422);
    expect(res.body.error.code).toBe('business_rule');
  });

  it('404 sur un identifiant inconnu', async () => {
    await agent.get('/api/v1/locations/inconnu').expect(404);
  });
});
