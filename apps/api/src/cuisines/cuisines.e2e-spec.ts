import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('cuisines et préférences de filtres (EF-22)', () => {
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

  it('expose les douze cuisines semées, triées par nom', async () => {
    const res = await agent.get('/api/v1/cuisines').expect(200);
    expect(res.body).toHaveLength(12);
    expect(res.body[0].name).toBe('Autre');
  });

  it('refuse un doublon de cuisine à la casse et aux accents près (A22)', async () => {
    await agent.post('/api/v1/cuisines').send({ name: 'Créole' }).expect(201);
    const dup = await agent.post('/api/v1/cuisines').send({ name: 'creole' }).expect(409);
    expect(dup.body.error.code).toBe('conflict');
  });

  it('mémorise filtres et tri par utilisateur, chacun les siens', async () => {
    expect((await agent.get('/api/v1/preferences/recipe-filters').expect(200)).body).toEqual({});
    await agent.put('/api/v1/preferences/recipe-filters').send({ difficulty: ['EASY'], sort: 'antiWaste' }).expect(200);
    expect((await agent.get('/api/v1/preferences/recipe-filters').expect(200)).body).toMatchObject({ difficulty: ['EASY'], sort: 'antiWaste' });

    await agent.post('/api/v1/users').send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' }).expect(201);
    const marie = t.agent();
    await marie.post('/api/v1/auth/login').send({ email: 'marie@example.org', password: 'encore-un-mot-de-passe' }).expect(204);
    expect((await marie.get('/api/v1/preferences/recipe-filters').expect(200)).body).toEqual({});
  });

  it('refuse un filtre ou un tri inconnu', async () => {
    await agent.put('/api/v1/preferences/recipe-filters').send({ difficulty: ['IMPOSSIBLE'] }).expect(400);
    await agent.put('/api/v1/preferences/recipe-filters').send({ sort: 'aleatoire' }).expect(400);
  });
});
