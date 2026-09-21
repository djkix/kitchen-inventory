import type { HttpClient } from '../../common/http-client.js';
import { parseSuggestion, userPrompt, VISION_SYSTEM_PROMPT } from './prompt.js';
import { ProviderError, type RecognitionInput, type RecognitionOutput, type RecognitionProvider } from './recognition-provider.js';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Schéma de réponse au format accepté par l'API Gemini (sous-ensemble
 * OpenAPI : `nullable` plutôt que des tableaux de types).
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['name', 'originalName', 'brand', 'category', 'packaging', 'expiryDate', 'confidence'],
  properties: {
    name: { type: 'STRING' },
    originalName: { type: 'STRING', nullable: true },
    brand: { type: 'STRING', nullable: true },
    category: { type: 'STRING', nullable: true },
    packaging: { type: 'STRING', nullable: true },
    expiryDate: { type: 'STRING', nullable: true, description: 'AAAA-MM-JJ' },
    confidence: { type: 'NUMBER' },
  },
} as const;

/** Prix publics indicatifs en dollars par million de jetons, pour le compteur de coût (section 21). */
const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gemini-3.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.5-pro': { input: 2, output: 12 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Google Gemini via l'API REST `generateContent`, sortie JSON contrainte par `responseSchema`. */
export class GeminiProvider implements RecognitionProvider {
  readonly name = 'gemini';
  readonly enabled = true;
  private readonly model: string;

  constructor(private readonly options: { apiKey: string; model?: string; baseURL?: string; httpClient: HttpClient }) {
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async recognize(input: RecognitionInput): Promise<RecognitionOutput> {
    const base = (this.options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: VISION_SYSTEM_PROMPT }] },
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType: input.mimeType, data: input.image.toString('base64') } }, { text: userPrompt(input.hint) }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (error) {
      throw new ProviderError('Fournisseur de vision Gemini injoignable', error);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('Clé API Gemini refusée');
    if (response.status === 429) throw new ProviderError('Quota Gemini atteint');
    if (!response.ok) throw new ProviderError(`Fournisseur de vision Gemini en erreur (${response.status})`);

    const raw = (await response.json()) as GeminiResponse;
    if (raw.promptFeedback?.blockReason) throw new ProviderError('Gemini a refusé la photo');
    const candidate = raw.candidates?.[0];
    if (!candidate || (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))) {
      throw new ProviderError(`Gemini n’a pas produit de réponse (${candidate?.finishReason ?? 'aucun candidat'})`);
    }
    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return { suggestion: parseSuggestion(text), raw, costCents: estimateCostCents(this.model, raw.usageMetadata) };
  }
}

function estimateCostCents(model: string, usage: GeminiResponse['usageMetadata']): number | null {
  const price = PRICES_USD_PER_MTOK[model];
  if (!usage || !price) return null;
  const usd = ((usage.promptTokenCount ?? 0) * price.input + (usage.candidatesTokenCount ?? 0) * price.output) / 1_000_000;
  return Math.round(usd * 100 * 10_000) / 10_000;
}
