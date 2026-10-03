import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { createProduct, createRecipe, createStock, isoIn, logCooked } from './recipes.test-helpers.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

/**
 * Scénario de réussite du socle (A23). Stock et recettes figés, résultat
 * attendu écrit recette par recette. Ce test échoue si une règle de couverture,
 * de groupe ou de tri change sans décision explicite.
 *
 * Stock : riz 1 kg · nouilles 2 paquets de 500 g · sauce soja 500 ml qui périme
 * dans 3 jours · tofu 400 g · crème absente. Le seuil d'alerte de péremption
 * est fixé explicitement à 5 jours (plutôt que d'hériter du défaut) : la sauce
 * soja (3 jours) compte alors comme proche de péremption, ce qui détermine le
 * bonus anti-gaspillage et l'ordre de tri ci-dessous.
 * Recettes : « Ramen » (nouilles, soja, tofu) · « Riz sauté » (riz, soja) ·
 * « Salade » (aucun ingrédient suivi) · « Gratin » (crème essentielle, riz).
 */
describe('scénario de réussite du socle', () => {
  let t: TestApp;
  let agent: TestAgent;

  beforeAll(async () => {
    t = await createTestApp();
  });

  /** Sème exactement le stock et les recettes décrits ci-dessus, et renvoie les recettes par titre. */
  async function seedScenario(): Promise<Map<string, { id: string }>> {
    const placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;

    await agent.patch('/api/v1/settings').send({ expiryAlertDays: 5 }).expect(200);

    const riz = await createProduct(agent, { name: 'Riz basmati', defaultUnit: 'GRAM' });
    const nouilles = await createProduct(agent, { name: 'Nouilles', defaultUnit: 'PACK' });
    await t.prisma.product.update({ where: { id: nouilles }, data: { netContent: 500, netContentUnit: 'GRAM' } });
    const soja = await createProduct(agent, { name: 'Sauce soja', defaultUnit: 'MILLILITER' });
    const tofu = await createProduct(agent, { name: 'Tofu', defaultUnit: 'GRAM' });
    const creme = await createProduct(agent, { name: 'Crème fraîche', defaultUnit: 'MILLILITER' });

    await createStock(agent, { productId: riz, locationId: placardId, quantity: 1000, unit: 'GRAM' });
    await createStock(agent, { productId: nouilles, locationId: placardId, quantity: 2, unit: 'PACK' });
    await createStock(agent, { productId: soja, locationId: placardId, quantity: 500, unit: 'MILLILITER', expiryDate: isoIn(3), dateType: 'USE_BY' });
    await createStock(agent, { productId: tofu, locationId: placardId, quantity: 400, unit: 'GRAM' });
    // Crème fraîche : aucun lot en stock (délibérément absente du scénario).

    const recipes = new Map<string, { id: string }>();
    recipes.set(
      'Ramen',
      await createRecipe(agent, 'Ramen', [
        { label: 'Nouilles', productId: nouilles, quantity: 200, unit: 'GRAM' },
        { label: 'Sauce soja', productId: soja, quantity: 20, unit: 'MILLILITER' },
        { label: 'Tofu', productId: tofu, quantity: 200, unit: 'GRAM' },
      ]),
    );
    recipes.set(
      'Riz sauté',
      await createRecipe(agent, 'Riz sauté', [
        { label: 'Riz', productId: riz, quantity: 150, unit: 'GRAM' },
        { label: 'Sauce soja', productId: soja, quantity: 10, unit: 'MILLILITER' },
      ]),
    );
    recipes.set('Salade', await createRecipe(agent, 'Salade', [{ label: 'Sel' }, { label: 'Huile' }]));
    recipes.set(
      'Gratin',
      await createRecipe(agent, 'Gratin', [
        { label: 'Crème fraîche', productId: creme, quantity: 200, unit: 'MILLILITER', essential: true },
        { label: 'Riz', productId: riz, quantity: 100, unit: 'GRAM' },
      ]),
    );
    return recipes;
  }

  let recipes: Map<string, { id: string }>;
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    recipes = await seedScenario();
  });
  afterAll(() => t.close());

  it('rend le classement attendu, recette par recette', async () => {
    const expected = [
      { title: 'Ramen', group: 'ready', coverage: 1, bonus: 1, missingLabels: [] },
      { title: 'Riz sauté', group: 'ready', coverage: 1, bonus: 1, missingLabels: [] },
      { title: 'Salade', group: 'ready', coverage: 1, bonus: 0, missingLabels: [] },
      { title: 'Gratin', group: 'excluded', coverage: 0.5, bonus: 0, missingLabels: ['Crème fraîche'] },
    ];
    const res = await agent.get('/api/v1/recipes?sort=antiWaste').expect(200);
    expect(
      res.body.items.map((r: Record<string, unknown>) => ({
        title: r.title,
        group: r.group,
        coverage: r.coverage,
        bonus: r.bonus,
        missingLabels: r.missingLabels,
      })),
    ).toEqual(expected);
    // Recette du lot 2 : au moins trois recettes réalisables.
    expect(res.body.items.filter((r: { group: string }) => r.group === 'ready')).toHaveLength(3);
  });

  it('bascule le classement sur la note sans changer les groupes', async () => {
    const gratin = recipes.get('Gratin')!;
    const log = await logCooked(agent, gratin.id);
    await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
    const res = await agent.get('/api/v1/recipes').expect(200);
    expect(res.body.items[0]).toMatchObject({ title: 'Gratin', group: 'excluded' });
  });
});
