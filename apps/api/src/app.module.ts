import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { ConfigModule } from './common/config.module.js';
import type { AppConfig } from './common/config.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.isTest ? 'silent' : config.LOG_LEVEL,
            genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
            // Section 21 : jamais de mot de passe, de cookie ni de contenu d'image dans les journaux.
            redact: {
              paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword'],
              remove: true,
            },
            autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
            ...(config.isDev ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
          },
        }),
        PrismaModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    };
  }
}
