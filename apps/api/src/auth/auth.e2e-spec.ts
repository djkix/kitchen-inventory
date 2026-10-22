import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { fakeGoogleCredential, type FakeIdentity } from '../../test/google-verifier.double.js';

const ADMIN: FakeIdentity = { email: 'proprietaire@example.org', name: 'djkix', sub: 'google-proprietaire' };
const INCONNU: FakeIdentity = { email: 'inconnu@example.org', name: 'Inconnu', sub: 'google-inconnu' };

const ATTENTE = 'Votre demande attend la validation d’un administrateur.';

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
    expect(res.body).toMatchObject({ email: ADMIN.email, name: 'djkix', role: 'ADMIN' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^sid=.*HttpOnly/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/);

    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
    expect((await t.api.get('/api/v1/auth/status')).body).toEqual({ setupRequired: false });

    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user).toMatchObject({ status: 'ACTIVE', role: 'ADMIN', googleSub: 'google-proprietaire', passwordHash: null });

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
    expect(premiere.body.error.message).toBe(ATTENTE);
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

  it('refuse un compte révoqué, et sans le dire (vigilance 3)', async () => {
    await t.signIn(t.agent(), ADMIN);
    const attente = await google(t, INCONNU).expect(403);
    await t.prisma.user.update({ where: { email: INCONNU.email }, data: { status: 'REVOKED' } });
    const revoque = await google(t, INCONNU).expect(403);
    // Un refus ne se distingue pas d'une attente : sinon la page de connexion
    // confirme qu'une adresse appartient au foyer et en a été écartée.
    expect(revoque.body).toEqual(attente.body);
    expect(revoque.body.error.message).toBe(ATTENTE);
    expect(await t.prisma.session.count()).toBe(1);
  });

  it('refuse un jeton dont le `sub` ne correspond pas à celui enregistré', async () => {
    await t.signIn(t.agent(), ADMIN);
    const agent = t.agent();
    // Même adresse, identité Google différente : adresse supprimée puis recréée,
    // ou réattribuée sur un domaine Workspace. Le compte — et son rôle — ne suit pas.
    const res = await agent
      .post('/api/v1/auth/google')
      .send({ credential: fakeGoogleCredential({ ...ADMIN, sub: 'google-quelquun-dautre' }) })
      .expect(403);
    expect(res.body.error.message).toBe(ATTENTE);
    expect(res.headers['set-cookie']).toBeUndefined();
    await agent.get('/api/v1/me').expect(401);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user).toMatchObject({ googleSub: 'google-proprietaire', role: 'ADMIN', status: 'ACTIVE' });
  });

  it('une session cesse de valoir dès que le compte n’est plus actif', async () => {
    const agent = await t.signIn(t.agent(), ADMIN);
    await agent.get('/api/v1/me').expect(200);
    await t.prisma.user.update({ where: { email: ADMIN.email }, data: { status: 'REVOKED' } });
    await agent.get('/api/v1/me').expect(401);
    // La ligne de session est intacte : c'est la garde qui refuse, pas une révocation.
    expect(await t.prisma.session.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('la création du premier compte tient le verrou d’exclusion (vigilance 4)', async () => {
    let relache: () => void = () => {};
    const tenu = new Promise<void>((resolve) => {
      relache = resolve;
    });
    // Le test tient un `ROW EXCLUSIVE` : c'est le seul mode qui conflit avec le
    // `SHARE ROW EXCLUSIVE` pris par la connexion sans conflire avec le
    // `ROW EXCLUSIVE` d'un simple INSERT. Sans le verrou dans le service, la
    // connexion insérerait sans attendre et répondrait tout de suite.
    const bloquant = t.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "User" IN ROW EXCLUSIVE MODE`;
        await tenu;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    await new Promise((r) => setTimeout(r, 150));

    const connexion = google(t, ADMIN).then((r) => r.status);
    const course = await Promise.race([connexion, new Promise((r) => setTimeout(() => r('bloquée'), 600))]);
    expect(course).toBe('bloquée');

    relache();
    await bloquant;
    expect(await connexion).toBe(200);
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
    expect(user.googleSub).toBe('google-proprietaire');
  });

  it('une adresse changée crée une demande, sans buter sur l’unicité du `sub`', async () => {
    await t.signIn(t.agent(), ADMIN);
    const res = await google(t, { email: 'autre@example.org', name: 'djkix', sub: 'google-proprietaire' }).expect(403);
    expect(res.body.error.code).toBe('forbidden');
    const demande = await t.prisma.user.findUniqueOrThrow({ where: { email: 'autre@example.org' } });
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
    await t.api.post('/api/v1/auth/setup').send({ email: ADMIN.email, name: 'djkix', password: 'un-mot-de-passe-long' }).expect(404);
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

  // `GET /users` a disparu avec l'écran Utilisateurs (revue de la tâche 6) :
  // `GET /accounts` rend la même chose, avec les états, et réservé aux
  // administrateurs. Ce qui reste à vérifier ici est qu'aucune route ne crée
  // un compte, et qu'un membre ne valide pas les demandes.
  it('aucune route ne crée de compte, et un membre ne valide pas les demandes', async () => {
    const admin = await t.signIn(t.agent(), ADMIN);
    const marie = { email: 'marie@example.org', name: 'Marie' };
    await admin.post('/api/v1/users').send(marie).expect(404);

    await t.addMember(admin, marie);
    const member = await t.signIn(t.agent(), marie);
    await member.get('/api/v1/accounts').expect(403);
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

describe('premier administrateur d’une base vide (revue de sécurité du 2026-10-22)', () => {
  const PROPRIETAIRE: FakeIdentity = { email: 'proprietaire@example.org', name: 'Propriétaire', sub: 'google-proprietaire' };
  const INTRUS: FakeIdentity = { email: 'intrus@example.org', name: 'Intrus', sub: 'google-intrus' };

  describe('ADMIN_EMAIL posée', () => {
    let t: TestApp;
    beforeAll(async () => {
      // Casse et espaces différents de l'adresse Google : la comparaison est normalisée.
      t = await createTestApp({ ADMIN_EMAIL: '  Proprietaire@Example.org ' });
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    it('refuse toute autre adresse sur une base vide, sans rien créer', async () => {
      const res = await google(t, INTRUS).expect(403);
      expect(res.body.error.message).toBe(ATTENTE);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await t.prisma.user.count()).toBe(0);
      expect(await t.prisma.location.count()).toBe(0);
    });

    it('fait de l’adresse désignée le premier administrateur, même après une tentative refusée', async () => {
      await google(t, INTRUS).expect(403);
      const res = await google(t, PROPRIETAIRE).expect(200);
      expect(res.body).toMatchObject({ email: PROPRIETAIRE.email, role: 'ADMIN' });
      expect(await t.prisma.location.count()).toBeGreaterThan(0);
      // La base n'est plus vide : l'intrus devient une simple demande en attente.
      await google(t, INTRUS).expect(403);
      expect(await t.prisma.user.findUniqueOrThrow({ where: { email: INTRUS.email } })).toMatchObject({ role: 'MEMBER', status: 'PENDING' });
    });
  });

  describe('ADMIN_EMAIL absente en production', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ NODE_ENV: 'production' });
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    it('ne crée aucun administrateur par connexion Google', async () => {
      const res = await google(t, PROPRIETAIRE).expect(403);
      expect(res.body.error.message).toBe(ATTENTE);
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('laisse entrer l’administrateur créé par la porte de secours', async () => {
      await t.prisma.user.create({ data: { email: PROPRIETAIRE.email, name: PROPRIETAIRE.email, role: 'ADMIN', status: 'ACTIVE' } });
      const res = await google(t, PROPRIETAIRE).expect(200);
      expect(res.body).toMatchObject({ email: PROPRIETAIRE.email, role: 'ADMIN' });
    });
  });
});
