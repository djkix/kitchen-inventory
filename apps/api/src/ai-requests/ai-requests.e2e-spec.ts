import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp } from '../../test/fake-http.js';
import { fakeSubscription, VAPID } from '../../test/push.double.js';
import { AiRequestService } from './ai-request.service.js';

const ADMIN = { email: 'admin@example.org', name: 'Admin' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre' };
const ENDPOINT = 'https://push.example.org/a';


describe('Demandes au modèle : la ligne qui survit à l’écran', () => {
  let t: TestApp;
  let agent: TestAgent;
  let requests: AiRequestService;
  let userId: string;
  const http = new FakeHttp();

  beforeAll(async () => {
    t = await createTestApp({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey }, http.client);
    requests = t.app.get(AiRequestService);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    http.on('push.example.org', () => new Response(null, { status: 201 }));
    agent = t.agent();
    await t.signIn(agent, ADMIN);
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription(ENDPOINT)).expect(204);
    userId = (await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } })).id;
  });
  afterAll(() => t.close());

  const id = (suffix: string) => `11111111-1111-4111-8111-11111111111${suffix}`;

  it('n’annonce rien quand on est resté devant l’écran (D1)', async () => {
    await requests.open({ id: id('1'), userId, kind: 'SUGGESTIONS' });
    await requests.succeed(id('1'), { items: [1, 2, 3] });
    expect(http.calls).toHaveLength(0);
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: id('1') } })).state).toBe('DONE');
  });

  it('annonce quand le téléphone a été posé, et une seule fois', async () => {
    await requests.open({ id: id('2'), userId, kind: 'SUGGESTIONS' });
    await agent.post(`/api/v1/ai-requests/${id('2')}/background`).expect(204);
    await requests.succeed(id('2'), { items: [1, 2, 3] });

    expect(http.calls).toHaveLength(1);
    const row = await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: id('2') } });
    expect(row.notifiedAt).not.toBeNull();

    // Une seconde clôture — un rejeu, un double appel — ne refait pas sonner.
    await requests.succeed(id('2'), { items: [1, 2, 3] });
    expect(http.calls).toHaveLength(1);
  });

  it('annonce aussi un échec, pour ne pas laisser attendre dans le vide', async () => {
    await requests.open({ id: id('3'), userId, kind: 'RECEIPT' });
    await agent.post(`/api/v1/ai-requests/${id('3')}/background`).expect(204);
    await requests.fail(id('3'), 'Le modèle n’a pas répondu.');
    expect(http.calls).toHaveLength(1);
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: id('3') } })).state).toBe('FAILED');
  });

  it('rend le résultat au retour sur l’application', async () => {
    await requests.open({ id: id('4'), userId, kind: 'VOICE' });
    await requests.succeed(id('4'), { heard: { ingredients: ['poulet'] }, items: [] });
    const res = await agent.get(`/api/v1/ai-requests/${id('4')}`).expect(200);
    expect(res.body).toMatchObject({ id: id('4'), kind: 'VOICE', state: 'DONE' });
    expect(res.body.result.heard.ingredients).toEqual(['poulet']);
  });

  // On ne révèle pas l'existence de la demande d'un autre : 404, jamais 403.
  it('rend 404 sur la demande d’un autre membre', async () => {
    await requests.open({ id: id('5'), userId, kind: 'VOICE' });
    await t.addMember(agent, MEMBRE);
    const sien = t.agent();
    await t.signIn(sien, MEMBRE);
    await sien.get(`/api/v1/ai-requests/${id('5')}`).expect(404);
    await sien.post(`/api/v1/ai-requests/${id('5')}/background`).expect(404);
  });

  // Point de vigilance 3 : le client rejoue le même identifiant après une
  // coupure réseau. Une seule ligne, et le départ de page déjà signalé tient.
  it('ne duplique pas une demande dont l’identifiant est déjà pris', async () => {
    await requests.open({ id: id('6'), userId, kind: 'SCAN_IMAGE' });
    await agent.post(`/api/v1/ai-requests/${id('6')}/background`).expect(204);
    await requests.open({ id: id('6'), userId, kind: 'SCAN_IMAGE' });

    expect(await t.prisma.aiRequest.count({ where: { id: id('6') } })).toBe(1);
    expect((await t.prisma.aiRequest.findUniqueOrThrow({ where: { id: id('6') } })).leftScreen).toBe(true);
  });

  it('rend 404 sur une demande inconnue', async () => {
    await agent.get(`/api/v1/ai-requests/${id('9')}`).expect(404);
  });
});
