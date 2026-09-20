import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/common/config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { truncateAll } from './db.js';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  config: AppConfig;
  /** Agent supertest sans cookie. */
  api: TestAgent;
  /** Nouvel agent qui conserve ses cookies (une session). */
  agent: () => TestAgent;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApp(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<TestApp> {
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
  const app = await createApp(config);
  await app.init();
  const prisma = app.get(PrismaService);
  const server = app.getHttpServer();
  return {
    app,
    prisma,
    config,
    api: request(server),
    agent: () => request.agent(server),
    reset: () => truncateAll(prisma),
    close: async () => {
      await app.close();
    },
  };
}
