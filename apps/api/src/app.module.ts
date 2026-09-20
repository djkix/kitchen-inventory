import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { MediaModule } from './media/media.module.js';
import { RecognitionModule } from './recognition/recognition.module.js';
import { randomUUID } from 'node:crypto';
import { AuthModule } from './auth/auth.module.js';
import { BootstrapModule } from './bootstrap/bootstrap.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ExportModule } from './export/export.module.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { ConfigModule } from './common/config.module.js';
import type { AppConfig } from './common/config.js';
import { defaultHttpClient, HTTP_CLIENT, type HttpClient } from './common/http-client.js';
import { HealthModule } from './health/health.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductsModule } from './products/products.module.js';
import { ServiceTokensModule } from './service-tokens/service-tokens.module.js';
import { SpaModule } from './spa/spa.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StockModule } from './stock/stock.module.js';
import { UsersModule } from './users/users.module.js';

@Global()
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, httpClient: HttpClient = defaultHttpClient): DynamicModule {
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
        AuthModule,
        UsersModule,
        ServiceTokensModule,
        LocationsModule,
        CategoriesModule,
        ProductsModule,
        SettingsModule,
        StockModule,
        MediaModule,
        RecognitionModule,
        ExportModule,
        SpaModule.forRoot(config),
        BootstrapModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: HTTP_CLIENT, useValue: httpClient },
      ],
      exports: [HTTP_CLIENT],
    };
  }
}
