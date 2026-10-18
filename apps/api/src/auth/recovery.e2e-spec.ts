import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantRecovery, run } from '../../../../tools/acces-secours.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { fakeGoogleCredential, type FakeIdentity } from '../../test/google-verifier.double.js';
import { AuthController } from './auth.controller.js';
import { hashPassword } from './password.js';
import { SessionService } from './session.service.js';

const FRANCK: FakeIdentity = { email: 'franck@example.org', name: 'Franck', sub: 'google-franck' };
const INCONNU: FakeIdentity = { email: 'inconnu@example.org', name: 'Inconnu', sub: 'google-inconnu' };

const REFUS = 'Accès de secours indisponible';

const recovery = (t: TestApp, email: string, password: string) => t.api.post('/api/v1/auth/recovery').send({ email, password });

/** Métadonnées de limitation de débit posées par `@Throttle` sur une méthode du contrôleur. */
function throttleMetadata(method: 'loginWithGoogle' | 'loginWithRecovery'): Record<string, unknown> {
  const fn = AuthController.prototype[method] as unknown as object;
  const keys = Reflect.getMetadataKeys(fn).filter((key) => String(key).toUpperCase().includes('THROTTLER'));
  return Object.fromEntries(keys.map((key) => [String(key), Reflect.getMetadata(key, fn)]));
}

describe('porte de secours en ligne de commande (D6)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  describe('POST /auth/recovery', () => {
    it('n’ouvre rien tant qu’aucun mot de passe de secours n’est en base', async () => {
      await t.signIn(t.agent(), FRANCK);
      // Le compte existe, il est ACTIVE et ADMIN : seul le mot de passe de secours manque.
      const avant = await t.prisma.user.findUniqueOrThrow({ where: { email: FRANCK.email } });
      expect(avant.passwordHash).toBeNull();

      const res = await recovery(t, FRANCK.email, 'n’importe quoi').expect(401);
      expect(res.body.error.code).toBe('unauthenticated');
      expect(res.body.error.message).toBe(REFUS);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await t.prisma.session.count()).toBe(1); // celle de la connexion Google
    });

    it('refuse une adresse inconnue, sans la distinguer d’un compte sans mot de passe de secours', async () => {
      await t.signIn(t.agent(), FRANCK);
      const inconnue = await recovery(t, 'personne@example.org', 'n’importe quoi').expect(401);
      const connue = await recovery(t, FRANCK.email, 'n’importe quoi').expect(401);
      expect(inconnue.body).toEqual(connue.body);
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('ignore un `passwordHash` résiduel que le script n’a pas posé', async () => {
      // Un compte d'avant D5 peut porter un hachage de mot de passe sans
      // qu'aucune porte de secours ait été ouverte. Il ne doit rien ouvrir :
      // sinon le mot de passe supprimé de l'interface resterait une entrée
      // permanente, exactement le secret dormant que D6 écarte.
      await t.signIn(t.agent(), FRANCK);
      await t.prisma.user.update({
        where: { email: FRANCK.email },
        data: { passwordHash: await hashPassword('ancien-mot-de-passe'), recoveryExpiresAt: null },
      });

      const res = await recovery(t, FRANCK.email, 'ancien-mot-de-passe').expect(401);
      expect(res.body.error.message).toBe(REFUS);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await t.prisma.session.count()).toBe(1); // celle de la connexion Google
    });

    it('deux appels simultanés avec le même mot de passe n’ouvrent qu’une session', async () => {
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      const statuts = await Promise.all([
        recovery(t, FRANCK.email, password).then((r) => r.status),
        recovery(t, FRANCK.email, password).then((r) => r.status),
      ]);
      expect(statuts.sort()).toEqual([200, 401]);
      // La session et l'effacement vivent dans la même transaction : l'appel
      // perdant ne doit laisser aucune session derrière lui.
      expect(await t.prisma.session.count()).toBe(1);
    });

    it('ouvre une session avec le mot de passe tiré par le script', async () => {
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      const agent = t.agent();
      const res = await agent.post('/api/v1/auth/recovery').send({ email: FRANCK.email, password }).expect(200);
      expect(res.body).toMatchObject({ email: FRANCK.email, role: 'ADMIN' });
      expect(res.headers['set-cookie']?.[0]).toMatch(/^sid=.*HttpOnly/);
      await agent.get('/api/v1/me').expect(200);
    });

    it('refuse le mot de passe après l’heure d’expiration', async () => {
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      await t.prisma.user.update({
        where: { email: FRANCK.email },
        data: { recoveryExpiresAt: new Date(Date.now() - 1_000) },
      });

      const res = await recovery(t, FRANCK.email, password).expect(401);
      expect(res.body.error.message).toBe(REFUS);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await t.prisma.session.count()).toBe(0);
    });

    it('expire bien au bout d’une heure, pas davantage', async () => {
      const avant = Date.now();
      const { expiresAt } = await grantRecovery(t.prisma, FRANCK.email);
      const stocke = (await t.prisma.user.findUniqueOrThrow({ where: { email: FRANCK.email } })).recoveryExpiresAt;
      expect(stocke?.getTime()).toBe(expiresAt.getTime());
      expect(expiresAt.getTime() - avant).toBeGreaterThan(3_599_000);
      expect(expiresAt.getTime() - avant).toBeLessThan(3_605_000);
    });

    it('ne sert qu’une fois : le succès efface le hachage et l’expiration', async () => {
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      await recovery(t, FRANCK.email, password).expect(200);

      const apres = await t.prisma.user.findUniqueOrThrow({ where: { email: FRANCK.email } });
      expect(apres.passwordHash).toBeNull();
      expect(apres.recoveryExpiresAt).toBeNull();

      const seconde = await recovery(t, FRANCK.email, password).expect(401);
      expect(seconde.body.error.message).toBe(REFUS);
      expect(seconde.headers['set-cookie']).toBeUndefined();
      expect(await t.prisma.session.count()).toBe(1); // la seule, ouverte au premier usage
    });

    it('n’efface rien si la session ne peut pas être écrite', async () => {
      // L'effacement et l'ouverture de session vivent dans la même
      // transaction : une panne au milieu doit rendre le mot de passe de
      // secours intact, sinon le propriétaire se retrouve enfermé dehors avec
      // sa seule porte déjà consommée.
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      const sessions = t.app.get(SessionService);
      const spy = vi.spyOn(sessions, 'open').mockImplementation(async (userId, _res, tx) => {
        const writer = (tx ?? t.prisma) as typeof t.prisma;
        await writer.session.create({ data: { userId, tokenHash: `panne-${userId}`, expiresAt: new Date(Date.now() + 60_000) } });
        throw new Error('panne après écriture de la session');
      });
      try {
        await recovery(t, FRANCK.email, password).expect(500);
      } finally {
        spy.mockRestore();
      }

      expect(await t.prisma.session.count()).toBe(0);
      const apres = await t.prisma.user.findUniqueOrThrow({ where: { email: FRANCK.email } });
      expect(apres.passwordHash).not.toBeNull();
      expect(apres.recoveryExpiresAt).not.toBeNull();
      // Et la porte reste franchissable.
      await recovery(t, FRANCK.email, password).expect(200);
    });

    it('un mauvais mot de passe échoue sans brûler le bon', async () => {
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      await recovery(t, FRANCK.email, 'mauvais-mot-de-passe').expect(401);

      const apres = await t.prisma.user.findUniqueOrThrow({ where: { email: FRANCK.email } });
      expect(apres.passwordHash).not.toBeNull();
      expect(apres.recoveryExpiresAt).not.toBeNull();
      // Le vrai mot de passe reste utilisable : un tiers ne doit pas pouvoir
      // condamner la porte en tapant n'importe quoi pendant l'heure ouverte.
      await recovery(t, FRANCK.email, password).expect(200);
    });

    it('refuse un compte qui n’est plus ACTIVE, même avec un mot de passe de secours valide', async () => {
      const { password } = await grantRecovery(t.prisma, FRANCK.email);
      await t.prisma.user.update({ where: { email: FRANCK.email }, data: { status: 'REVOKED' } });
      await recovery(t, FRANCK.email, password).expect(401);
      expect(await t.prisma.session.count()).toBe(0);
    });

    it('porte la même limitation de débit que POST /auth/google', () => {
      const google = throttleMetadata('loginWithGoogle');
      expect(Object.keys(google).length).toBeGreaterThan(0);
      expect(throttleMetadata('loginWithRecovery')).toEqual(google);
    });
  });

  describe('tools/acces-secours.ts', () => {
    it('crée le compte absent en ACTIVE/ADMIN', async () => {
      const { created } = await grantRecovery(t.prisma, FRANCK.email);
      expect(created).toBe(true);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: FRANCK.email } });
      expect(user).toMatchObject({ status: 'ACTIVE', role: 'ADMIN' });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.recoveryExpiresAt).not.toBeNull();
    });

    it('promeut un compte existant en attente, sans toucher à son identité', async () => {
      await t.signIn(t.agent(), FRANCK);
      await t.api.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(INCONNU) }).expect(403);
      const avant = await t.prisma.user.findUniqueOrThrow({ where: { email: INCONNU.email } });
      expect(avant).toMatchObject({ status: 'PENDING', role: 'MEMBER' });

      const { created } = await grantRecovery(t.prisma, INCONNU.email);
      expect(created).toBe(false);
      const apres = await t.prisma.user.findUniqueOrThrow({ where: { email: INCONNU.email } });
      expect(apres).toMatchObject({ id: avant.id, status: 'ACTIVE', role: 'ADMIN', googleSub: avant.googleSub, name: avant.name });
    });

    it('normalise l’adresse comme la connexion Google', async () => {
      await t.signIn(t.agent(), FRANCK);
      const { created, email } = await grantRecovery(t.prisma, '  FRANCK@Example.ORG ');
      expect(created).toBe(false);
      expect(email).toBe(FRANCK.email);
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('affiche le mot de passe une seule fois sur la sortie standard, et il ouvre la porte', async () => {
      const lignes: string[] = [];
      await run(t.prisma, ['  FRANCK@Example.ORG '], (ligne) => lignes.push(ligne));

      const sortie = lignes.join('\n');
      const motDePasse = /Mot de passe .*: (\S+)/.exec(sortie)?.[1];
      expect(motDePasse).toBeTruthy();
      // Une seule occurrence : rien ne le répète ni ne le résume plus bas.
      expect(sortie.split(motDePasse as string)).toHaveLength(2);
      expect((motDePasse as string).length).toBeGreaterThanOrEqual(24);
      await recovery(t, FRANCK.email, motDePasse as string).expect(200);
    });

    it('refuse de s’exécuter sans adresse en argument', async () => {
      await expect(run(t.prisma, [], () => {})).rejects.toThrow(/adresse/i);
      expect(await t.prisma.user.count()).toBe(0);
    });
  });
});
