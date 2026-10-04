import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import { SUGGESTION_PROVIDER, type SuggestionProvider } from './suggestion-provider.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Gemini est le seul fournisseur de suggestions retenu (section 12, comme pour
 * la reconnaissance). Il réutilise la clé et le modèle de la reconnaissance
 * photo (`VISION_API_KEY`, `VISION_MODEL`) quand celle-ci est elle-même
 * configurée sur Gemini : aucune variable d'environnement séparée n'est
 * introduite pour une seconde clé que le cahier des charges ne prévoit pas.
 * `enabled` reste `false` sans clé, et `suggest()` le signale alors clairement
 * (repris par le contrôleur, tâche 7).
 */
function createSuggestionProvider(config: AppConfig, httpClient: HttpClient): SuggestionProvider {
  const usesGemini = config.VISION_PROVIDER === 'gemini';
  return new GeminiSuggestionProvider({
    apiKey: usesGemini ? config.VISION_API_KEY : undefined,
    model: usesGemini ? config.VISION_MODEL : undefined,
    baseURL: usesGemini ? config.VISION_BASE_URL : undefined,
    httpClient,
  });
}

@Module({
  imports: [RecipesModule, SettingsModule],
  providers: [
    SuggestionsService,
    {
      provide: SUGGESTION_PROVIDER,
      inject: [APP_CONFIG, HTTP_CLIENT],
      useFactory: createSuggestionProvider,
    },
  ],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
