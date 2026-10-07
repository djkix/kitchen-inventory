import type { AppConfig } from '../../common/config.js';
import type { HttpClient } from '../../common/http-client.js';
import { GeminiProvider } from './gemini.provider.js';
import { NoneProvider } from './none.provider.js';
import type { RecognitionProvider } from './recognition-provider.js';

/**
 * Choisit le fournisseur d'après `VISION_PROVIDER` ; sans clé, le fournisseur
 * cloud reste désactivé.
 *
 * Gemini est le seul fournisseur implémenté (section 5, décision du
 * 2026-09-21). Des adaptateurs Anthropic, OpenAI et Ollama ont existé jusqu'au
 * 2026-10-07 : jamais configurés, jamais exercés hors de leurs propres tests,
 * ils portaient une flexibilité que personne n'a utilisée. L'interface
 * `RecognitionProvider` demeure — c'est elle, et non ces adaptateurs, qui rend
 * un autre fournisseur ajoutable le jour où il en faudra un.
 */
export function createRecognitionProvider(config: AppConfig, httpClient: HttpClient): RecognitionProvider {
  if (config.VISION_PROVIDER !== 'gemini' || !config.VISION_API_KEY) return new NoneProvider();
  return new GeminiProvider({ apiKey: config.VISION_API_KEY, model: config.VISION_MODEL, baseURL: config.VISION_BASE_URL, httpClient });
}
