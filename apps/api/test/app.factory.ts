import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../src/app.js';
import { BootstrapService } from '../src/bootstrap/bootstrap.service.js';
import { loadConfig, type AppConfig } from '../src/common/config.js';
import type { HttpClient } from '../src/common/http-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { truncateAll } from './db.js';
import { fakeGoogleCredential, fakeGoogleVerifier, type FakeIdentity } from './google-verifier.double.js';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  config: AppConfig;
  /** Agent supertest sans cookie. */
  api: TestAgent;
  /** Nouvel agent qui conserve ses cookies (une session). */
  agent: () => TestAgent;
  /** Connecte un agent par jeton Google doublé ; la première connexion crée l'administrateur. */
  signIn: (agent: TestAgent, identity: FakeIdentity) => Promise<TestAgent>;
  /** Ajoute un membre par le seul chemin qui existe : il demande l'accès, un administrateur valide. */
  addMember: (adminAgent: TestAgent, identity: FakeIdentity) => Promise<{ id: string; email: string }>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApp(overrides: Partial<NodeJS.ProcessEnv> = {}, httpClient?: HttpClient): Promise<TestApp> {
  const mediaDir = await mkdtemp(join(tmpdir(), 'kitchen-media-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    SECRET_KEY: 'test-secret-key-test-secret-key-test-secret-key',
    PUBLIC_URL: 'https://inventaire.test',
    MEDIA_DIR: mediaDir,
    VISION_PROVIDER: 'none',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  const app = await createApp(config, httpClient, fakeGoogleVerifier);
  await app.init();
  const prisma = app.get(PrismaService);
  const bootstrap = app.get(BootstrapService);
  const server = app.getHttpServer();
  return {
    app,
    prisma,
    config,
    api: request(server),
    agent: () => request.agent(server),
    signIn: async (agent, identity) => {
      await agent.post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(identity) }).expect(200);
      return agent;
    },
    addMember: async (adminAgent, identity) => {
      await request(server).post('/api/v1/auth/google').send({ credential: fakeGoogleCredential(identity) }).expect(403);
      const email = identity.email.trim().toLowerCase();
      const account = await prisma.user.findUniqueOrThrow({ where: { email } });
      await adminAgent.post(`/api/v1/accounts/${account.id}/approve`).expect(200);
      return { id: account.id, email };
    },
    // Vide les données puis recrée les référentiels de la section 22, comme au démarrage.
    reset: async () => {
      await truncateAll(prisma);
      await bootstrap.seedReferenceData();
    },
    close: async () => {
      await app.close();
    },
  };
}
