import type { HttpClient } from '../common/http-client.js';
import { estimateCostCents, type GeminiResponse } from '../recognition/providers/gemini.provider.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { buildSuggestionPrompt, InvalidBatchJsonError, parseModelBatch, SUGGESTION_SYSTEM_PROMPT } from './prompt.js';
import type { SuggestionOutput, SuggestionProvider, SuggestionRequest } from './suggestion-provider.js';

const DEFAULT_MODEL = 'gemini-3.5-pro';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Google Gemini avec l'outil de recherche web (`google_search`), seul fournisseur
 * retenu pour les suggestions (section 12). Sœur de `GeminiProvider` (reconnaissance) :
 * même `HttpClient`, même table de prix, même `ProviderError`.
 *
 * Vigilance 1 : `responseSchema` et l'outil de recherche sont mutuellement exclusifs
 * côté API Gemini. La sortie n'est donc pas contrainte par un schéma — elle est
 * imposée par le prompt (un seul objet JSON, sans texte autour), puis débarrassée
 * d'éventuelles clôtures ``` et du texte superflu qui déborderait autour de l'objet,
 * et validée par `modelBatchSchema` côté client.
 */
export class GeminiSuggestionProvider implements SuggestionProvider {
  readonly name = 'gemini';
  readonly enabled: boolean;
  private readonly model: string;

  constructor(private readonly options: { apiKey?: string; model?: string; baseURL?: string; httpClient: HttpClient }) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.enabled = Boolean(options.apiKey);
  }

  async suggest(req: SuggestionRequest): Promise<SuggestionOutput> {
    if (!this.options.apiKey) throw new ProviderError('Fournisseur de suggestions désactivé');

    const first = await this.call(buildSuggestionPrompt(req));
    try {
      return this.toOutput(first, req.count);
    } catch (error) {
      if (!(error instanceof InvalidBatchJsonError)) throw error;
    }

    // Vigilance 1 : une seule reprise, jamais une troisième tentative.
    const second = await this.call(buildSuggestionPrompt(req, { retry: true }));
    try {
      return this.toOutput(second, req.count);
    } catch (error) {
      if (error instanceof InvalidBatchJsonError) throw new ProviderError('Le fournisseur de suggestions n’a pas renvoyé de JSON exploitable après reprise', error);
      throw error;
    }
  }

  /**
   * Le nombre de recettes demandées est la seule borne qui fasse sens ici : elle
   * dépend de l'appel (`SuggestionRequest.count`), pas d'une limite structurelle du
   * schéma. Un modèle qui en renvoie davantage est tronqué, jamais rejeté : ce n'est
   * pas une réponse malformée, juste trop généreuse.
   */
  private toOutput(raw: GeminiResponse, count: number): SuggestionOutput {
    const text = extractText(raw);
    const batch = parseModelBatch(text);
    return { recipes: batch.recipes.slice(0, count), raw, costCents: estimateCostCents(this.model, raw.usageMetadata), model: this.model };
  }

  private async call(prompt: string): Promise<GeminiResponse> {
    const base = (this.options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey ?? '' },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SUGGESTION_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          // La recherche web est l'intérêt même de ce fournisseur : elle interdit `responseSchema` (vigilance 1).
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
        }),
      });
    } catch (error) {
      throw new ProviderError('Fournisseur de suggestions Gemini injoignable', error);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('Clé API Gemini refusée');
    if (response.status === 429) throw new ProviderError('Quota Gemini atteint');
    if (!response.ok) throw new ProviderError(`Fournisseur de suggestions Gemini en erreur (${response.status})`);

    const raw = (await response.json()) as GeminiResponse;
    if (raw.promptFeedback?.blockReason) throw new ProviderError('Gemini a refusé la demande de suggestions');
    const candidate = raw.candidates?.[0];
    if (!candidate) throw new ProviderError('Gemini n’a pas produit de réponse (aucun candidat)');
    // Une réponse coupée par la limite de jetons est tronquée au milieu du JSON : ce n'est pas
    // du JSON mal formé à reprendre avec un rappel de format (qui redemanderait le même volume
    // dans le même budget, et tronquerait de nouveau), mais un échec de budget à signaler tel quel.
    if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('Réponse du fournisseur de suggestions tronquée par la limite de jetons');
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new ProviderError(`Gemini n’a pas produit de réponse (${candidate.finishReason})`);
    }
    return raw;
  }
}

function extractText(raw: GeminiResponse): string {
  const candidate = raw.candidates?.[0];
  return (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}
