import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GeminiRecipeRewriter } from './gemini-recipe-rewriter.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import { RecipePageFetcher } from './recipe-page.fetcher.js';
import { RECIPE_PAGE_FETCHER, RECIPE_REWRITER } from './suggestion-provider.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Gemini est le seul fournisseur de suggestions retenu (section 12, comme pour
 * la reconnaissance). Il réutilise la clé de la reconnaissance photo
 * (`VISION_API_KEY`) quand celle-ci est elle-même configurée sur Gemini :
 * aucune variable d'environnement séparée n'est introduite pour une seconde
 * clé que le cahier des charges ne prévoit pas. Le modèle, lui, est distinct
 * (`SUGGESTION_MODEL`, remplaçable depuis les réglages) : lire une étiquette et
 * chercher une recette sur le web n'appellent pas le même modèle.
 *
 * Les trois fournisseurs sont construits par fabrique parce qu'ils prennent le
 * client HTTP injectable, rejoué par fixtures dans les tests (section 19).
 */
@Module({
  imports: [RecipesModule, SettingsModule],
  controllers: [SuggestionsController],
  providers: [
    SuggestionsService,
    {
      provide: GeminiSuggestionProvider,
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: (config: AppConfig, httpClient: HttpClient) =>
        new GeminiSuggestionProvider({
          apiKey: config.VISION_PROVIDER === 'gemini' ? config.VISION_API_KEY : undefined,
          baseURL: config.VISION_PROVIDER === 'gemini' ? config.VISION_BASE_URL : undefined,
          httpClient,
        }),
    },
    {
      provide: RECIPE_PAGE_FETCHER,
      inject: [HTTP_CLIENT],
      useFactory: (httpClient: HttpClient) => new RecipePageFetcher(httpClient),
    },
    {
      provide: RECIPE_REWRITER,
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: (config: AppConfig, httpClient: HttpClient) =>
        new GeminiRecipeRewriter({
          apiKey: config.VISION_PROVIDER === 'gemini' ? config.VISION_API_KEY : undefined,
          baseURL: config.VISION_PROVIDER === 'gemini' ? config.VISION_BASE_URL : undefined,
          httpClient,
        }),
    },
  ],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
