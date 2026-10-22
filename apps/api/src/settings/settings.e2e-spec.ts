import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp } from '../../test/fake-http.js';

const ADMIN = { email: 'proprietaire@example.org', name: 'djkix' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre' };

describe('réglages : choix du modèle', () => {
  let t: TestApp;
  let agent: TestAgent;
  const http = new FakeHttp();

  beforeAll(async () => {
    t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'test-key' }, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  it('laisse la recherche web éteinte par défaut et la laisse basculer', async () => {
    const avant = await agent.get('/api/v1/settings').expect(200);
    // Éteinte par défaut depuis le 2026-10-19. Elle valait `true` au motif que
    // c'était la fonctionnalité demandée et non une option — mais la recherche
    // web de Google est facturée à la requête, hors quota gratuit, et une clé
    // sans facturation la refuse par un 429 sans consommation. Allumée sur une
    // instance non facturée, elle ne rend pas des recettes web : elle rend un
    // écran vide.
    expect(avant.body.suggestionWebSearch).toBe(false);

    await agent.patch('/api/v1/settings').send({ suggestionWebSearch: true }).expect(200);
    const apres = await agent.get('/api/v1/settings').expect(200);
    expect(apres.body.suggestionWebSearch).toBe(true);
  });

  it('refuse à un membre de changer un réglage', async () => {
    await t.addMember(agent, MEMBRE);
    const membre = t.agent();
    await t.signIn(membre, MEMBRE);
    await membre.patch('/api/v1/settings').send({ suggestionWebSearch: true }).expect(403);
  });
});
