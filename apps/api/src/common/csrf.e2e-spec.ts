import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { fakeGoogleCredential, type FakeIdentity } from '../../test/google-verifier.double.js';
import { CSRF_MESSAGE, isSameOriginWrite } from './csrf.middleware.js';

const ADMIN: FakeIdentity = { email: 'proprietaire@example.org', name: 'Propriétaire', sub: 'google-proprietaire' };
const ORIGIN = 'https://inventaire.test';
const PROD = { PUBLIC_URL: `${ORIGIN}/`, isDev: false };

describe('isSameOriginWrite (revue de sécurité du 2026-10-22)', () => {
  const write = (headers: Record<string, string>, cookies: Record<string, string> = { sid: 'x' }, method = 'POST') => ({ method, headers, cookies });

  it('laisse passer les lectures sans rien regarder', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(isSameOriginWrite(write({ origin: 'https://ailleurs.example' }, {}, method), PROD)).toBe(true);
  });
  it('exige l’origine de PUBLIC_URL', () => {
    expect(isSameOriginWrite(write({ origin: ORIGIN }), PROD)).toBe(true);
    expect(isSameOriginWrite(write({ origin: 'https://ailleurs.example' }), PROD)).toBe(false);
    expect(isSameOriginWrite(write({ origin: 'https://sous.inventaire.test' }), PROD)).toBe(false);
    expect(isSameOriginWrite(write({ origin: 'http://inventaire.test' }), PROD)).toBe(false);
    expect(isSameOriginWrite(write({ origin: 'null' }), PROD)).toBe(false);
  });
  it('se replie sur Referer quand Origin manque', () => {
    expect(isSameOriginWrite(write({ referer: `${ORIGIN}/stock?x=1` }), PROD)).toBe(true);
    expect(isSameOriginWrite(write({ referer: 'https://ailleurs.example/piege' }), PROD)).toBe(false);
  });
  it('refuse une écriture sans origine qui porte le cookie de session', () => {
    expect(isSameOriginWrite(write({}), PROD)).toBe(false);
    expect(isSameOriginWrite(write({}, {}), PROD)).toBe(true);
  });
  it('laisse passer un jeton de service sans cookie, même sans Origin', () => {
    expect(isSameOriginWrite(write({ authorization: 'Bearer kit_abc' }, {}), PROD)).toBe(true);
    // Avec un cookie de session, c'est l'origine qui décide.
    expect(isSameOriginWrite(write({ authorization: 'Bearer kit_abc', origin: 'https://ailleurs.example' }), PROD)).toBe(false);
  });
  it('accepte le serveur Vite en développement seulement', () => {
    expect(isSameOriginWrite(write({ origin: 'http://localhost:5173' }), { PUBLIC_URL: 'http://localhost:3000', isDev: true })).toBe(true);
    expect(isSameOriginWrite(write({ origin: 'http://localhost:5173' }), { PUBLIC_URL: 'http://localhost:3000', isDev: false })).toBe(false);
  });
});

describe('garde des écritures inter-origines, de bout en bout', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  async function sessionCookie(): Promise<string> {
    const res = await request(t.app.getHttpServer()).post('/api/v1/auth/google').set('Origin', ORIGIN).send({ credential: fakeGoogleCredential(ADMIN) }).expect(200);
    return String(res.headers['set-cookie']?.[0]).split(';')[0]!;
  }

  it('refuse une écriture de session venue d’un autre site, sans rien écrire', async () => {
    const cookie = await sessionCookie();
    const before = await t.prisma.location.count();
    const res = await t.api.post('/api/v1/locations').set('Cookie', cookie).set('Origin', 'https://ailleurs.example').send({ name: 'Piège' }).expect(403);
    expect(res.body.error).toEqual({ code: 'forbidden', message: CSRF_MESSAGE });
    await t.api.post('/api/v1/locations').set('Cookie', cookie).send({ name: 'Piège' }).expect(403);
    expect(await t.prisma.location.count()).toBe(before);
  });

  it('accepte la même écriture depuis l’application', async () => {
    const cookie = await sessionCookie();
    await t.api.post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN).expect((res) => expect(res.status).toBeLessThan(300));
  });

  it('refuse une connexion forcée depuis un autre site', async () => {
    await t.api.post('/api/v1/auth/google').set('Origin', 'https://ailleurs.example').send({ credential: fakeGoogleCredential(ADMIN) }).expect(403);
    expect(await t.prisma.user.count()).toBe(0);
  });

  it('laisse un jeton de service sans Origin jusqu’à la garde de session', async () => {
    const admin = await t.signIn(t.agent(), ADMIN);
    const created = await admin.post('/api/v1/service-tokens').send({ name: 'Home Assistant' }).expect(201);
    const res = await t.api.post('/api/v1/auth/logout').set('Authorization', `Bearer ${created.body.token}`).expect(403);
    // Refusé par la lecture seule des jetons, pas par la garde d'origine.
    expect(res.body.error.message).toBe('Un jeton de service ne permet que la lecture');
  });
});
