import Anthropic from '@anthropic-ai/sdk';
import type { HttpClient } from '../../common/http-client.js';
import { parseSuggestion, userPrompt, VISION_JSON_SCHEMA, VISION_SYSTEM_PROMPT } from './prompt.js';
import { ProviderError, type RecognitionInput, type RecognitionOutput, type RecognitionProvider } from './recognition-provider.js';

const DEFAULT_MODEL = 'claude-opus-5';

/** Prix publics en dollars par million de jetons, pour le compteur de coût de la section 21. */
const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export class AnthropicProvider implements RecognitionProvider {
  readonly name = 'anthropic';
  readonly enabled = true;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey: string; model?: string; baseURL?: string; httpClient: HttpClient }) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      fetch: options.httpClient as unknown as typeof fetch,
      maxRetries: 1,
      timeout: 25_000,
    });
  }

  async recognize(input: RecognitionInput): Promise<RecognitionOutput> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: VISION_SYSTEM_PROMPT,
        // Lecture d'étiquette : tâche courte, on limite la réflexion pour tenir la cible de 4 s (section 13).
        output_config: { effort: 'low', format: { type: 'json_schema', schema: VISION_JSON_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: toMediaType(input.mimeType), data: input.image.toString('base64') } },
              { type: 'text', text: userPrompt(input.hint) },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new ProviderError('Clé API du fournisseur de vision refusée', error);
      if (error instanceof Anthropic.RateLimitError) throw new ProviderError('Quota du fournisseur de vision atteint', error);
      if (error instanceof Anthropic.APIError) throw new ProviderError(`Fournisseur de vision en erreur (${error.status})`, error);
      throw new ProviderError('Fournisseur de vision injoignable', error);
    }
    if (response.stop_reason === 'refusal') throw new ProviderError('Le fournisseur de vision a refusé la photo');
    const text = (response.content ?? [])
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return { suggestion: parseSuggestion(text), raw: response, costCents: estimateCostCents(this.model, response.usage) };
  }
}

function toMediaType(mimeType: string): ImageMediaType {
  return mimeType === 'image/png' || mimeType === 'image/gif' || mimeType === 'image/webp' ? mimeType : 'image/jpeg';
}

function estimateCostCents(model: string, usage: Anthropic.Usage | undefined): number | null {
  if (!usage) return null;
  const price = PRICES_USD_PER_MTOK[model] ?? PRICES_USD_PER_MTOK[DEFAULT_MODEL]!;
  const usd = ((usage.input_tokens ?? 0) * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000;
  return Math.round(usd * 100 * 10_000) / 10_000;
}
