import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp, json } from '../../test/fake-http.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre', password: 'un-autre-mot-de-passe' };

const LIST_MODELS = {
  models: [
    { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-lite', displayName: 'Flash-Lite', supportedGenerationMethods: ['generateContent'] },
  ],
};

/**
 * Choix du modèle depuis les réglages (demandé par Franck le 2026-10-06, après
 * la panne des suggestions). Deux invariants tiennent tout le reste : la
 * précédence base > environnement > défaut, et le fait que le modèle soit relu
 * à chaque appel — un réglage changé à l'écran ne doit pas attendre un
 * redémarrage du conteneur.
 */
describe('réglages : choix du modèle', () => {
  let t: TestApp;
  let agent: TestAgent;
  const http = new FakeHttp();

  beforeAll(async () => {
    http.on('/v1beta/models', () => json(LIST_MODELS));
    t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'test-key', SUGGESTION_MODEL: 'depuis-env' }, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });
  afterAll(() => t.close());

  it('se rabat sur la variable d’environnement tant que rien n’est choisi', async () => {
    const res = await agent.get('/api/v1/settings').expect(200);
    expect(res.body.suggestionModel).toBe('depuis-env');
    // `VISION_MODEL` n'est pas posé dans cette instance : le réglage reste absent
    // et le fournisseur appliquera son propre défaut.
    expect(res.body.visionModel).toBeUndefined();
  });

  it('fait primer la valeur enregistrée sur l’environnement', async () => {
    await agent.patch('/api/v1/settings').send({ suggestionModel: 'gemini-3.5-flash' }).expect(200);
    const res = await agent.get('/api/v1/settings').expect(200);
    expect(res.body.suggestionModel).toBe('gemini-3.5-flash');
  });

  it('rend la main à l’environnement quand le choix est effacé', async () => {
    await agent.patch('/api/v1/settings').send({ suggestionModel: 'gemini-3.5-flash' }).expect(200);
    await agent.patch('/api/v1/settings').send({ suggestionModel: '' }).expect(200);
    const res = await agent.get('/api/v1/settings').expect(200);
    // Sans ce repli, un réglage posé une fois ne pourrait plus être annulé
    // depuis l'application : la chaîne vide masquerait le `.env` à jamais.
    expect(res.body.suggestionModel).toBe('depuis-env');
  });

  it('active la recherche web par défaut et la laisse basculer', async () => {
    const avant = await agent.get('/api/v1/settings').expect(200);
    // Par défaut activée : c'est la fonctionnalité demandée (« des recettes
    // trouvées sur internet »), pas une option à activer soi-même.
    expect(avant.body.suggestionWebSearch).toBe(true);

    await agent.patch('/api/v1/settings').send({ suggestionWebSearch: false }).expect(200);
    const apres = await agent.get('/api/v1/settings').expect(200);
    expect(apres.body.suggestionWebSearch).toBe(false);
  });

  it('liste les modèles servis par la clé, aux admins seulement', async () => {
    const res = await agent.get('/api/v1/settings/models').expect(200);
    expect(res.body.models.map((m: { id: string }) => m.id)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);

    await agent.post('/api/v1/users').send(MEMBRE).expect(201);
    const membre = t.agent();
    await membre.post('/api/v1/auth/login').send({ email: MEMBRE.email, password: MEMBRE.password }).expect(204);
    await membre.get('/api/v1/settings/models').expect(403);
  });

  it('refuse à un membre de changer le modèle', async () => {
    await agent.post('/api/v1/users').send(MEMBRE).expect(201);
    const membre = t.agent();
    await membre.post('/api/v1/auth/login').send({ email: MEMBRE.email, password: MEMBRE.password }).expect(204);
    await membre.patch('/api/v1/settings').send({ suggestionModel: 'gemini-3.5-flash' }).expect(403);
  });
});
