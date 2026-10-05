import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GeminiRecipeRewriter } from './gemini-recipe-rewriter.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import { RecipePageFetcher } from './recipe-page.fetcher.js';
import { RECIPE_PAGE_FETCHER, RECIPE_REWRITER, SUGGESTION_PROVIDER, type SuggestionProvider } from './suggestion-provider.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Gemini est le seul fournisseur de suggestions retenu (section 12, comme pour
 * la reconnaissance). Il réutilise la clé et le modèle de la reconnaissance
 * photo (`VISION_API_KEY`) quand celle-ci est elle-même configurée sur Gemini :
 * aucune variable d'environnement séparée n'est introduite pour une seconde clé
 * que le cahier des charges ne prévoit pas. Le modèle, lui, est distinct
 * (`SUGGESTION_MODEL`) : lire une étiquette et chercher une recette sur le web
 * n'appellent pas le même modèle, et un `VISION_MODEL` réglé pour la photo ne
 * doit pas s'imposer aux recettes.
 * `enabled` reste `false` sans clé, et `suggest()` le signale alors clairement
 * (repris par le contrôleur, tâche 7).
 */
function createSuggestionProvider(config: AppConfig, httpClient: HttpClient): SuggestionProvider {
  const usesGemini = config.VISION_PROVIDER === 'gemini';
  return new GeminiSuggestionProvider({
    apiKey: usesGemini ? config.VISION_API_KEY : undefined,
    model: config.SUGGESTION_MODEL,
    baseURL: usesGemini ? config.VISION_BASE_URL : undefined,
    httpClient,
  });
}

/** Simple passe-plat réseau (tâche 9) : construit une fois, injecté là où une page doit être récupérée en sécurité. */
function createRecipePageFetcher(httpClient: HttpClient): RecipePageFetcher {
  return new RecipePageFetcher(httpClient);
}

/**
 * Réécrivain Gemini (tâche 9, B6) : même clé et même modèle (`SUGGESTION_MODEL`)
 * que le fournisseur de suggestions — une seule configuration pour tout le module recettes.
 */
function createRecipeRewriter(config: AppConfig, httpClient: HttpClient): GeminiRecipeRewriter {
  const usesGemini = config.VISION_PROVIDER === 'gemini';
  return new GeminiRecipeRewriter({
    apiKey: usesGemini ? config.VISION_API_KEY : undefined,
    model: config.SUGGESTION_MODEL,
    baseURL: usesGemini ? config.VISION_BASE_URL : undefined,
    httpClient,
  });
}

@Module({
  imports: [RecipesModule, SettingsModule],
  controllers: [SuggestionsController],
  providers: [
    SuggestionsService,
    {
      provide: SUGGESTION_PROVIDER,
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: createSuggestionProvider,
    },
    {
      provide: RECIPE_PAGE_FETCHER,
      inject: [HTTP_CLIENT],
      useFactory: createRecipePageFetcher,
    },
    {
      provide: RECIPE_REWRITER,
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: createRecipeRewriter,
    },
  ],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
