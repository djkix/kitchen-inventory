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
import { unpricedModelWarning } from './recognition/providers/gemini.provider.js';

export const API_PREFIX = 'api/v1';

/** Construit l'application sans l'écouter : partagé entre `main.ts` et les tests. */
export async function createApp(config: AppConfig, httpClient?: HttpClient): Promise<INestApplication> {
  await mkdir(config.mediaDir, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, httpClient), { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // Un modèle hors table de prix désactive le plafond mensuel sans rien dire :
  // il doit au moins se voir au démarrage.
  for (const warning of [
    unpricedModelWarning(config.VISION_PROVIDER, config.VISION_MODEL),
    unpricedModelWarning(config.VISION_PROVIDER, config.SUGGESTION_MODEL, 'SUGGESTION_MODEL'),
  ]) {
    if (warning) logger.warn(warning);
  }
  // robots.txt doit vivre à la racine du site, hors du préfixe d'API.
  app.setGlobalPrefix(API_PREFIX, { exclude: ['robots.txt'] });
  app.use(noindexMiddleware);
  app.use(cookieParser(config.SECRET_KEY));
  app.disable('x-powered-by');
  // Derrière le reverse proxy : l'adresse client vient de X-Forwarded-For.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
