import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { AccountsService } from './accounts.service.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck' };
const MARIE = { email: 'marie@example.org', name: 'Marie' };

/**
 * Administration des comptes (section 10, D1 à D4). Quatre garde-fous de
 * sécurité : accès réservé aux administrateurs, pas d'auto-révocation, jamais
 * le dernier administrateur actif, et une révocation qui coupe les sessions.
 */
describe('administration des comptes', () => {
  let t: TestApp;
  let admin: TestAgent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = await t.signIn(t.agent(), ADMIN);
  });
  afterAll(() => t.close());

  /** Une demande d'accès : la connexion est refusée et le compte naît `PENDING`. */
  async function requestAccess(identity: { email: string; name: string }): Promise<string> {
    await t.agent().post('/api/v1/auth/google').send({ credential: JSON.stringify(identity) }).expect(403);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
    expect(user.status).toBe('PENDING');
    return user.id;
  }

  async function idOf(email: string): Promise<string> {
    return (await t.prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  /** Un second administrateur : demande d'accès, validation, puis promotion (aucune route ne promeut). */
  async function secondAdmin(): Promise<{ id: string; agent: TestAgent }> {
    const identity = { email: 'deuxieme@example.org', name: 'Deuxième' };
    const { id } = await t.addMember(admin, identity);
    await t.prisma.user.update({ where: { id }, data: { role: 'ADMIN' } });
    return { id, agent: await t.signIn(t.agent(), identity) };
  }

  describe('réservé aux administrateurs', () => {
    it('refuse un membre sur les trois routes (403)', async () => {
      const marieId = await requestAccess(MARIE);
      await admin.post(`/api/v1/accounts/${marieId}/approve`).expect(200);
      const member = await t.signIn(t.agent(), MARIE);

      for (const res of [
        await member.get('/api/v1/accounts'),
        await member.post(`/api/v1/accounts/${marieId}/approve`),
        await member.post(`/api/v1/accounts/${marieId}/revoke`),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('forbidden');
      }
      // Rien n'a bougé : le membre est resté actif.
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: marieId } })).status).toBe('ACTIVE');
    });

    it('refuse un appel sans session (401)', async () => {
      await t.api.get('/api/v1/accounts').expect(401);
    });
  });

  describe('liste', () => {
    it('met les demandes en attente d’abord, puis trie par date décroissante', async () => {
      const old = await requestAccess({ email: 'ancienne@example.org', name: 'Ancienne' });
      await t.addMember(admin, { email: 'actif@example.org', name: 'Actif' });
      const recent = await requestAccess({ email: 'recente@example.org', name: 'Récente' });
      await t.prisma.user.update({ where: { id: old }, data: { createdAt: new Date('2026-01-01') } });
      await t.prisma.user.update({ where: { email: ADMIN.email }, data: { createdAt: new Date('2026-02-01') } });
      await t.prisma.user.update({ where: { email: 'actif@example.org' }, data: { createdAt: new Date('2026-03-01') } });
      await t.prisma.user.update({ where: { id: recent }, data: { createdAt: new Date('2026-04-01') } });

      const res = await admin.get('/api/v1/accounts').expect(200);
      expect((res.body as { email: string }[]).map((a) => a.email)).toEqual([
        'recente@example.org',
        'ancienne@example.org',
        'actif@example.org',
        ADMIN.email,
      ]);
      expect(res.body[0]).toMatchObject({ status: 'PENDING', role: 'MEMBER', name: 'Récente' });
      expect(res.body[0].passwordHash).toBeUndefined();
      expect(res.body[0].googleSub).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('une demande approuvée peut ensuite se connecter', async () => {
      const id = await requestAccess(MARIE);
      const res = await admin.post(`/api/v1/accounts/${id}/approve`).expect(200);
      expect(res.body).toMatchObject({ id, email: MARIE.email, status: 'ACTIVE' });
      await t.signIn(t.agent(), MARIE);
    });

    it('404 sur un compte inconnu', async () => {
      await admin.post('/api/v1/accounts/inconnu/approve').expect(404);
      await admin.post('/api/v1/accounts/inconnu/revoke').expect(404);
    });
  });

  describe('révocation', () => {
    it('coupe les sessions en cours et ferme la porte à la reconnexion', async () => {
      await t.addMember(admin, MARIE);
      const marie = await t.signIn(t.agent(), MARIE);
      await marie.get('/api/v1/accounts').expect(403); // authentifiée : 403 et non 401
      const id = await idOf(MARIE.email);

      const res = await admin.post(`/api/v1/accounts/${id}/revoke`).expect(200);
      expect(res.body.status).toBe('REVOKED');

      // La session déjà ouverte ne vaut plus rien, sans attendre une reconnexion.
      await marie.get('/api/v1/me').expect(401);
      expect(await t.prisma.session.count({ where: { userId: id, revokedAt: null } })).toBe(0);
      // Et la reconnexion est refusée.
      await t.agent().post('/api/v1/auth/google').send({ credential: JSON.stringify(MARIE) }).expect(403);
    });

    it('un administrateur ne peut pas se révoquer lui-même', async () => {
      const { agent } = await secondAdmin(); // un autre administrateur existe : seule la règle d'auto-révocation joue
      const id = await idOf(ADMIN.email);
      const res = await admin.post(`/api/v1/accounts/${id}/revoke`).expect(403);
      expect(res.body.error.message).toMatch(/propre compte/);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
      await admin.get('/api/v1/accounts').expect(200); // sa session vit toujours
      await agent.get('/api/v1/accounts').expect(200);
    });

    it('refuse de révoquer le dernier administrateur actif', async () => {
      const { id, agent } = await secondAdmin();
      // L'appelant a perdu son statut actif. Depuis que la garde de session lit
      // `status`, sa session meurt aussitôt : la règle ne s'atteint plus par HTTP,
      // on l'éprouve donc sur le service, qui reste la dernière ligne.
      await t.prisma.user.update({ where: { email: ADMIN.email }, data: { status: 'REVOKED' } });
      await admin.get('/api/v1/accounts').expect(401);
      const actorId = await idOf(ADMIN.email);
      await expect(t.app.get(AccountsService).revoke(id, actorId)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/dernier administrateur/) });
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
      await agent.get('/api/v1/accounts').expect(200);
    });

    it('deux administrateurs qui se révoquent en même temps n’en laissent pas zéro', async () => {
      const { id: bId, agent: b } = await secondAdmin();
      const aId = await idOf(ADMIN.email);
      const [r1, r2] = await Promise.all([admin.post(`/api/v1/accounts/${bId}/revoke`), b.post(`/api/v1/accounts/${aId}/revoke`)]);
      // L'autre est refusé (403) ou déjà privé de session (401) selon l'ordre d'arrivée.
      expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
      expect(await t.prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
    });

    it('révoquer un administrateur quand un autre reste actif est permis', async () => {
      const { id } = await secondAdmin();
      await admin.post(`/api/v1/accounts/${id}/revoke`).expect(200);
    });
  });

  describe('un compte ne se crée pas à la main', () => {
    it('`POST /users` n’existe plus : la validation passe par /accounts', async () => {
      await admin.post('/api/v1/users').send({ email: MARIE.email, name: MARIE.name }).expect(404);
      expect(await t.prisma.user.findUnique({ where: { email: MARIE.email } })).toBeNull();
      // Le chemin qui reste : la personne demande, l'administrateur valide.
      await t.addMember(admin, MARIE);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: MARIE.email } });
      expect(user).toMatchObject({ status: 'ACTIVE', passwordHash: null });
      await t.signIn(t.agent(), MARIE);
    });
  });
});
