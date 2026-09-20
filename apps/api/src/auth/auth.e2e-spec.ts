import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

describe('authentification', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('signale qu’une installation est requise tant qu’aucun utilisateur n’existe', async () => {
    const res = await t.api.get('/api/v1/auth/status').expect(200);
    expect(res.body).toEqual({ setupRequired: true });
  });

  it('crée le premier administrateur, ouvre une session et pose les emplacements par défaut', async () => {
    const agent = t.agent();
    const res = await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    expect(res.body.role).toBe('ADMIN');
    expect(res.headers['set-cookie']?.[0]).toMatch(/^sid=.*HttpOnly/);
    expect(res.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/);
    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body).toMatchObject({ email: ADMIN.email, name: 'Franck', role: 'ADMIN' });
    expect((await t.api.get('/api/v1/auth/status')).body).toEqual({ setupRequired: false });
    const locations = await t.prisma.location.findMany();
    expect(locations.map((l) => l.path).sort()).toEqual(['/cellier', '/cuisine', '/cuisine/congelateur', '/cuisine/placard', '/cuisine/refrigerateur']);
  });

  it('refuse un second setup', async () => {
    await t.api.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const res = await t.api.post('/api/v1/auth/setup').send({ ...ADMIN, email: 'autre@example.org' }).expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('refuse un mot de passe trop court avec le détail du champ', async () => {
    const res = await t.api.post('/api/v1/auth/setup').send({ ...ADMIN, password: 'court' }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details).toEqual([{ path: 'password', message: 'Le mot de passe doit faire au moins 12 caractères' }]);
  });

  it('connecte avec le bon mot de passe et refuse le mauvais sans distinguer le cas', async () => {
    await t.api.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const bad = await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'mauvais-mot-de-passe' }).expect(401);
    const unknown = await t.api.post('/api/v1/auth/login').send({ email: 'inconnu@example.org', password: 'mauvais-mot-de-passe' }).expect(401);
    expect(bad.body).toEqual(unknown.body);
    expect(bad.body.error.message).toBe('Identifiants incorrects');
    const agent = t.agent();
    await agent.post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(204);
    await agent.get('/api/v1/me').expect(200);
  });

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe', async () => {
    await t.api.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    for (let i = 0; i < 5; i++) {
      await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'mauvais-mot-de-passe' }).expect(401);
    }
    const res = await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.body.error.details.lockedUntil).toBeDefined();
  });

  it('un échec suivi d’un succès remet le compteur à zéro', async () => {
    await t.api.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'mauvais-mot-de-passe' }).expect(401);
    await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(204);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user.failedLogins).toBe(0);
  });

  it('la déconnexion révoque la session', async () => {
    const agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    await agent.post('/api/v1/auth/logout').expect(204);
    const res = await agent.get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('exige une session sur les routes protégées', async () => {
    const res = await t.api.get('/api/v1/me').expect(401);
    expect(res.body.error).toEqual({ code: 'unauthenticated', message: 'Session absente ou expirée' });
  });

  it('stocke les mots de passe en Argon2id et le jeton de session haché', async () => {
    const agent = t.agent();
    const res = await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    const rawToken = /sid=([^;]+)/.exec(res.headers['set-cookie']?.[0] ?? '')?.[1] ?? '';
    const session = await t.prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(decodeURIComponent(rawToken));
    expect(session.tokenHash).toHaveLength(64);
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
    const admin = t.agent();
    await admin.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const created = await admin
      .post('/api/v1/users')
      .send({ email: 'marie@example.org', name: 'Marie', password: 'encore-un-mot-de-passe' })
      .expect(201);
    expect(created.body).toMatchObject({ email: 'marie@example.org', role: 'MEMBER' });
    expect(created.body.passwordHash).toBeUndefined();

    const member = t.agent();
    await member.post('/api/v1/auth/login').send({ email: 'marie@example.org', password: 'encore-un-mot-de-passe' }).expect(204);
    const forbidden = await member.post('/api/v1/users').send({ email: 'x@example.org', name: 'X', password: 'encore-un-mot-de-passe' }).expect(403);
    expect(forbidden.body.error.code).toBe('forbidden');
    const list = await member.get('/api/v1/users').expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('refuse un e-mail déjà utilisé', async () => {
    const admin = t.agent();
    await admin.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const res = await admin.post('/api/v1/users').send({ email: ADMIN.email, name: 'Doublon', password: 'encore-un-mot-de-passe' }).expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('change son mot de passe et révoque les autres sessions', async () => {
    const admin = t.agent();
    await admin.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    const other = t.agent();
    await other.post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(204);
    await admin.post('/api/v1/me/password').send({ currentPassword: ADMIN.password, newPassword: 'nouveau-mot-de-passe-long' }).expect(204);
    await other.get('/api/v1/me').expect(401);
    await admin.get('/api/v1/me').expect(200);
    await t.api.post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'nouveau-mot-de-passe-long' }).expect(204);
  });

  it('un jeton de service lit mais n’écrit pas', async () => {
    const admin = t.agent();
    await admin.post('/api/v1/auth/setup').send(ADMIN).expect(201);
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
