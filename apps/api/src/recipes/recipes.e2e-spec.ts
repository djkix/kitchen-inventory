import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { cookRecipe, createLoggedInMember, createProduct, createRecipe, createStock, isoIn, logCooked } from './recipes.test-helpers.js';

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
    // Aucun stock pour ce produit : la ligne ressort manquante (tâche 9), pas « untracked ».
    expect(res.body.ingredients[0]).toMatchObject({ label: 'Nouilles', productId: nouillesId, state: 'missing', candidates: [] });
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

      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      const avec = await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      const refus = await agent.delete(`/api/v1/recipe-logs/${avec.logId}`).expect(409);
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

    describe('rappel de notation (EF-28)', () => {
      it('ne renvoie rien sans réalisation en attente', async () => {
        const res = await agent.get('/api/v1/recipe-logs/pending-rating').expect(200);
        expect(res.body.pending).toBeNull();
      });

      it('renvoie la réalisation récente non notée par l’utilisateur courant', async () => {
        const recipe = await createRecipe(agent, 'Dahl', []);
        const log = await logCooked(agent, recipe.id);
        const res = await agent.get('/api/v1/recipe-logs/pending-rating').expect(200);
        expect(res.body.pending).toMatchObject({ logId: log.id, recipeId: recipe.id, recipeTitle: 'Dahl' });
      });

      it('ne renvoie plus une réalisation déjà notée par l’utilisateur courant', async () => {
        const recipe = await createRecipe(agent, 'Dahl', []);
        const log = await logCooked(agent, recipe.id);
        await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 4 }).expect(200);
        const res = await agent.get('/api/v1/recipe-logs/pending-rating').expect(200);
        expect(res.body.pending).toBeNull();
      });

      it('ignore une réalisation hors fenêtre de sept jours', async () => {
        const recipe = await createRecipe(agent, 'Dahl', []);
        const log = await logCooked(agent, recipe.id);
        await t.prisma.recipeLog.update({ where: { id: log.id }, data: { cookedAt: new Date(Date.now() - 8 * 86_400_000) } });
        const res = await agent.get('/api/v1/recipe-logs/pending-rating').expect(200);
        expect(res.body.pending).toBeNull();
      });

      it('exclut une réalisation dont la recette a depuis été archivée', async () => {
        const recipe = await createRecipe(agent, 'Dahl', []);
        await logCooked(agent, recipe.id);
        await agent.post(`/api/v1/recipes/${recipe.id}/archive`).expect(200);
        const res = await agent.get('/api/v1/recipe-logs/pending-rating').expect(200);
        expect(res.body.pending).toBeNull();
      });

      it('reste en attente même notée par un autre membre : une note est propre à chacun', async () => {
        const recipe = await createRecipe(agent, 'Dahl', []);
        const log = await logCooked(agent, recipe.id);
        const marie = await createLoggedInMember(t, agent);
        await marie.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 3 }).expect(200);

        const res = await agent.get('/api/v1/recipe-logs/pending-rating').expect(200);
        expect(res.body.pending).toMatchObject({ logId: log.id, recipeId: recipe.id });
      });
    });
  });

  describe('cuisson et décrément (EF-18)', () => {
    let rizId: string;
    let placardId: string;
    let epicerieId: string;

    beforeEach(async () => {
      rizId = await createProduct(agent, { name: 'Riz', defaultUnit: 'GRAM' });
      placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
      epicerieId = (await t.prisma.category.findFirstOrThrow({ where: { name: 'Épicerie sèche' } })).id;
    });

    it('met à l’échelle une seule fois, côté serveur (A14)', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      const res = await cookRecipe(agent, recipe.id, { servingsCooked: 2, lines: [{ ingredientId: recipe.ingredients[0]!.id }], stars: 4 });
      expect(res.lines[0]).toMatchObject({ requested: 100, applied: 100, capped: false });
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(900);
      const log = await t.prisma.recipeLog.findUniqueOrThrow({ where: { id: res.logId }, include: { ratings: true } });
      expect(log).toMatchObject({ servingsCooked: 2, stockApplied: true });
      expect(log.ratings[0]).toMatchObject({ stars: 4 });
    });

    it('n’émet aucun mouvement pour une ligne décochée, sans quantité, ou hors inventaire (A17)', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [
        { label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' },
        { productId: rizId, label: 'Riz à l’œil' },
        { label: 'Sel' },
      ]);
      await cookRecipe(agent, recipe.id, {
        servingsCooked: 4,
        // L'ordre renvoyé par Prisma n'est pas garanti : on cible explicitement les deux
        // lignes sans quantité, plutôt que de supposer leur position dans le tableau.
        lines: recipe.ingredients.filter((i) => i.quantity === null).map((i) => ({ ingredientId: i.id })),
      });
      expect(await t.prisma.stockMovement.count({ where: { type: 'RECIPE' } })).toBe(0);
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1000);
    });

    it('décrémente en fraction de paquet, sans arrondi (A16)', async () => {
      const paquets = await createProduct(agent, { name: 'Pâtes', defaultUnit: 'PACK' });
      await t.prisma.product.update({ where: { id: paquets }, data: { netContent: 500, netContentUnit: 'GRAM' } });
      await createStock(agent, { productId: paquets, locationId: placardId, quantity: 2, unit: 'PACK' });
      const recipe = await createRecipe(agent, 'Pâtes', [{ label: 'Pâtes', productId: paquets, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      const res = await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      // Le décrément du lot se fait bien en paquets (ci-dessous), mais la réponse exprime
      // `applied`/`unit` dans l'unité de l'ingrédient (ici des grammes), jamais celle du lot.
      expect(res.lines[0]).toMatchObject({ applied: 200, unit: 'GRAM' });
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(1.6);
    });

    it('rend un applied/unit cohérents quand un ingrédient est servi par des lots d’unités différentes', async () => {
      const proche = await createStock(agent, { productId: rizId, locationId: placardId, quantity: 500, unit: 'GRAM', expiryDate: isoIn(3), dateType: 'USE_BY' });
      const loin = await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1, unit: 'KILOGRAM', expiryDate: isoIn(90), dateType: 'USE_BY' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 1200, unit: 'GRAM' }], { servings: 1 });
      const body = { servingsCooked: 1, lines: [{ ingredientId: recipe.ingredients[0]!.id }], clientOpId: 'op-lots-mixtes-0001' };

      const res = await cookRecipe(agent, recipe.id, body);
      expect(res.lines[0]).toMatchObject({ requested: 1200, applied: 1200, unit: 'GRAM', capped: false });
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: proche } })).quantity.toNumber()).toBe(0);
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: loin } })).quantity.toNumber()).toBe(0.3);

      const replay = await cookRecipe(agent, recipe.id, body);
      expect(replay).toEqual(res);
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: loin } })).quantity.toNumber()).toBe(0.3);
    });

    it('plafonne au stock disponible et le signale', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 150, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 2 });
      const res = await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      expect(res.lines[0]).toMatchObject({ requested: 400, applied: 150, capped: true });
      expect(res.message).toContain('ramenée');
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(0);
    });

    it('plafonne la seconde ligne quand deux lignes visent le même produit (A9)', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 300, unit: 'GRAM' });
      const recipe = await createRecipe(
        agent,
        'Riz deux fois',
        [
          { label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' },
          { label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' },
        ],
        { servings: 4 },
      );
      // Les deux lignes paraissaient disponibles : elles sont évaluées séparément.
      expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.group).toBe('ready');
      const res = await cookRecipe(agent, recipe.id, {
        servingsCooked: 4,
        lines: recipe.ingredients.map((i) => ({ ingredientId: i.id })),
      });
      expect(res.lines.map((l) => [l.applied, l.capped])).toEqual([
        [200, false],
        [100, true],
      ]);
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(0);
    });

    it('prend d’abord les lots dont la date est la plus proche', async () => {
      const proche = await createStock(agent, { productId: rizId, locationId: placardId, quantity: 300, unit: 'GRAM', expiryDate: isoIn(3), dateType: 'USE_BY' });
      const loin = await createStock(agent, { productId: rizId, locationId: placardId, quantity: 300, unit: 'GRAM', expiryDate: isoIn(90), dateType: 'USE_BY' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: proche } })).quantity.toNumber()).toBe(100);
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: loin } })).quantity.toNumber()).toBe(300);
    });

    it('décrémente le produit choisi pour une ligne substituable (A15)', async () => {
      const autre = await createProduct(agent, { name: 'Riz rond', defaultUnit: 'GRAM', categoryId: epicerieId });
      await createStock(agent, { productId: autre, locationId: placardId, quantity: 500, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM', substitutable: true }], { servings: 4 });
      await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id, productId: autre }] });
      expect((await t.prisma.stockItem.findFirstOrThrow({ where: { productId: autre } })).quantity.toNumber()).toBe(300);
    });

    it('rejoue une cuisson sans doubler le décrément', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      const body = { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }], clientOpId: 'op-cuisson-0001' };
      await cookRecipe(agent, recipe.id, body);
      await cookRecipe(agent, recipe.id, body);
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(800);
      expect(await t.prisma.recipeLog.count()).toBe(1);
    });

    it('exclut un lot dont la DLC est dépassée au lieu de le vider en premier (défaut 2)', async () => {
      const perime = await createStock(agent, { productId: rizId, locationId: placardId, quantity: 300, unit: 'GRAM', expiryDate: isoIn(-1), dateType: 'USE_BY' });
      const frais = await createStock(agent, { productId: rizId, locationId: placardId, quantity: 300, unit: 'GRAM', expiryDate: isoIn(5), dateType: 'USE_BY' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      const res = await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      expect(res.lines[0]).toMatchObject({ applied: 200, capped: false });
      // Le lot périmé reste intact : seul le lot encore bon a été entamé.
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: perime } })).quantity.toNumber()).toBe(300);
      expect((await t.prisma.stockItem.findUniqueOrThrow({ where: { id: frais } })).quantity.toNumber()).toBe(100);
    });

    it('suit la fusion de produits à la cuisson, pas seulement sur la fiche (défaut 3)', async () => {
      const ancienId = await createProduct(agent, { name: 'Lait de soja ancien' });
      const cibleId = await createProduct(agent, { name: 'Lait de soja', defaultUnit: 'MILLILITER' });
      const recipe = await createRecipe(agent, 'Soja', [{ label: 'Lait de soja', productId: ancienId, quantity: 100, unit: 'MILLILITER' }]);
      await agent.post(`/api/v1/products/${ancienId}/merge`).send({ targetId: cibleId }).expect(200);
      await createStock(agent, { productId: cibleId, locationId: placardId, quantity: 500, unit: 'MILLILITER' });

      const res = await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      expect(res.lines[0]).toMatchObject({ applied: 100, capped: false });
      expect((await t.prisma.stockItem.findFirstOrThrow({ where: { productId: cibleId } })).quantity.toNumber()).toBe(400);
    });

    it('rattrape via la contrainte d’unicité deux cuissons concurrentes sur le même clientOpId (course, idempotence)', async () => {
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      const body = { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }], clientOpId: 'op-course-0001' };
      // Deux requêtes envoyées en parallèle : l'une des deux peut passer la vérification
      // préalable (clientOpId pas encore vu) avant que l'autre n'ait inséré son journal —
      // la contrainte d'unicité doit alors rattraper un 500, pas le laisser remonter.
      const [a, b] = await Promise.all([
        agent.post(`/api/v1/recipes/${recipe.id}/cook`).send(body),
        agent.post(`/api/v1/recipes/${recipe.id}/cook`).send(body),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(await t.prisma.recipeLog.count()).toBe(1);
      expect((await t.prisma.stockItem.findFirstOrThrow()).quantity.toNumber()).toBe(800);
    });

    it('refuse de cuisiner une recette archivée (409)', async () => {
      const recipe = await createRecipe(agent, 'Archivée', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }]);
      await agent.post(`/api/v1/recipes/${recipe.id}/archive`).expect(200);
      const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 4, lines: [] });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('archivée');
    });

    it('signale `capped` plutôt que de décrémenter en silence une ligne catégorie sans produit choisi (défaut 1)', async () => {
      const recipe = await createRecipe(agent, 'Gratin', [{ label: 'Fromage râpé', categoryId: epicerieId, quantity: 100, unit: 'GRAM' }]);
      const res = await cookRecipe(agent, recipe.id, { servingsCooked: 4, lines: [{ ingredientId: recipe.ingredients[0]!.id }] });
      expect(res.lines[0]).toMatchObject({ requested: 100, applied: 0, capped: true });
      expect(await t.prisma.stockMovement.count({ where: { type: 'RECIPE' } })).toBe(0);
    });

    it('refuse un identifiant d’ingrédient inconnu', async () => {
      const recipe = await createRecipe(agent, 'Riz', [{ label: 'Riz', productId: rizId, quantity: 200, unit: 'GRAM' }], { servings: 4 });
      const res = await agent.post(`/api/v1/recipes/${recipe.id}/cook`).send({ servingsCooked: 4, lines: [{ ingredientId: 'inconnu' }] });
      expect(res.status).toBe(404);
    });
  });

  describe('liste, couverture et tri (EF-17, EF-23, EF-27)', () => {
    let rizId: string;
    let cremeId: string;
    let placardId: string;

    beforeEach(async () => {
      rizId = await createProduct(agent, { name: 'Riz', defaultUnit: 'GRAM' });
      cremeId = await createProduct(agent, { name: 'Crème fraîche', defaultUnit: 'MILLILITER' });
      placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
    });

    it('trouve un titre accentué depuis une recherche sans accent (A22)', async () => {
      await createRecipe(agent, 'Crêpes', []);
      await createRecipe(agent, 'Gratin dauphinois', []);
      const res = await agent.get('/api/v1/recipes?q=crepes').expect(200);
      expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Crêpes']);
    });

    it('trie par note par défaut, sans que le stock intervienne (A27)', async () => {
      const absentId = await createProduct(agent, { name: 'Sans stock' });
      const bonne = await createRecipe(agent, 'Bien notée', [{ label: 'Sans stock', productId: absentId, quantity: 100, unit: 'GRAM' }]);
      await createRecipe(agent, 'Jamais notée', [{ label: 'Riz', productId: rizId, quantity: 100, unit: 'GRAM' }]);
      const log = await logCooked(agent, bonne.id);
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);

      const res = await agent.get('/api/v1/recipes').expect(200);
      expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Bien notée', 'Jamais notée']);
      expect(res.body.items[0]).toMatchObject({ group: 'excluded', stats: { averageRating: 5 } });
    });

    it('affiche le groupe et les manquants sur chaque carte', async () => {
      // Trois lignes suivies, une seule manquante : couverture 0,67 ≥ 0,6 (A8).
      const oignonId = await createProduct(agent, { name: 'Oignon', defaultUnit: 'GRAM' });
      await createStock(agent, { productId: rizId, locationId: placardId, quantity: 1000, unit: 'GRAM' });
      await createStock(agent, { productId: oignonId, locationId: placardId, quantity: 200, unit: 'GRAM' });
      await createRecipe(agent, 'Riz à la crème', [
        { label: 'Riz', productId: rizId, quantity: 100, unit: 'GRAM' },
        { label: 'Oignon', productId: oignonId, quantity: 50, unit: 'GRAM' },
        { label: 'Crème fraîche', productId: cremeId, quantity: 20, unit: 'MILLILITER' },
      ]);
      expect((await agent.get('/api/v1/recipes').expect(200)).body.items[0]).toMatchObject({
        group: 'almost',
        missingLabels: ['Crème fraîche'],
      });
    });

    it('exclut du calcul un lot dont la DLC est dépassée', async () => {
      await createStock(agent, { productId: cremeId, locationId: placardId, quantity: 500, unit: 'MILLILITER', expiryDate: isoIn(-2), dateType: 'USE_BY' });
      await createRecipe(agent, 'Gratin', [{ label: 'Crème fraîche', productId: cremeId, quantity: 200, unit: 'MILLILITER' }]);
      expect((await agent.get('/api/v1/recipes').expect(200)).body.items[0].group).toBe('excluded');
    });

    it('signale non vérifiable, pas manquant, quand seule une partie des lots d’un produit se convertit (EF-23)', async () => {
      // Un produit fusionné garde son unité par défaut propre (ici PIECE) ; un
      // lot peut encore être créé directement dessus après coup (l'API ne
      // bloque pas l'ancien identifiant). Une fois rattaché à la cible (GRAM),
      // ce lot ne se convertit plus, alors que le lot déjà présent sur la
      // cible, lui, se convertit mais ne suffit pas seul : la ligne ne doit
      // conclure ni `insufficient` ni `missing` sur ce total partiel.
      const ancienId = await createProduct(agent, { name: 'Œufs (ancienne fiche)', defaultUnit: 'PIECE' });
      const farineId = await createProduct(agent, { name: 'Farine', defaultUnit: 'GRAM' });
      await agent.post(`/api/v1/products/${ancienId}/merge`).send({ targetId: farineId }).expect(200);
      await createStock(agent, { productId: ancienId, locationId: placardId, quantity: 3, unit: 'PIECE' });
      await createStock(agent, { productId: farineId, locationId: placardId, quantity: 50, unit: 'GRAM' });
      const recipe = await createRecipe(agent, 'Pain', [{ label: 'Farine', productId: farineId, quantity: 200, unit: 'GRAM' }]);

      const res = await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200);
      expect(res.body.ingredients[0]).toMatchObject({ state: 'unverifiable' });
      // Non vérifiable compte comme disponible (A6, A10) : la recette reste réalisable.
      expect(res.body.group).toBe('ready');
    });

    it('suit la fusion de produits', async () => {
      const ancienId = await createProduct(agent, { name: 'Lait de soja ancien' });
      const cibleId = await createProduct(agent, { name: 'Lait de soja', defaultUnit: 'MILLILITER' });
      const recipe = await createRecipe(agent, 'Soja', [{ label: 'Lait de soja', productId: ancienId, quantity: 10, unit: 'MILLILITER' }]);
      await agent.post(`/api/v1/products/${ancienId}/merge`).send({ targetId: cibleId }).expect(200);
      await createStock(agent, { productId: cibleId, locationId: placardId, quantity: 500, unit: 'MILLILITER' });
      expect((await agent.get(`/api/v1/recipes/${recipe.id}`).expect(200)).body.group).toBe('ready');
    });

    it('applique les filtres, le temps sans le repos, et le tri demandé', async () => {
      await createRecipe(agent, 'Rapide', [], { prepMinutes: 5, cookMinutes: 5, restMinutes: 120, difficulty: 'VERY_EASY' });
      await createRecipe(agent, 'Longue', [], { prepMinutes: 60, cookMinutes: 60, difficulty: 'HARD' });

      const rapides = await agent.get('/api/v1/recipes?maxTime=20').expect(200);
      expect(rapides.body.items.every((r: { totalMinutes: number | null }) => (r.totalMinutes ?? 0) <= 20)).toBe(true);
      const faciles = await agent.get('/api/v1/recipes?difficulty=VERY_EASY').expect(200);
      expect(faciles.body.items.every((r: { difficulty: string }) => r.difficulty === 'VERY_EASY')).toBe(true);
      await agent.get('/api/v1/recipes?sort=antiWaste').expect(200);
    });

    it('exclut d’un filtre de régime les recettes qui ne le déclarent pas', async () => {
      await createRecipe(agent, 'Steak', [], { diets: [] });
      await createRecipe(agent, 'Dahl', [], { diets: ['VEGETARIAN'] });
      const res = await agent.get('/api/v1/recipes?diet=VEGETARIAN').expect(200);
      expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Dahl']);
    });

    it('filtre sur une étiquette calculée', async () => {
      const sure = await createRecipe(agent, 'Valeur sûre', []);
      await createRecipe(agent, 'Jamais faite', []);
      const log = await logCooked(agent, sure.id);
      // Deux notes d'au moins 4 : l'étiquette « valeur sûre » demande deux avis.
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
      const marie = await createLoggedInMember(t, agent, { email: 'marie@example.org' });
      await marie.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 4 }).expect(200);

      expect((await agent.get('/api/v1/recipes?tag=trusted').expect(200)).body.items.map((r: { title: string }) => r.title)).toEqual(['Valeur sûre']);
      expect((await agent.get('/api/v1/recipes?tag=never').expect(200)).body.items.map((r: { title: string }) => r.title)).toEqual(['Jamais faite']);
    });

    it('filtre sur une note minimale', async () => {
      const haute = await createRecipe(agent, 'Haute note', []);
      const log = await logCooked(agent, haute.id);
      await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars: 5 }).expect(200);
      await createRecipe(agent, 'Jamais notée', []);

      const res = await agent.get('/api/v1/recipes?minRating=4.5').expect(200);
      expect(res.body.items.every((r: { stats: { averageRating: number | null } }) => (r.stats.averageRating ?? 0) >= 4.5)).toBe(true);
      expect(res.body.items.map((r: { title: string }) => r.title)).toEqual(['Haute note']);
    });

    it('pagine après le tri, jamais avant (A18)', async () => {
      for (const [titre, stars] of [
        ['A', 2],
        ['B', 4],
        ['C', 5],
      ] as const) {
        const recipe = await createRecipe(agent, titre, []);
        const log = await logCooked(agent, recipe.id);
        await agent.put(`/api/v1/recipe-logs/${log.id}/rating`).send({ stars }).expect(200);
      }
      const page1 = await agent.get('/api/v1/recipes?limit=2&page=1').expect(200);
      const page2 = await agent.get('/api/v1/recipes?limit=2&page=2').expect(200);
      expect(page1.body.items.map((r: { title: string }) => r.title)).toEqual(['C', 'B']);
      expect(page2.body.items.map((r: { title: string }) => r.title)).toEqual(['A']);
      expect(page2.body.total).toBe(3);
    });

    it('répond sous deux secondes pour 300 recettes et 1 500 lots', async () => {
      await seedLoad(t, placardId, 300, 1500);
      const started = Date.now();
      await agent.get('/api/v1/recipes?limit=50').expect(200);
      expect(Date.now() - started).toBeLessThan(2000);
    });
  });
});

/** Sème des volumes réalistes en passant par Prisma, pour rester rapide. */
async function seedLoad(t: TestApp, placardId: string, recipes: number, lots: number): Promise<void> {
  const products = await Promise.all(
    Array.from({ length: 60 }, (_, n) => t.prisma.product.create({ data: { name: `Produit ${n}`, defaultUnit: 'GRAM' } })),
  );
  await t.prisma.stockItem.createMany({
    data: Array.from({ length: lots }, (_, n) => ({
      productId: products[n % products.length]!.id,
      locationId: placardId,
      quantity: 500,
      unit: 'GRAM',
    })),
  });
  for (let n = 0; n < recipes; n++) {
    await t.prisma.recipe.create({
      data: {
        title: `Recette ${n}`,
        difficulty: 'EASY',
        servings: 4,
        steps: ['Préparer'],
        diets: [],
        ingredients: {
          create: Array.from({ length: 8 }, (_, k) => ({
            label: `ingrédient ${k}`,
            productId: products[(n + k) % products.length]!.id,
            quantity: 100,
            unit: 'GRAM',
            essential: k < 2,
          })),
        },
      },
    });
  }
}
