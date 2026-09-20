import { mkdir } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './common/config.js';
import type { HttpClient } from './common/http-client.js';
import { noindexMiddleware } from './common/noindex.middleware.js';

export const API_PREFIX = 'api/v1';

/** Construit l'application sans l'écouter : partagé entre `main.ts` et les tests. */
export async function createApp(config: AppConfig, httpClient?: HttpClient): Promise<INestApplication> {
  await mkdir(config.mediaDir, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, httpClient), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.use(noindexMiddleware);
  app.use(cookieParser(config.SECRET_KEY));
  app.disable('x-powered-by');
  // Derrière le reverse proxy : l'adresse client vient de X-Forwarded-For.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
