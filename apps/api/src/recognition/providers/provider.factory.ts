import type { AppConfig } from '../../common/config.js';
import type { HttpClient } from '../../common/http-client.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { NoneProvider } from './none.provider.js';
import { OllamaProvider } from './ollama.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import type { RecognitionProvider } from './recognition-provider.js';

/** Choisit le fournisseur d'après `VISION_PROVIDER` ; sans clé, le fournisseur cloud reste désactivé. */
export function createRecognitionProvider(config: AppConfig, httpClient: HttpClient): RecognitionProvider {
  switch (config.VISION_PROVIDER) {
    case 'anthropic':
      if (!config.VISION_API_KEY) return new NoneProvider();
      return new AnthropicProvider({ apiKey: config.VISION_API_KEY, model: config.VISION_MODEL, baseURL: config.VISION_BASE_URL, httpClient });
    case 'openai':
      if (!config.VISION_API_KEY) return new NoneProvider();
      return new OpenAiProvider({ apiKey: config.VISION_API_KEY, model: config.VISION_MODEL, baseURL: config.VISION_BASE_URL, httpClient });
    case 'ollama':
      return new OllamaProvider({ model: config.VISION_MODEL, baseURL: config.VISION_BASE_URL, httpClient });
    default:
      return new NoneProvider();
  }
}
