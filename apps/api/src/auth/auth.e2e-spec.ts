import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { fakeGoogleCredential, type FakeIdentity } from '../../test/google-verifier.double.js';

const ADMIN: FakeIdentity = { email: 'franck@example.org', name: 'Franck', sub: 'google-franck' };
const INCONNU: FakeIdentity = { email: 'inconnu@example.org', name: 'Inconnu', sub: 'google-inconnu' };

const google = (t: TestApp, identity: FakeIdentity) =>
  t.api.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(identity) });

describe('connexion par compte Google', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('signale qu’une installation est requise tant qu’aucun compte n’existe', async () => {
    const res = await t.api.get('/api/v1/auth/status').expect(200);
    expect(res.body).toEqual({ setupRequired: true });
  });

  it('la première connexion crée l’administrateur, ouvre une session et pose les emplacements par défaut', async () => {
    const agent = t.agent();
    const res = await agent.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(ADMIN) }).expect(200);
    expect(res.body).toMatchObject({ email: ADMIN.email, name: 'Franck', role: 'ADMIN' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^sid=.*HttpOnly/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/);

    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
    expect((await t.api.get('/api/v1/auth/status')).body).toEqual({ setupRequired: false });

    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user).toMatchObject({ status: 'ACTIVE', role: 'ADMIN', googleSub: 'google-franck', passwordHash: null });

    const locations = await t.prisma.location.findMany();
    expect(locations.map((l) => l.path).sort()).toEqual(['/cellier', '/cuisine', '/cuisine/congelateur', '/cuisine/placard', '/cuisine/refrigerateur']);
  });

  it('sur une base vide, deux connexions simultanées ne créent qu’un seul administrateur (vigilance 4)', async () => {
    const [a, b] = await Promise.all([
      google(t, ADMIN).then((r) => r.status),
      google(t, INCONNU).then((r) => r.status),
    ]);
    expect([a, b].sort()).toEqual([200, 403]);
    const users = await t.prisma.user.findMany();
    expect(users.filter((u) => u.role === 'ADMIN')).toHaveLength(1);
    expect(users.filter((u) => u.status === 'ACTIVE')).toHaveLength(1);
    expect(await t.prisma.location.count()).toBe(5);
  });

  it('une adresse inconnue crée une demande, n’ouvre aucune session, et répond comme une demande déjà en attente', async () => {
    await t.signIn(t.agent(), ADMIN);

    const agent = t.agent();
    const premiere = await agent.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(INCONNU) }).expect(403);
    expect(premiere.headers['set-cookie']).toBeUndefined();
    expect(premiere.body.error.code).toBe('forbidden');
    expect(premiere.body.error.message).toBe('Votre demande attend la validation d’un administrateur.');
    await agent.get('/api/v1/me').expect(401);

    const demande = await t.prisma.user.findUniqueOrThrow({ where: { email: INCONNU.email } });
    expect(demande).toMatchObject({ status: 'PENDING', role: 'MEMBER', passwordHash: null });

    // Même réponse, au corps près, qu'une adresse neuve : la page de connexion
    // ne doit pas servir à énumérer les adresses connues du foyer.
    const seconde = await google(t, INCONNU).expect(403);
    expect(seconde.body).toEqual(premiere.body);
    expect(await t.prisma.user.count()).toBe(2);
  });

  it('un compte PENDING n’obtient aucune session même avec un jeton valide (vigilance 1)', async () => {
    await t.signIn(t.agent(), ADMIN);
    await google(t, INCONNU).expect(403);
    await t.prisma.user.update({ where: { email: INCONNU.email }, data: { name: 'Toujours en attente' } });
    const agent = t.agent();
    await agent.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(INCONNU) }).expect(403);
    await agent.get('/api/v1/me').expect(401);
    expect(await t.prisma.session.count()).toBe(1); // celle de l'administrateur
  });

  it('refuse une adresse Google non vérifiée, même avec un jeton signé (vigilance 2)', async () => {
    const res = await google(t, { ...ADMIN, emailVerified: false }).expect(401);
    expect(res.body.error.message).toBe('Adresse Google non vérifiée');
    expect(await t.prisma.user.count()).toBe(0);
  });

  it('refuse un compte révoqué (vigilance 3)', async () => {
    await t.signIn(t.agent(), ADMIN);
    await google(t, INCONNU).expect(403);
    await t.prisma.user.update({ where: { email: INCONNU.email }, data: { status: 'REVOKED' } });
    const res = await google(t, INCONNU).expect(403);
    expect(res.body.error.message).toBe('Cet accès a été refusé.');
    expect(await t.prisma.session.count()).toBe(1);
  });

  it('refuse un jeton illisible', async () => {
    const res = await t.api.post('/api/v1/auth/google').send({ credential: 'pas-un-jeton' }).expect(401);
    expect(res.body.error).toEqual({ code: 'unauthenticated', message: 'Connexion Google refusée' });
    const vide = await t.api.post('/api/v1/auth/google').send({ credential: '  ' }).expect(400);
    expect(vide.body.error.code).toBe('validation_failed');
  });

  it('rattache un compte existant par son adresse et mémorise le `sub`', async () => {
    await t.signIn(t.agent(), ADMIN);
    await t.prisma.user.update({ where: { email: ADMIN.email }, data: { googleSub: null } });
    const agent = t.agent();
    await agent.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(ADMIN) }).expect(200);
    await agent.get('/api/v1/me').expect(200);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user.googleSub).toBe('google-franck');
  });

  it('une adresse changée crée une demande, sans buter sur l’unicité du `sub`', async () => {
    await t.signIn(t.agent(), ADMIN);
    const res = await google(t, { email: 'franck@autre.org', name: 'Franck', sub: 'google-franck' }).expect(403);
    expect(res.body.error.code).toBe('forbidden');
    const demande = await t.prisma.user.findUniqueOrThrow({ where: { email: 'franck@autre.org' } });
    expect(demande.status).toBe('PENDING');
    expect(demande.googleSub).toBeNull();
  });

  it('sert le Client ID à l’exécution, sans session', async () => {
    const res = await t.api.get('/api/v1/auth/google/client-id').expect(200);
    expect(res.body).toEqual({ clientId: '' });
  });

  it('la déconnexion révoque la session', async () => {
    const agent = await t.signIn(t.agent(), ADMIN);
    await agent.post('/api/v1/auth/logout').expect(204);
    const res = await agent.get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('exige une session sur les routes protégées', async () => {
    const res = await t.api.get('/api/v1/me').expect(401);
    expect(res.body.error).toEqual({ code: 'unauthenticated', message: 'Session absente ou expirée' });
  });

  it('ne stocke que le haché du jeton de session', async () => {
    const agent = t.agent();
    const res = await agent.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(ADMIN) }).expect(200);
    const rawToken = /sid=([^;]+)/.exec(res.headers['set-cookie']?.[0] ?? '')?.[1] ?? '';
    const session = await t.prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(decodeURIComponent(rawToken));
    expect(session.tokenHash).toHaveLength(64);
  });

  it('les anciennes routes de mot de passe n’existent plus', async () => {
    await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'un-mot-de-passe-long' }).expect(404);
    await t.api.post('/api/v1/auth/setup').send({ email: ADMIN.email, name: 'Franck', password: 'un-mot-de-passe-long' }).expect(404);
    const agent = await t.signIn(t.agent(), ADMIN);
    await agent.post('/api/v1/me/password').send({ currentPassword: 'x', newPassword: 'un-mot-de-passe-long' }).expect(404);
  });
});

describe('Client ID configuré', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ GOOGLE_CLIENT_ID: '1234.apps.googleusercontent.com' });
  });
  afterAll(() => t.close());

  it('rend le Client ID sur une route publique', async () => {
    const res = await t.api.get('/api/v1/auth/google/client-id').expect(200);
    expect(res.body).toEqual({ clientId: '1234.apps.googleusercontent.com' });
  });
});

describe('utilisateurs et jetons de service', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('un administrateur crée un membre, un membre ne peut pas', async () => {
    const admin = await t.signIn(t.agent(), ADMIN);
    const created = await admin
      .post('/api/v1/users')
      .send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' })
      .expect(201);
    expect(created.body).toMatchObject({ email: 'marie@example.org', role: 'MEMBER' });
    expect(created.body.passwordHash).toBeUndefined();

    const member = await t.signIn(t.agent(), { email: 'marie@example.org', name: 'Marie' });
    const forbidden = await member.post('/api/v1/users').send({ email: 'x@example.org', name: 'X', password: 'encore-un-mot-de-passe' }).expect(403);
    expect(forbidden.body.error.code).toBe('forbidden');
    const list = await member.get('/api/v1/users').expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('refuse un e-mail déjà utilisé', async () => {
    const admin = await t.signIn(t.agent(), ADMIN);
    const res = await admin.post('/api/v1/users').send({ email: ADMIN.email, name: 'Doublon', password: 'encore-un-mot-de-passe' }).expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('un jeton de service lit mais n’écrit pas', async () => {
    const admin = await t.signIn(t.agent(), ADMIN);
    const created = await admin.post('/api/v1/service-tokens').send({ name: 'Home Assistant' }).expect(201);
    expect(created.body.token).toMatch(/^kit_[0-9a-f]{48}$/);
    const list = await admin.get('/api/v1/service-tokens').expect(200);
    expect(list.body[0].token).toBeUndefined();

    const bearer = `Bearer ${created.body.token}`;
    await t.api.get('/api/v1/me').set('Authorization', bearer).expect(200);
    const write = await t.api.post('/api/v1/auth/logout').set('Authorization', bearer).expect(403);
    expect(write.body.error.message).toBe('Un jeton de service ne permet que la lecture');
    await t.api.get('/api/v1/me').set('Authorization', 'Bearer kit_faux').expect(401);

    await admin.delete(`/api/v1/service-tokens/${list.body[0].id}`).expect(204);
    await t.api.get('/api/v1/me').set('Authorization', bearer).expect(401);
  });
});
