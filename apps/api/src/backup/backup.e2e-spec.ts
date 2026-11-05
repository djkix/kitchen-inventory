import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type TestAgent from 'supertest/lib/agent.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';

const ADMIN = { email: 'proprietaire@example.org', name: 'Admin' };
const MEMBRE = { email: 'membre@example.org', name: 'Membre' };

describe('sauvegarde vers le NAS depuis Réglages', () => {
  let t: TestApp;
  let agent: TestAgent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    agent = t.agent();
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  it('ne signale rien tant que le service n’a jamais tourné', async () => {
    const res = await agent.get('/api/v1/backup').expect(200);
    expect(res.body).toEqual({ lastSuccess: null, requested: false, warnings: [] });
  });

  it('montre la dernière réussite et signale un échec plus récent', async () => {
    const hier = new Date(Date.now() - 20 * 3600_000);
    await t.prisma.backupAttempt.createMany({
      data: [
        { startedAt: hier, finishedAt: hier, succeeded: true, message: '', dumpBytes: 4096 },
        { startedAt: new Date(), finishedAt: new Date(), succeeded: false, message: 'étape medias (code 23)' },
      ],
    });
    const res = await agent.get('/api/v1/backup').expect(200);
    expect(res.body.lastSuccess).toEqual({ finishedAt: hier.toISOString(), dumpBytes: 4096 });
    expect(res.body.warnings).toEqual(['La dernière sauvegarde a échoué : étape medias (code 23).']);
  });

  it('pose une seule demande, même sur deux appuis', async () => {
    const res = await agent.post('/api/v1/backup/request').expect(202);
    expect(res.body.requested).toBe(true);
    await agent.post('/api/v1/backup/request').expect(202);
    expect(await t.prisma.backupRequest.count()).toBe(1);
  });

  it('réservé aux administrateurs', async () => {
    const membre = t.agent();
    await t.addMember(agent, MEMBRE);
    await t.signIn(membre, MEMBRE);
    await membre.get('/api/v1/backup').expect(403);
    await membre.post('/api/v1/backup/request').expect(403);
  });
});
