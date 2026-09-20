import type { HttpClient } from '../../common/http-client.js';
import { parseSuggestion, userPrompt, VISION_JSON_SCHEMA, VISION_SYSTEM_PROMPT } from './prompt.js';
import { ProviderError, type RecognitionInput, type RecognitionOutput, type RecognitionProvider } from './recognition-provider.js';

/** API « chat completions » compatible OpenAI, avec sortie JSON contrainte. */
export class OpenAiProvider implements RecognitionProvider {
  readonly name = 'openai';
  readonly enabled = true;

  constructor(
    private readonly options: { apiKey: string; model?: string; baseURL?: string; httpClient: HttpClient },
  ) {}

  async recognize(input: RecognitionInput): Promise<RecognitionOutput> {
    const base = (this.options.baseURL ?? 'https://api.openai.com').replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          model: this.options.model ?? 'gpt-4.1-mini',
          max_tokens: 1024,
          response_format: { type: 'json_schema', json_schema: { name: 'product', strict: true, schema: VISION_JSON_SCHEMA } },
          messages: [
            { role: 'system', content: VISION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.image.toString('base64')}` } },
                { type: 'text', text: userPrompt(input.hint) },
              ],
            },
          ],
        }),
      });
    } catch (error) {
      throw new ProviderError('Fournisseur de vision injoignable', error);
    }
    if (!response.ok) throw new ProviderError(`Fournisseur de vision en erreur (${response.status})`);
    const raw = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = raw.choices?.[0]?.message?.content ?? '';
    return { suggestion: parseSuggestion(text), raw, costCents: null };
  }
}
