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

/**
 * Prix publics indicatifs en dollars par million de jetons, pour le compteur de
 * coût (section 21). Partagée avec le fournisseur de suggestions, qui appelle le
 * même modèle Gemini : une seule table de prix à tenir à jour.
 */
export const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gemini-3.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.5-pro': { input: 2, output: 12 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    /**
     * Présent quand le modèle a utilisé l'outil de recherche web.
     * `webSearchQueries` liste les requêtes qu'il a réellement exécutées :
     * c'est ce que Google facture, à part des jetons.
     */
    groundingMetadata?: { webSearchQueries?: string[] };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Prix public indicatif d'une requête de recherche web, en dollars. Google
 * facture la recherche **par requête exécutée**, indépendamment des jetons :
 * sans ce poste, le plafond mensuel laisserait filer toute la dépense de
 * recherche en annonçant protéger le budget. Réglable par
 * `SEARCH_COST_USD_PER_1K` : ce tarif change plus souvent que le code.
 */
export const DEFAULT_SEARCH_COST_USD_PER_1K = 35;

let searchCostUsdPer1k = DEFAULT_SEARCH_COST_USD_PER_1K;

/** Fixe le tarif de recherche appliqué au compteur de coût (appelé au démarrage depuis la configuration). */
export function setSearchCostUsdPer1k(value: number): void {
  searchCostUsdPer1k = value;
}

/** Nombre de requêtes de recherche réellement exécutées par le modèle dans cette réponse. */
export function countSearchQueries(raw: GeminiResponse): number {
  return (raw.candidates ?? []).reduce((total, candidate) => total + (candidate.groundingMetadata?.webSearchQueries?.length ?? 0), 0);
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
    const model = input.model ?? this.model;
    const base = (this.options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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
          // `temperature`, `top_p` et `top_k` sont dépréciés côté Gemini : sans
          // effet depuis la 3.6 Flash, ils deviendront une erreur. Le modèle
          // applique ses propres valeurs, qui sont les bonnes.
          generationConfig: {
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
    return { suggestion: parseSuggestion(text), raw, costCents: estimateCostCents(model, raw.usageMetadata) };
  }
}

/**
 * Avertissement de démarrage : un `VISION_MODEL` ou un `SUGGESTION_MODEL` absent de `PRICES_USD_PER_MTOK`
 * fait rendre `null` à `estimateCostCents`, si bien qu'aucun appel n'est chiffré
 * et que le plafond mensuel ne compte plus rien — silencieusement. Rend le
 * message à journaliser, ou `null` s'il n'y a rien à signaler.
 */
export function unpricedModelWarning(provider: string, model: string | undefined, variable = 'VISION_MODEL'): string | null {
  // La table ne couvre que Gemini ; les autres fournisseurs ont leur propre
  // barème, avec repli sur leur modèle par défaut.
  if (provider !== 'gemini' || !model || PRICES_USD_PER_MTOK[model]) return null;
  return `Modèle « ${model} » (${variable}) absent de la table de prix : aucun appel ne sera chiffré et le plafond mensuel (VISION_MONTHLY_CAP_CENTS) ne comptera rien. Modèles tarifés : ${Object.keys(PRICES_USD_PER_MTOK).join(', ')}.`;
}

/**
 * Coût d'un appel, en centimes. `searchQueries` ajoute le coût des recherches
 * web, facturées par requête et non par jeton : une fournée de suggestions
 * peut en exécuter plusieurs, et à 35 $/1000 elles pèsent davantage que les
 * jetons d'un modèle « lite ». Les ignorer rendrait le plafond mensuel
 * mensonger dès que la recherche est active.
 */
export function estimateCostCents(model: string, usage: GeminiResponse['usageMetadata'], searchQueries = 0): number | null {
  const price = PRICES_USD_PER_MTOK[model];
  // Un modèle hors table laisse quand même compter les recherches : mieux vaut
  // un coût partiel qu'aucun coût, puisque c'est le plafond qui est en jeu.
  if (!usage && searchQueries === 0) return null;
  if (!price && searchQueries === 0) return null;
  const tokensUsd = usage && price ? ((usage.promptTokenCount ?? 0) * price.input + (usage.candidatesTokenCount ?? 0) * price.output) / 1_000_000 : 0;
  const searchUsd = (searchQueries * searchCostUsdPer1k) / 1000;
  return Math.round((tokensUsd + searchUsd) * 100 * 10_000) / 10_000;
}
