import type { HttpClient } from '../../common/http-client.js';
import { GeminiPausedError } from '../../gemini/gemini-errors.js';
import { parseSuggestion, userPrompt, VISION_SYSTEM_PROMPT } from './prompt.js';
import { ProviderError, type RecognitionInput, type RecognitionOutput, type RecognitionProvider } from './recognition-provider.js';

/**
 * Modèle quand l'appelant n'en désigne pas. En service, il en désigne
 * toujours un : `GeminiService.call` le choisit dans la liste en direct de
 * Google (2026-10-22).
 */
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Prix publics indicatifs en dollars par million de jetons, pour le compteur de
 * coût (section 21). Partagée avec le fournisseur de suggestions, qui appelle le
 * même modèle Gemini : une seule table de prix à tenir à jour.
 */
export const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number; audio: number }> = {
  'gemini-3.5-flash': { input: 0.3, output: 2.5, audio: 1 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4, audio: 0.3 },
  'gemini-3.5-pro': { input: 2, output: 12, audio: 4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, audio: 1 },
  'gemini-2.5-pro': { input: 1.25, output: 10, audio: 2.5 },
};

/**
 * Prix d'un modèle, par nom exact puis par famille.
 *
 * Le sélecteur de Réglages propose tout modèle Gemini de la famille Flash que
 * la clé déclare, filtre volontairement ouvert pour qu'une nouvelle génération
 * apparaisse sans toucher au code. La table ci-dessus, elle, est une liste
 * fermée de noms exacts : les deux ne pouvaient que diverger. C'est arrivé avec
 * `gemini-flash-latest`, choisi le 2026-10-15 et absent de la table — tous les
 * appels ont été journalisés à `costCents: null` et le plafond mensuel a compté
 * zéro, en silence, jusqu'au 2026-10-21.
 *
 * Le repli par famille suppose qu'une génération ne change pas de tarif, ce que
 * `gemini-2.5-flash` et `gemini-3.5-flash` vérifient aujourd'hui. Si Google
 * renchérit une nouvelle génération, le compte sera bas d'autant — mais bas,
 * pas nul, et l'écart se voit au journal. L'ordre compte : « flash-lite » avant
 * « flash », sinon un modèle « lite » serait facturé au tarif Flash.
 */
export function priceFor(model: string): { input: number; output: number; audio: number } | undefined {
  const exact = PRICES_USD_PER_MTOK[model];
  if (exact) return exact;
  if (!model.startsWith('gemini-')) return undefined;
  if (model.includes('flash-lite')) return PRICES_USD_PER_MTOK['gemini-3.5-flash-lite'];
  if (model.includes('flash')) return PRICES_USD_PER_MTOK['gemini-3.5-flash'];
  if (model.includes('pro')) return PRICES_USD_PER_MTOK['gemini-3.5-pro'];
  return undefined;
}

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
  /**
   * `promptTokensDetails` ventile les jetons d'entrée par modalité (TEXT,
   * AUDIO, IMAGE…) : c'est elle qui permet de facturer l'audio à son tarif
   * (D7, 2026-10-21). Elle n'est pas garantie — d'où le repli d'
   * `estimateCostCents`, qui facture alors tout au tarif audio.
   */
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
}

/**
 * Prix public indicatif d'une requête de recherche web, en dollars pour mille.
 * Google facture la recherche **par requête exécutée**, indépendamment des
 * jetons : sans ce poste, le plafond mensuel laisserait filer toute la dépense
 * de recherche en annonçant protéger le budget. Au même titre que
 * `PRICES_USD_PER_MTOK`, ce tarif se met à jour dans le code quand Google le
 * change — personne n'a besoin de le régler par instance.
 */
export const SEARCH_COST_USD_PER_1K = 35;

/** Nombre de requêtes de recherche réellement exécutées par le modèle dans cette réponse. */
export function countSearchQueries(raw: GeminiResponse): number {
  return (raw.candidates ?? []).reduce((total, candidate) => total + (candidate.groundingMetadata?.webSearchQueries?.length ?? 0), 0);
}

/**
 * Google Gemini via l'API REST `generateContent`. La forme du JSON est dite
 * dans la consigne, avec `responseMimeType` mais sans `responseSchema` : Google
 * refuse en 400 un schéma imbriqué, et la réponse est de toute façon validée
 * par Zod (`parseSuggestion`).
 */
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
          },
        }),
      });
    } catch (error) {
      if (error instanceof GeminiPausedError) throw error;
      throw new ProviderError('Fournisseur de vision Gemini injoignable', error);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('Clé API Gemini refusée');
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
 * Avertissement de démarrage : un `VISION_MODEL` absent de `PRICES_USD_PER_MTOK`
 * fait rendre `null` à `estimateCostCents`, si bien qu'aucun appel n'est chiffré
 * et que le plafond mensuel ne compte plus rien — silencieusement. Rend le
 * message à journaliser, ou `null` s'il n'y a rien à signaler.
 */
export function unpricedModelWarning(provider: string, model: string | undefined, variable = 'VISION_MODEL'): string | null {
  // La table ne couvre que Gemini ; les autres fournisseurs ont leur propre
  // barème, avec repli sur leur modèle par défaut.
  if (provider !== 'gemini' || !model || priceFor(model)) return null;
  return `Modèle « ${model} » (${variable}) absent de la table de prix : aucun appel ne sera chiffré et le plafond mensuel (VISION_MONTHLY_CAP_CENTS) ne comptera rien. Modèles tarifés : ${Object.keys(PRICES_USD_PER_MTOK).join(', ')}.`;
}

/**
 * Coût d'un appel, en centimes. `searchQueries` ajoute le coût des recherches
 * web, facturées par requête et non par jeton : une fournée de suggestions
 * peut en exécuter plusieurs, et à 35 $/1000 elles pèsent davantage que les
 * jetons d'un modèle « lite ». Les ignorer rendrait le plafond mensuel
 * mensonger dès que la recherche est active.
 *
 * `hasAudio` dit que l'appel portait de l'audio (demande parlée, D7 du
 * 2026-10-21). L'entrée audio coûte plus cher que le texte — de l'ordre du
 * triple pour Flash-Lite. Deux cas :
 *
 * - l'API rend `promptTokensDetails` : chaque modalité est facturée à son
 *   tarif, le reste des jetons d'entrée au tarif texte ;
 * - elle ne le rend pas : **tout** l'entrant passe au tarif audio. Un plafond
 *   de protection qui surestime reste un plafond ; un plafond qui sous-compte
 *   en silence n'en est plus un.
 *
 * Sans `hasAudio`, rien ne change : le scan photo et la recherche de recettes
 * écrites continuent d'être comptés au tarif texte.
 */
export function estimateCostCents(model: string, usage: GeminiResponse['usageMetadata'], searchQueries = 0, hasAudio = false): number | null {
  const price = priceFor(model);
  // Un modèle hors table laisse quand même compter les recherches : mieux vaut
  // un coût partiel qu'aucun coût, puisque c'est le plafond qui est en jeu.
  if (!usage && searchQueries === 0) return null;
  if (!price && searchQueries === 0) return null;
  let tokensUsd = 0;
  if (usage && price) {
    const promptTokens = usage.promptTokenCount ?? 0;
    const details = usage.promptTokensDetails ?? [];
    const audioDetails = details.filter((d) => d.modality?.toUpperCase() === 'AUDIO');
    const declaredAudio = audioDetails.reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
    /**
     * Repli de D7, sur la bonne condition (tour de correction 1) : ce qui
     * compte n'est pas qu'une ventilation existe, mais qu'elle **dise quelque
     * chose de l'audio**. Une ventilation qui ne porte qu'une ligne `TEXT`
     * sur un appel audio ne renseigne rien — la facturer au tarif texte
     * sous-compterait d'un facteur trois, en silence, ce que D7 interdit
     * précisément. Sans ligne `AUDIO`, tout l'entrant passe donc au tarif
     * audio, exactement comme si l'API n'avait rien ventilé.
     */
    const audioTokens = audioDetails.length > 0 ? Math.min(declaredAudio, promptTokens) : hasAudio ? promptTokens : 0;
    const textTokens = Math.max(0, promptTokens - audioTokens);
    tokensUsd = (textTokens * price.input + audioTokens * price.audio + (usage.candidatesTokenCount ?? 0) * price.output) / 1_000_000;
  }
  const searchUsd = (searchQueries * SEARCH_COST_USD_PER_1K) / 1000;
  return Math.round((tokensUsd + searchUsd) * 100 * 10_000) / 10_000;
}
