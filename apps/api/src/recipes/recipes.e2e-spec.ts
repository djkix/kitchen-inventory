import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { createProduct, createRecipe } from './recipes.test-helpers.js';

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
});
