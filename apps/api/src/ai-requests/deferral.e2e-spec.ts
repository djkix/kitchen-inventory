import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp, json, TINY_PNG } from '../../test/fake-http.js';
import { fakeSubscription, VAPID } from '../../test/push.double.js';
import { GeminiService } from '../gemini/gemini.service.js';
import { DeferralService } from './deferral.service.js';

const ADMIN = { email: 'proprietaire@example.org', name: 'Camille' };
const ENDPOINT = 'https://push.example.org/a';


/** 429 de Google qui pose la pause commune, avec la durée annoncée. */
const pause429 = (retryDelay: string) =>
  json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }, { retryDelay }] } }, 429);

const ticket = () =>
  json({
    candidates: [{ content: { role: 'model', parts: [{ text: '[{"label":"RIZ","quantity":1,"kind":"PRODUCT"}]' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 70 },
  });

describe('Demandes différées : rejouées à la reprise, annoncées à l’arrivée', () => {
  let t: TestApp;
  let agent: TestAgent;
  let deferral: DeferralService;
  let locationId: string;
  const http = new FakeHttp();
  const REQ = '66666666-6666-4666-8666-66666666666';

  beforeAll(async () => {
    t = await createTestApp(
      { VISION_PROVIDER: 'gemini', VISION_API_KEY: 'AIza-test', VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey },
      http.client,
    );
    deferral = t.app.get(DeferralService);
  });
  beforeEach(async () => {
    await t.reset();
    t.app.get(GeminiService).forget();
    t.app.get(GeminiService).now = () => new Date();
    http.reset();
    http.on('push.example.org', () => new Response(null, { status: 201 }));
    agent = t.agent();
    await t.signIn(agent, ADMIN);
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription(ENDPOINT)).expect(204);
    locationId = (await t.prisma.location.findFirstOrThrow()).id;
  });
  afterAll(() => t.close());

  const upload = (id: string) =>
    agent.post('/api/v1/receipts').attach('file', TINY_PNG, { filename: 'ticket', contentType: 'image/png' }).field('locationId', locationId).field('requestId', id);

  const pushes = () => http.calls.filter((c) => c.url.includes('push.example.org'));

  it('diffère une demande refusée pour une pause courte, et le dit à l’écran', async () => {
    http.on('generateContent', () => pause429('1200s'));
    const res = await upload(REQ + '1').expect(429);
    expect(res.body.error.details.deferred).toBe(true);
    expect(res.body.error.details.retryAt).toEqual(expect.any(String));

    const row = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '1' } });
    expect(row.state).toBe('DEFERRED');
    expect(row.inputPath).toMatch(/^differe\//);
    expect(pushes()).toHaveLength(0);
  });

  it('rejoue à l’heure dite, annonce le résultat bien que l’écran n’ait pas été quitté (D1b), et efface l’entrée', async () => {
    http.on('generateContent', () => pause429('1200s'));
    await upload(REQ + '2').expect(429);
    const differee = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '2' } });

    http.reset();
    http.on('push.example.org', () => new Response(null, { status: 201 }));
    http.on('generateContent', ticket);
    // Le temps passe pour tout le monde : sans avancer l'horloge de
    // `GeminiService`, la pause commune qu'il vient de poser refuserait le
    // rejeu avant même de partir.
    const apres = new Date(differee.retryAt!.getTime() + 1000);
    t.app.get(GeminiService).now = () => apres;
    await deferral.replayDue(apres);

    const row = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '2' } });
    expect(row.state).toBe('DONE');
    expect(row.leftScreen).toBe(false);
    expect(row.inputPath).toBeNull();
    expect(pushes()).toHaveLength(1);
  });

  // D6 : la reprise au-delà d'une heure — un quota du jour, par exemple — ne
  // vaut pas la peine d'être attendue. Abandon tout de suite.
  it('n’attend pas une reprise au-delà d’une heure : refus immédiat, aucune ligne différée', async () => {
    http.on('generateContent', () => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, 429));
    const res = await upload(REQ + '3').expect(429);
    expect(res.body.error.details.deferred).toBeUndefined();
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '3' } })).state).toBe('FAILED');
  });

  // Point de vigilance 1 (D15) : réappuyer ne doit pas faire deux appels payés
  // ni deux notifications pour une seule envie.
  it('une nouvelle demande du même usage remplace la précédente, sans l’annoncer', async () => {
    http.on('generateContent', () => pause429('1200s'));
    await upload(REQ + '4').expect(429);
    const premiere = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '4' } });
    await upload(REQ + '5').expect(429);

    const remplacee = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '4' } });
    expect(remplacee.state).toBe('ABANDONED');
    expect(remplacee.inputPath).toBeNull();
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '5' } })).state).toBe('DEFERRED');
    expect(pushes()).toHaveLength(0);
    expect(premiere.inputPath).not.toBeNull();
  });

  // Point de vigilance 5 (D13) : le quota a pu être épuisé entre-temps par
  // l'autre membre du foyer. Abandon annoncé, jamais un second différé.
  it('abandonne et annonce quand le rejeu échoue encore', async () => {
    http.on('generateContent', () => pause429('1200s'));
    await upload(REQ + '6').expect(429);
    const differee = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '6' } });

    await deferral.replayDue(new Date(differee.retryAt!.getTime() + 1000));

    const row = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '6' } });
    expect(row.state).toBe('ABANDONED');
    expect(row.inputPath).toBeNull();
    expect(pushes()).toHaveLength(1);
  });

  // Point de vigilance 4 (D12) : un redémarrage du conteneur laisse des lignes
  // « en cours » que plus personne ne mène à bien.
  it('clôt les demandes en cours orphelines d’un redémarrage, et n’annonce que celles qu’on attendait', async () => {
    const userId = (await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } })).id;
    await t.prisma.aiRequest.create({ data: { id: REQ + '7', userId, kind: 'RECEIPT', state: 'RUNNING', leftScreen: true } });
    await t.prisma.aiRequest.create({ data: { id: REQ + '8', userId, kind: 'VOICE', state: 'RUNNING', leftScreen: false } });

    await deferral.closeOrphans();

    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '7' } })).state).toBe('FAILED');
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '8' } })).state).toBe('FAILED');
    expect(pushes()).toHaveLength(1);
  });

  it('ne rejoue rien avant l’heure', async () => {
    http.on('generateContent', () => pause429('1200s'));
    await upload(REQ + '9').expect(429);
    const avant = http.calls.length;
    await deferral.replayDue(new Date());
    expect(http.calls).toHaveLength(avant);
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: REQ + '9' } })).state).toBe('DEFERRED');
  });
});
