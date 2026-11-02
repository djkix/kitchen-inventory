import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { FakeHttp } from '../../test/fake-http.js';
import { fakeSubscription, VAPID } from '../../test/push.double.js';
import { PushService } from './push.service.js';

const ADMIN = { email: 'admin@example.org', name: 'Admin' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre' };



const payload = { title: 'Prêt', body: 'Touchez pour voir.', url: '/stock', tag: 'req-1' };

describe('Web Push : abonnements et envoi', () => {
  let t: TestApp;
  let agent: TestAgent;
  let push: PushService;
  const http = new FakeHttp();

  beforeAll(async () => {
    t = await createTestApp({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:kitchen@example.org' }, http.client);
    push = t.app.get(PushService);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  it('sert la clé publique pour que le téléphone puisse s’abonner', async () => {
    const res = await agent.get('/api/v1/notifications/public-key').expect(200);
    expect(res.body).toEqual({ publicKey: VAPID.publicKey });
  });

  it('enregistre l’abonnement de l’appareil et le rattache à l’utilisateur', async () => {
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    const rows = await t.prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: 'https://push.example.org/a' });
    const admin = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(rows[0]!.userId).toBe(admin.id);
  });

  // Le navigateur rend le même abonnement à chaque ouverture : l'enregistrer
  // deux fois ne doit pas faire sonner deux fois.
  it('ne crée pas de doublon quand le même appareil se réabonne', async () => {
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    expect(await t.prisma.pushSubscription.count()).toBe(1);
  });

  it('se désabonne', async () => {
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    await agent.delete('/api/v1/notifications/subscription').send({ endpoint: 'https://push.example.org/a' }).expect(204);
    expect(await t.prisma.pushSubscription.count()).toBe(0);
  });

  it('envoie à tous les appareils de l’utilisateur, et à aucun de l’autre membre (D14)', async () => {
    const membre = await t.addMember(agent, MEMBRE);
    const sien = t.agent();
    await t.signIn(sien, MEMBRE);
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/b')).expect(204);
    await sien.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/autre')).expect(204);

    http.on('push.example.org', () => new Response(null, { status: 201 }));
    const admin = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    await push.sendToUser(admin.id, payload);

    expect(http.calls.map((c) => c.url).sort()).toEqual(['https://push.example.org/a', 'https://push.example.org/b']);
    expect(membre.id).not.toBe(admin.id);
  });

  // Point de vigilance 2 : un abonnement périmé ne doit pas empêcher les
  // autres appareils d'être prévenus, et il doit disparaître de la base.
  it('supprime un abonnement refusé (410) et prévient quand même les autres', async () => {
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/mort')).expect(204);
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/vivant')).expect(204);
    http.on('/mort', () => new Response(null, { status: 410 }));
    http.on('/vivant', () => new Response(null, { status: 201 }));

    const admin = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    await push.sendToUser(admin.id, payload);

    const rows = await t.prisma.pushSubscription.findMany();
    expect(rows.map((r) => r.endpoint)).toEqual(['https://push.example.org/vivant']);
  });

  it('ne lève pas quand le service de push est injoignable', async () => {
    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    http.fail('push.example.org');
    const admin = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    await expect(push.sendToUser(admin.id, payload)).resolves.toBeUndefined();
    expect(await t.prisma.pushSubscription.count()).toBe(1);
  });
});

describe('Web Push sans clés VAPID : tout marche, rien n’est annoncé (D11)', () => {
  let t: TestApp;
  const http = new FakeHttp();

  beforeAll(async () => {
    t = await createTestApp({}, http.client);
  });
  afterAll(() => t.close());

  it('ne rend aucune clé publique et n’envoie rien', async () => {
    const agent = t.agent();
    await t.signIn(agent, ADMIN);
    const res = await agent.get('/api/v1/notifications/public-key').expect(200);
    expect(res.body).toEqual({ publicKey: null });

    await agent.post('/api/v1/notifications/subscription').send(fakeSubscription('https://push.example.org/a')).expect(204);
    const admin = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    await expect(t.app.get(PushService).sendToUser(admin.id, payload)).resolves.toBeUndefined();
    expect(http.calls).toHaveLength(0);
  });
});
