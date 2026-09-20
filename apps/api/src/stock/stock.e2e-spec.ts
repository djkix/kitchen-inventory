import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };
const isoIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('stock (EF-07, EF-08, EF-09, EF-10)', () => {
  let t: TestApp;
  let agent: TestAgent;
  let placardId: string;
  let frigoId: string;
  let categories: Record<string, string>;

  const createProduct = async (body: Record<string, unknown>): Promise<string> =>
    (await agent.post('/api/v1/products').send(body).expect(201)).body.id;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
    frigoId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/refrigerateur' } })).id;
    const list = (await agent.get('/api/v1/categories')).body as Array<{ id: string; name: string }>;
    categories = Object.fromEntries(list.map((c) => [c.name, c.id]));
  });
  afterAll(() => t.close());

  it('crée un lot avec un mouvement d’entrée et une quantité matérialisée', async () => {
    const productId = await createProduct({ name: 'Riz', defaultUnit: 'KILOGRAM' });
    const res = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 2, clientOpId: 'op-create-0001' }).expect(201);
    expect(res.body.item).toMatchObject({ quantity: 2, unit: 'KILOGRAM', expiryStatus: 'none', daysUntilExpiry: null, archivedAt: null });
    expect(res.body.movement).toMatchObject({ type: 'INBOUND', delta: 2 });
    expect(res.body.merged).toBe(false);
    const movements = await t.prisma.stockMovement.findMany();
    expect(movements).toHaveLength(1);
    expect(movements[0]?.clientOpId).toBe('op-create-0001');
  });

  it('rejouer le même clientOpId ne crée rien de plus', async () => {
    const productId = await createProduct({ name: 'Riz' });
    const first = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 1, clientOpId: 'op-replay-0001' }).expect(201);
    const second = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 1, clientOpId: 'op-replay-0001' }).expect(201);
    expect(second.body.replayed).toBe(true);
    expect(second.body.item.id).toBe(first.body.item.id);
    expect(second.body.item.quantity).toBe(1);
    expect(await t.prisma.stockMovement.count()).toBe(1);
  });

  it('refuse une unité d’une autre famille que celle du produit', async () => {
    const productId = await createProduct({ name: 'Lait', defaultUnit: 'LITER' });
    const res = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 1, unit: 'GRAM' }).expect(422);
    expect(res.body.error.code).toBe('business_rule');
    await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 500, unit: 'MILLILITER' }).expect(201);
  });

  it('deux entrées à date identique fusionnent, à dates différentes créent deux lots', async () => {
    const productId = await createProduct({ name: 'Yaourt' });
    const a = await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(10), dateType: 'USE_BY' }).expect(201);
    const b = await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(10), dateType: 'USE_BY' }).expect(201);
    expect(b.body.merged).toBe(true);
    expect(b.body.item.id).toBe(a.body.item.id);
    expect(b.body.item.quantity).toBe(2);
    const c = await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(20), dateType: 'USE_BY' }).expect(201);
    expect(c.body.item.id).not.toBe(a.body.item.id);
    expect((await agent.get('/api/v1/stock').expect(200)).body.total).toBe(2);
  });

  it('estime la DLC des périssables non emballés depuis la catégorie et la marque comme estimée', async () => {
    const productId = await createProduct({ name: 'Pommes', categoryId: categories['Fruits frais'] });
    const res = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 6, estimateExpiry: true }).expect(201);
    expect(res.body.item.expiryDate).toBe(isoIn(7));
    expect(res.body.item.dateEstimated).toBe(true);
    expect(res.body.item.expiryStatus).toBe('soon');
  });

  it('consomme, plafonne au stock disponible et archive à zéro', async () => {
    const productId = await createProduct({ name: 'Huile', defaultUnit: 'LITER' });
    const created = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 1 }).expect(201);
    const id = created.body.item.id;
    const partial = await agent.post(`/api/v1/stock/${id}/consume`).send({ quantity: 0.6, clientOpId: 'op-consume-0001' }).expect(200);
    expect(partial.body.item.quantity).toBe(0.4);
    expect(partial.body.movement).toMatchObject({ type: 'CONSUMPTION', delta: -0.6 });
    const over = await agent.post(`/api/v1/stock/${id}/consume`).send({ quantity: 1 }).expect(200);
    expect(over.body.capped).toBe(true);
    expect(over.body.message).toBe('Quantité ramenée au stock disponible (0,4 l)');
    expect(over.body.movement).toMatchObject({ type: 'ADJUSTMENT', delta: -0.4 });
    expect(over.body.item.quantity).toBe(0);
    expect(over.body.item.archivedAt).not.toBeNull();
    const active = await agent.get('/api/v1/stock').expect(200);
    expect(active.body.total).toBe(0);
    const archived = await agent.get('/api/v1/stock?status=archived').expect(200);
    expect(archived.body.total).toBe(1);
    const again = await agent.post(`/api/v1/stock/${id}/consume`).send({ quantity: 1 }).expect(422);
    expect(again.body.error.code).toBe('business_rule');
  });

  it('un ajustement positif annule une consommation et réactive le lot', async () => {
    const productId = await createProduct({ name: 'Riz' });
    const created = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 1 }).expect(201);
    const id = created.body.item.id;
    await agent.post(`/api/v1/stock/${id}/consume`).send({ quantity: 1 }).expect(200);
    const undo = await agent.post(`/api/v1/stock/${id}/adjust`).send({ delta: 1, reason: 'Annulation', clientOpId: 'op-undo-00001' }).expect(200);
    expect(undo.body.item).toMatchObject({ quantity: 1, archivedAt: null });
    const tooMuch = await agent.post(`/api/v1/stock/${id}/adjust`).send({ delta: -5 }).expect(422);
    expect(tooMuch.body.error.code).toBe('business_rule');
  });

  it('ouvrir un produit recalcule la date effective avec la durée après ouverture', async () => {
    const productId = await createProduct({ name: 'Lait', categoryId: categories['Produits laitiers'] });
    const created = await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(30), dateType: 'USE_BY' }).expect(201);
    const opened = await agent.post(`/api/v1/stock/${created.body.item.id}/open`).expect(200);
    expect(opened.body.opened).toBe(true);
    expect(opened.body.effectiveExpiry).toBe(isoIn(4));
    expect(opened.body.daysUntilExpiry).toBe(4);
    expect(opened.body.expiryStatus).toBe('soon');
  });

  it('classe les articles par statut de péremption et exclut ceux sans date de « périme bientôt »', async () => {
    const productId = await createProduct({ name: 'Jambon' });
    const biscuits = await createProduct({ name: 'Biscuits' });
    await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(-2), dateType: 'USE_BY' }).expect(201);
    await agent.post('/api/v1/stock').send({ productId: biscuits, locationId: placardId, expiryDate: isoIn(-2), dateType: 'BEST_BEFORE' }).expect(201);
    await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(3), dateType: 'USE_BY' }).expect(201);
    await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(60), dateType: 'USE_BY' }).expect(201);
    await agent.post('/api/v1/stock').send({ productId, locationId: placardId }).expect(201);

    const expiring = await agent.get('/api/v1/stock/expiring').expect(200);
    const statuses = expiring.body.items.map((i: { expiryStatus: string }) => i.expiryStatus);
    expect(statuses.slice(0, 2).sort()).toEqual(['expired_best_before', 'expired_use_by']);
    expect(statuses[2]).toBe('soon');
    expect(expiring.body.alertDays).toBe(7);

    const wide = await agent.get('/api/v1/stock/expiring?days=90').expect(200);
    expect(wide.body.items).toHaveLength(4);
  });

  it('respecte le seuil d’alerte des réglages', async () => {
    expect((await agent.get('/api/v1/settings').expect(200)).body).toEqual({ expiryAlertDays: 7 });
    await agent.patch('/api/v1/settings').send({ expiryAlertDays: 2 }).expect(200);
    const productId = await createProduct({ name: 'Jambon' });
    await agent.post('/api/v1/stock').send({ productId, locationId: frigoId, expiryDate: isoIn(3), dateType: 'USE_BY' }).expect(201);
    const expiring = await agent.get('/api/v1/stock/expiring').expect(200);
    expect(expiring.body.items).toHaveLength(0);
    const list = await agent.get('/api/v1/stock').expect(200);
    expect(list.body.items[0].expiryStatus).toBe('ok');
  });

  it('filtre par sous-arbre d’emplacement et par recherche texte', async () => {
    const riz = await createProduct({ name: 'Riz basmati' });
    const ramen = await createProduct({ name: 'Ramen Shin' });
    await agent.post('/api/v1/stock').send({ productId: riz, locationId: placardId }).expect(201);
    await agent.post('/api/v1/stock').send({ productId: ramen, locationId: frigoId }).expect(201);
    const cuisineId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine' } })).id;
    expect((await agent.get(`/api/v1/stock?location=${cuisineId}`).expect(200)).body.total).toBe(2);
    expect((await agent.get(`/api/v1/stock?location=${placardId}`).expect(200)).body.total).toBe(1);
    const search = await agent.get('/api/v1/stock?q=nouilles').expect(200);
    expect(search.body.items.map((i: { product: { name: string } }) => i.product.name)).toEqual(['Ramen Shin']);
  });

  it('déplace, modifie la date, jette et rend l’historique des mouvements', async () => {
    const productId = await createProduct({ name: 'Riz' });
    const created = await agent.post('/api/v1/stock').send({ productId, locationId: placardId, quantity: 2 }).expect(201);
    const id = created.body.item.id;
    const moved = await agent.post(`/api/v1/stock/${id}/move`).send({ locationId: frigoId }).expect(200);
    expect(moved.body.locationId).toBe(frigoId);
    const dated = await agent.patch(`/api/v1/stock/${id}`).send({ expiryDate: isoIn(5), dateType: 'BEST_BEFORE' }).expect(200);
    expect(dated.body).toMatchObject({ expiryDate: isoIn(5), effectiveExpiry: isoIn(5), expiryStatus: 'soon' });
    await agent.delete(`/api/v1/stock/${id}`).expect(200);
    const detail = await agent.get(`/api/v1/stock/${id}`).expect(200);
    expect(detail.body.archivedAt).not.toBeNull();
    expect(detail.body.movements.map((m: { type: string; delta: number }) => [m.type, m.delta])).toEqual([
      ['LOSS', -2],
      ['INBOUND', 2],
    ]);
    expect(detail.body.movements[0].userName).toBe('Franck');
  });
});
