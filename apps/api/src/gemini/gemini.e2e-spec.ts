import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp, json, TINY_PNG } from '../../test/fake-http.js';
import { GeminiService } from './gemini.service.js';

const ADMIN = { email: 'admin@example.org', name: 'Admin' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre' };
const GEN = ['generateContent'];
const LIST = {
  models: [
    ...['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-pro', 'gemini-flash-latest', 'gemini-3.8-flash-preview-09-2026'].map((m) => ({
      name: `models/${m}`,
      supportedGenerationMethods: GEN,
    })),
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ],
};
const ticket = () =>
  json({
    candidates: [{ content: { parts: [{ text: '[{"label":"RIZ","quantity":1,"kind":"PRODUCT"}]' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 70 },
  });
const quota429 = (quotaId: string, retryDelay?: string) =>
  json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId }] }, ...(retryDelay ? [{ retryDelay }] : [])] } }, 429);
const modelOf = (url: string) => /models\/([^:]+):generateContent/.exec(url)?.[1];

/**
 * Point de passage unique vers Gemini (approche de Ma Cave, 2026-10-22) :
 * liste en direct de Google, quotas vérifiés avant l'appel, bascule de modèle,
 * pause commune après 429/503, journal. Joué par la lecture de ticket, le plus
 * simple des quatre usages — tous passent par le même `GeminiService`.
 */
describe('Gemini : modèles, quotas, pause et journal', () => {
  let t: TestApp;
  let agent: TestAgent;
  let gemini: GeminiService;
  const http = new FakeHttp();
  let locationId: string;
  const upload = () => agent.post('/api/v1/receipts').attach('file', TINY_PNG, { filename: 'ticket', contentType: 'image/png' }).field('locationId', locationId);

  beforeAll(async () => {
    t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'test-key', GEMINI_RPM: '5', GEMINI_RPD: '20' }, http.client);
    gemini = t.app.get(GeminiService);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    http.on('/v1beta/models?', () => json(LIST));
    agent = t.agent();
    await t.signIn(agent, ADMIN);
    locationId = (await t.prisma.location.findFirstOrThrow()).id;
  });
  afterAll(() => t.close());

  it('n’emploie que les Flash et Flash-Lite stables, du plus récent au plus ancien', async () => {
    const res = await agent.get('/api/v1/settings/gemini').expect(200);
    expect(res.body.models.map((m: { model: string }) => m.model)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    expect(res.body.current).toBe('gemini-3.8-flash');
    expect(res.body.models[0].limits).toEqual({ rpm: 5, tpm: 250_000, rpd: 20 });

    http.on('generateContent', ticket);
    await upload().expect(201);
    expect(modelOf(http.calls[0]!.url)).toBe('gemini-3.8-flash');
  });

  it('journalise chaque requête envoyée, avec ses jetons, et la compte au modèle', async () => {
    http.on('generateContent', ticket);
    await upload().expect(201);
    const calls = await t.prisma.geminiCall.findMany();
    expect(calls).toMatchObject([{ model: 'gemini-3.8-flash', httpStatus: 200, tokens: 970 }]);
    const status = (await agent.get('/api/v1/settings/gemini').expect(200)).body;
    expect(status.models[0]).toMatchObject({ dayRequests: 1, minuteRequests: 1, minuteTokens: 970 });
  });

  it('bascule sur le modèle suivant quand le quota du jour est atteint, sans rien envoyer au premier', async () => {
    await agent.put('/api/v1/settings/gemini/limits').send({ model: 'gemini-3.8-flash', rpm: 5, tpm: 250_000, rpd: 1 }).expect(200);
    http.on('generateContent', ticket);
    await upload().expect(201);
    await upload().expect(201);
    expect(http.calls.map((c) => modelOf(c.url))).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  });

  it('tous les modèles arrêtés : 429 avec l’heure de reprise, sans appel', async () => {
    for (const model of ['gemini-3.8-flash', 'gemini-3.5-flash-lite']) {
      await agent.put('/api/v1/settings/gemini/limits').send({ model, rpm: 1, tpm: 250_000, rpd: 20 }).expect(200);
    }
    http.on('generateContent', ticket);
    await upload().expect(201);
    await upload().expect(201);
    const res = await upload().expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.body.error.message).toMatch(/^Limite de 1 requête par minute atteinte : reprise à \d\d:\d\d\.$/);
    expect(res.body.error.details.retryAt).toEqual(expect.any(String));
    expect(http.calls).toHaveLength(2);
  });

  it('429 journalier de Google : le modèle est épuisé jusqu’à minuit du Pacifique et la même demande bascule', async () => {
    http.on('gemini-3.8-flash:generateContent', () => quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
    http.on('gemini-3.5-flash-lite:generateContent', ticket);
    await upload().expect(201);
    expect(http.calls.map((c) => modelOf(c.url))).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    const status = (await agent.get('/api/v1/settings/gemini').expect(200)).body;
    expect(status.pause).toBeNull();
    expect(status.current).toBe('gemini-3.5-flash-lite');
    expect(status.models[0].blockedUntil).toBe(status.dayResetsAt);
  });

  it('429 par minute de Google : pause commune de la durée annoncée, aucun appel pendant la pause', async () => {
    http.on('generateContent', () => quota429('GenerateRequestsPerMinutePerProjectPerModel', '37s'));
    const res = await upload().expect(429);
    expect(res.body.error.message).toMatch(/^Gemini est en pause \(quota dépassé chez Google\) : reprise à \d\d:\d\d\.$/);
    const retryAt = new Date(res.body.error.details.retryAt).getTime();
    expect(retryAt - Date.now()).toBeGreaterThan(30_000);
    expect(retryAt - Date.now()).toBeLessThanOrEqual(38_000);

    await upload().expect(429);
    expect(http.calls).toHaveLength(1);
    expect(await t.prisma.geminiCall.findMany()).toMatchObject([{ httpStatus: 429 }]);
    // Survit au redémarrage : la pause est en base.
    gemini.forget();
    await gemini.onModuleInit();
    expect((await agent.get('/api/v1/settings/gemini').expect(200)).body.pause.until).toBe(res.body.error.details.retryAt);
  });

  it('photo pendant la pause : 429 avec l’heure de reprise, photo conservée à identifier', async () => {
    http.on('generateContent', () => json({ error: { code: 503 } }, 503));
    await upload().expect(429);
    const res = await agent.post('/api/v1/scan/image').attach('image', TINY_PNG, 'photo.png').expect(429);
    expect(res.body.error.message).toMatch(/^Gemini est en pause/);
    expect(res.body.error.details.imagePath).toEqual(expect.any(String));
    expect(http.calls).toHaveLength(1);
  });

  it('503 : pause commune de cinq minutes', async () => {
    http.on('generateContent', () => json({ error: { code: 503 } }, 503));
    const first = await upload().expect(429);
    expect(first.body.error.message).toContain('service saturé');
    const until = new Date(first.body.error.details.retryAt).getTime() - Date.now();
    expect(until).toBeGreaterThan(4 * 60_000);
  });

  it('repart du journal au redémarrage : le quota du jour n’est pas remis à zéro', async () => {
    await agent.put('/api/v1/settings/gemini/limits').send({ model: 'gemini-3.8-flash', rpm: 5, tpm: 250_000, rpd: 1 }).expect(200);
    await t.prisma.geminiCall.create({ data: { model: 'gemini-3.8-flash', httpStatus: 200, durationMs: 10 } });
    gemini.forget();
    await gemini.onModuleInit();
    const status = (await agent.get('/api/v1/settings/gemini').expect(200)).body;
    expect(status.models[0]).toMatchObject({ model: 'gemini-3.8-flash', dayRequests: 1 });
    expect(status.models[0].blockedMessage).toMatch(/^Quota Gemini du jour atteint \(1 requête\) : reprise \S+ à \d\d:\d\d\.$/);
  });

  it('liste de Google indisponible : repli sur VISION_MODEL, raison affichée', async () => {
    http.reset();
    http.on('/v1beta/models?', () => json({}, 500));
    const status = (await agent.get('/api/v1/settings/gemini').expect(200)).body;
    expect(status.models.map((m: { model: string }) => m.model)).toEqual(['gemini-3.8-flash']);
    expect(status.error).toContain('500');
  });

  it('refuse un modèle hors liste et réserve l’écran aux administrateurs', async () => {
    await agent.put('/api/v1/settings/gemini/limits').send({ model: 'gemini-3.5-pro', rpm: 5, tpm: 1000, rpd: 5 }).expect(422);
    await agent.put('/api/v1/settings/gemini/limits').send({ model: 'gemini-3.8-flash', rpm: 0, tpm: 1000, rpd: 5 }).expect(400);
    await t.addMember(agent, MEMBRE);
    const membre = t.agent();
    await t.signIn(membre, MEMBRE);
    await membre.get('/api/v1/settings/gemini').expect(403);
    await membre.put('/api/v1/settings/gemini/limits').send({ model: 'gemini-3.8-flash', rpm: 5, tpm: 1000, rpd: 5 }).expect(403);
  });
});
