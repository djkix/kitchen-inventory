import type { HttpClient } from '../../common/http-client.js';
import { parseSuggestion, userPrompt, VISION_JSON_SCHEMA, VISION_SYSTEM_PROMPT } from './prompt.js';
import { ProviderError, type RecognitionInput, type RecognitionOutput, type RecognitionProvider } from './recognition-provider.js';

/** Modèle local derrière Ollama (décision 2) : zéro coût marginal, données qui restent sur le réseau. */
export class OllamaProvider implements RecognitionProvider {
  readonly name = 'ollama';
  readonly enabled = true;

  constructor(private readonly options: { model?: string; baseURL?: string; httpClient: HttpClient }) {}

  async recognize(input: RecognitionInput): Promise<RecognitionOutput> {
    const base = (this.options.baseURL ?? 'http://localhost:11434').replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: this.options.model ?? 'llama3.2-vision',
          stream: false,
          format: VISION_JSON_SCHEMA,
          messages: [
            { role: 'system', content: VISION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(input.hint), images: [input.image.toString('base64')] },
          ],
        }),
      });
    } catch (error) {
      throw new ProviderError('Modèle de vision local injoignable', error);
    }
    if (!response.ok) throw new ProviderError(`Modèle de vision local en erreur (${response.status})`);
    const raw = (await response.json()) as { message?: { content?: string } };
    return { suggestion: parseSuggestion(raw.message?.content ?? ''), raw, costCents: 0 };
  }
}
