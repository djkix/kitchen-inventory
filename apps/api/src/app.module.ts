import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { MediaModule } from './media/media.module.js';
import { RecognitionModule } from './recognition/recognition.module.js';
import { randomUUID } from 'node:crypto';
import { AccountsModule } from './accounts/accounts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_TOKEN_VERIFIER, GoogleIdTokenVerifier, type GoogleTokenVerifier } from './auth/google-token.verifier.js';
import { BootstrapModule } from './bootstrap/bootstrap.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { CuisinesModule } from './cuisines/cuisines.module.js';
import { ExportModule } from './export/export.module.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { ConfigModule } from './common/config.module.js';
import type { AppConfig } from './common/config.js';
import { defaultHttpClient, HTTP_CLIENT, type HttpClient } from './common/http-client.js';
import { GeminiModule } from './gemini/gemini.module.js';
import { HealthModule } from './health/health.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PreferencesModule } from './preferences/preferences.module.js';
import { ProductsModule } from './products/products.module.js';
import { ReceiptsModule } from './receipts/receipts.module.js';
import { RecipesModule } from './recipes/recipes.module.js';
import { ServiceTokensModule } from './service-tokens/service-tokens.module.js';
import { SpaModule } from './spa/spa.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StockModule } from './stock/stock.module.js';
import { SuggestionsModule } from './suggestions/suggestions.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Client Google du vérificateur de jeton. `GOOGLE_CERTS_URL` déplace la seule
 * chose qu'il va chercher sur le réseau — les clés publiques de signature —
 * pour que les parcours bout en bout vérifient une vraie signature contre une
 * doublure locale (`e2e/fixtures/stub-server.ts`). Absente en production : les
 * clés viennent de Google. Les deux formats sont pointés au même endroit, le
 * choix PEM/JWK appartenant à la bibliothèque.
 */
function googleClient(config: AppConfig): OAuth2Client {
  const url = config.GOOGLE_CERTS_URL;
  if (!url) return new OAuth2Client();
  return new OAuth2Client({ endpoints: { oauth2FederatedSignonPemCertsUrl: url, oauth2FederatedSignonJwkCertsUrl: url } });
}

@Global()
@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    httpClient: HttpClient = defaultHttpClient,
    // Injecté pour que les tests posent une doublure : aucun test ne contacte Google.
    googleVerifier: GoogleTokenVerifier = new GoogleIdTokenVerifier(config.GOOGLE_CLIENT_ID, googleClient(config)),
  ): DynamicModule {
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
        AccountsModule,
        UsersModule,
        ServiceTokensModule,
        LocationsModule,
        CategoriesModule,
        CuisinesModule,
        PreferencesModule,
        ProductsModule,
        SettingsModule,
        GeminiModule,
        StockModule,
        RecipesModule,
        SuggestionsModule,
        MediaModule,
        RecognitionModule,
        ReceiptsModule,
        ExportModule,
        SpaModule.forRoot(config),
        BootstrapModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: HTTP_CLIENT, useValue: httpClient },
        { provide: GOOGLE_TOKEN_VERIFIER, useValue: googleVerifier },
      ],
      exports: [HTTP_CLIENT, GOOGLE_TOKEN_VERIFIER],
    };
  }
}
