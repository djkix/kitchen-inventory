import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { createProduct, createRecipe, createStock, logCooked } from './recipes.test-helpers.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('recettes (EF-17, EF-21)', () => {
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

  it('crée une recette, calcule sa difficulté et la renvoie complète', async () => {
    const nouillesId = await createProduct(agent, { name: 'Nouilles' });
    const res = await agent
      .post('/api/v1/recipes')
      .send({
        title: 'Ramen maison',
        servings: 2,
        prepMinutes: 30,
        cookMinutes: 15,
        restMinutes: 120,
        steps: ['Faire revenir le porc', 'Déglacer', 'Pocher les œufs', 'Monter le bol', 'Servir'],
        dishType: 'MAIN',
        diets: ['PORK_FREE'],
        ingredients: [{ label: 'Nouilles', productId: nouillesId, quantity: 200, unit: 'GRAM', essential: true }],
      })
      .expect(201);
    expect(res.body).toMatchObject({ title: 'Ramen maison', difficulty: 'INTERMEDIATE', difficultyOverride: false, source: 'HOUSEHOLD', dishType: 'MAIN' });
    expect(res.body.totalMinutes).toBe(45); // le repos ne compte pas (A13)
    expect(res.body.stats).toMatchObject({ timesCooked: 0, averageRating: null, tags: ['never'] });
    expect(res.body.ingredients[0]).toMatchObject({ label: 'Nouilles', productId: nouillesId, state: 'untracked', candidates: [] });
  });

  it('respecte une difficulté corrigée et cesse de la recalculer', async () => {
    const created = await agent.post('/api/v1/recipes').send({ title: 'Salade', steps: ['Mélanger'], difficulty: 'HARD' }).expect(201);
    expect(created.body).toMatchObject({ difficulty: 'HARD', difficultyOverride: true });
    const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).expect(200);
    expect(updated.body.difficulty).toBe('HARD');
  });

  it('recalcule la difficulté tant qu’elle n’a pas été corrigée', async () => {
    const created = await agent.post('/api/v1/recipes').send({ title: 'Salade', steps: ['Mélanger'] }).expect(201);
    expect(created.body.difficulty).toBe('VERY_EASY');
    // computeDifficulty (tâche 1) : 8 étapes (palier 2) + temps actif 60 (palier 3) + 0 technique = score 5 → INTERMEDIATE,
    // pas HARD comme l'esquissait le brief — vérifié contre packages/shared/src/rules/difficulty.ts.
    const updated = await agent.patch(`/api/v1/recipes/${created.body.id}`).send({ activeTime: 60, steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }).expect(200);
    expect(updated.body.difficulty).toBe('INTERMEDIATE');
  });

  it('refuse un produit, une catégorie ou une cuisine inconnus', async () => {
    await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], cuisineId: 'inconnu' }).expect(404);
    await agent.post('/api/v1/recipes').send({ title: 'X', steps: ['a'], ingredients: [{ label: 'y', productId: 'inconnu' }] }).expect(404);
  });

  it('remplace les ingrédients sans laisser d’orphelin', async () => {
    const created = await createRecipe(agent, 'X', [{ label: 'un' }, { label: 'deux' }]);
    const updated = await agent.patch(`/api/v1/recipes/${created.id}`).send({ ingredients: [{ label: 'trois' }] }).expect(200);
    expect(updated.body.ingredients.map((i: { label: string }) => i.label)).toEqual(['trois']);
    expect(await t.prisma.recipeIngredient.count()).toBe(1);
  });

  it('lit une recette dont les étapes sont corrompues sans échouer', async () => {
    const created = await createRecipe(agent, 'X', []);
    await t.prisma.recipe.update({ where: { id: created.id }, data: { steps: { bloc: 'texte libre' } } });
    expect((await agent.get(`/api/v1/recipes/${created.id}`).expect(200)).body.steps).toEqual([]);
  });

  it('supprime une recette jamais réalisée, refuse après une réalisation (A20)', async () => {
    const jamais = await createRecipe(agent, 'Jamais faite', []);
    await agent.delete(`/api/v1/recipes/${jamais.id}`).expect(204);

    const faite = await createRecipe(agent, 'Déjà faite', []);
    await t.prisma.recipeLog.create({ data: { recipeId: faite.id, servingsCooked: 4, stockApplied: false } });
    const refus = await agent.delete(`/api/v1/recipes/${faite.id}`).expect(409);
    expect(refus.body.error.details).toMatchObject({ timesCooked: 1 });
  });

  it('archive, retire des listes, puis restaure', async () => {
    const recipe = await createRecipe(agent, 'Archivable', []);
    await agent.post(`/api/v1/recipes/${recipe.id}/archive`).expect(200);
    expect((await agent.get('/api/v1/recipes').expect(200)).body.items).toHaveLength(0);
    expect((await agent.get('/api/v1/recipes?archived=true').expect(200)).body.items).toHaveLength(1);
    await agent.post(`/api/v1/recipes/${recipe.id}/restore`).expect(200);
    expect((await agent.get('/api/v1/recipes').expect(200)).body.items).toHaveLength(1);
  });

  it('refuse l’identifiant inconnu avec 404', async () => {
    await agent.get('/api/v1/recipes/inconnu').expect(404);
    await agent.patch('/api/v1/recipes/inconnu').send({ title: 'X' }).expect(404);
    await agent.delete('/api/v1/recipes/inconnu').expect(404);
    await agent.post('/api/v1/recipes/inconnu/archive').expect(404);
  });

  describe('réalisations et notation (EF-28)', () => {
    let rizId: string;
    let placardId: string;

    beforeEach(async () => {
      rizId = await createProduct(agent, { name: 'Riz', defaultUnit: 'GRAM' });
      placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
    });

    it('enregistre une réalisation sans toucher au stock (A26)', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }]);
      const log = await logCooked(agent, recipe.id, { stars: 5 });
      expect(log).toMatchObject({ stockApplied: false, servingsCooked: 4 });
      expect(await t.prisma.stockMovement.count({ where: { type: 'RECIPE' } })).toBe(0);
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1000);
    });

    it('accepte une note par membre et moyenne les avis (A24)', async () => {
      const recipe = await createRecipe(agent, 'Dahl', []);
      const log = await logCooked(agent, recipe.id);
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5, comment: 'Parfait' }).expect(200);

      await agent.post('/api/v1/users').send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201);
      const marie = t.agent();
      await marie.post('/api/v1/auth/login').send({ email: 'marie@example.org', password: 'encore-un-mot-de-passe' }).expect(204);
      await marie.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 3 }).expect(200);

      expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats).toMatchObject({ averageRating: 4, ratingCount: 2 });
      expect((await agent.get(`/api/v1/recipes/${recipe.id}/logs`).expect(200)).body.items[0].ratings).toHaveLength(2);
    });

    it('remplace sa propre note sans en créer une seconde', async () => {
      const recipe = await createRecipe(agent, 'Dahl', []);
      const log = await logCooked(agent, recipe.id);
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 2 }).expect(200);
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
      expect(await t.prisma.recipeRating.count()).toBe(1);
      expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats.averageRating).toBe(5);
    });

    it('ferme la notation après sept jours (A25)', async () => {
      const recipe = await createRecipe(agent, 'Dahl', []);
      const log = await logCooked(agent, recipe.id);
      await t.prisma.recipeLog.update({ where: { id: log.id }, data: { cookedAt: new Date(Date.now() - 8 * 86_400_000) } });
      const res = await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(409);
      expect(res.body.error.code).toBe('conflict');
      expect((await agent.get(`/api/v1/recipes/${recipe.id}/logs`).expect(200)).body.items[0].canRate).toBe(false);
    });

    it('supprime une réalisation sans décrément, refuse celles qui en ont un', async () => {
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }]);
      const sans = await logCooked(agent, recipe.id);
      await agent.delete(`/api/v1/recipe-logs/${sans.id}`).expect(204);

      // POST /recipes/{id}/cook n'existe pas encore (tâche 10, qui s'exécute après celle-ci) :
      // on simule directement un journal avec décrément pour vérifier le refus de suppression ;
      // la tâche 10 exercera ensuite le vrai parcours de cuisson sur ce même cas.
      const avec = await t.prisma.recipeLog.create({ data: { recipeId: recipe.id, servingsCooked: 4, stockApplied: true } });
      const refus = await agent.delete(`/api/v1/recipe-logs/${avec.id}`).expect(409);
      expect(refus.body.error.message).toContain('correction');
    });

    it('la suppression d’un compte emporte ses notes sans fausser la moyenne', async () => {
      const recipe = await createRecipe(agent, 'Dahl', []);
      const log = await logCooked(agent, recipe.id);
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
      const marieId = (
        await agent.post('/api/v1/users').send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201)
      ).body.id;
      await t.prisma.recipeRating.create({ data: { recipeLogId: log.id, userId: marieId, stars: 1 } });
      expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats.averageRating).toBe(3);

      await t.prisma.user.delete({ where: { id: marieId } });
      expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.stats).toMatchObject({ averageRating: 5, ratingCount: 1 });
    });
  });
});
