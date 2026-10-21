import type { HttpClient } from '../common/http-client.js';
import { countSearchQueries, estimateCostCents, type GeminiResponse } from '../recognition/providers/gemini.provider.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { buildSuggestionPrompt, buildVoicePrompt, InvalidBatchJsonError, parseModelBatch, parseVoiceBatch, SUGGESTION_SYSTEM_PROMPT, SUGGESTION_SYSTEM_PROMPT_NO_SEARCH } from './prompt.js';
import {
  SuggestionProviderError,
  type SuggestionAttempt,
  type SuggestionOutput,
  type SuggestionRequest,
  type VoiceSuggestionOutput,
  type VoiceSuggestionRequest,
} from './suggestion-provider.js';

/** Partie d'un message envoyé au modèle : du texte, ou une pièce jointe encodée (photo, audio). */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
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
export class GeminiSuggestionProvider {
  readonly name = 'gemini';
  readonly enabled: boolean;
  private readonly model: string;

  constructor(private readonly options: { apiKey?: string; model?: string; baseURL?: string; httpClient: HttpClient }) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.enabled = Boolean(options.apiKey);
  }

  async suggest(req: SuggestionRequest): Promise<SuggestionOutput> {
    if (!this.options.apiKey) throw new ProviderError('Fournisseur de suggestions désactivé');

    // Chaque tentative est conservée, y compris quand la suivante réussit ou
    // quand tout échoue : elle a été facturée, elle doit être journalisée.
    const attempts: SuggestionAttempt[] = [];
    const model = req.model ?? this.model;
    const webSearch = req.webSearch !== false;

    // Vigilance 1 : une seule reprise, jamais une troisième tentative.
    for (const retry of [false, true]) {
      const started = Date.now();
      let raw: GeminiResponse;
      try {
        raw = await this.call([{ text: buildSuggestionPrompt(req, { retry }) }], model, webSearch);
      } catch (error) {
        // Appel qui n'aboutit pas : rien à facturer pour celui-ci, mais les
        // précédents le sont — l'erreur les emporte pour qu'ils soient inscrits.
        if (attempts.length === 0) throw error;
        throw new SuggestionProviderError(error instanceof Error ? error.message : String(error), attempts, error);
      }
      attempts.push({ raw, costCents: estimateCostCents(model, raw.usageMetadata, countSearchQueries(raw)), latencyMs: Date.now() - started });

      try {
        return this.toOutput(raw, attempts, req.count, model);
      } catch (error) {
        if (!(error instanceof InvalidBatchJsonError)) throw error;
        if (retry) {
          throw new SuggestionProviderError('Le fournisseur de suggestions n’a pas renvoyé de JSON exploitable après reprise', attempts, error);
        }
      }
    }
    // Inatteignable : la boucle rend un résultat ou lève à la seconde passe.
    throw new ProviderError('Fournisseur de suggestions sans réponse exploitable');
  }

  /**
   * Demande parlée (spécification du 2026-10-21, D2) : l'enregistrement part
   * avec la consigne, et le modèle rend sa lecture **et** les recettes dans la
   * même réponse.
   *
   * Aucune reprise, contrairement à `suggest` : une seconde tentative
   * renverrait l'audio, donc repaierait l'entrée la plus chère de toutes
   * (D7), pour un défaut de format que rien ne garantit corrigé. Une réponse
   * illisible est un échec net, annoncé comme tel.
   *
   * L'audio ne sort pas d'ici : il n'est ni écrit, ni recopié dans un message
   * d'erreur (D6). Ce qui remonte dans `attempts[].raw` est la réponse du
   * modèle, jamais la requête.
   */
  async suggestFromVoice(req: VoiceSuggestionRequest): Promise<VoiceSuggestionOutput> {
    if (!this.options.apiKey) throw new ProviderError('Fournisseur de suggestions désactivé');
    const model = req.model ?? this.model;
    const started = Date.now();
    const raw = await this.call(
      [{ inlineData: { mimeType: req.mimeType, data: req.audio.toString('base64') } }, { text: buildVoicePrompt(req) }],
      model,
      req.webSearch !== false,
    );
    const attempts: SuggestionAttempt[] = [
      // `hasAudio` : sans ventilation par modalité, tout l'entrant est facturé
      // au tarif audio (D7). Un plafond qui surestime reste un plafond.
      { raw, costCents: estimateCostCents(model, raw.usageMetadata, countSearchQueries(raw), true), latencyMs: Date.now() - started },
    ];
    try {
      const batch = parseVoiceBatch(extractText(raw));
      return { heard: batch.heard, recipes: batch.recipes.slice(0, req.count), attempts, model };
    } catch (error) {
      if (!(error instanceof InvalidBatchJsonError)) throw error;
      throw new SuggestionProviderError('Le fournisseur de suggestions n’a pas renvoyé de JSON exploitable pour la demande parlée', attempts, error);
    }
  }

  /**
   * Le nombre de recettes demandées est la seule borne qui fasse sens ici : elle
   * dépend de l'appel (`SuggestionRequest.count`), pas d'une limite structurelle du
   * schéma. Un modèle qui en renvoie davantage est tronqué, jamais rejeté : ce n'est
   * pas une réponse malformée, juste trop généreuse.
   */
  private toOutput(raw: GeminiResponse, attempts: SuggestionAttempt[], count: number, model: string): SuggestionOutput {
    const batch = parseModelBatch(extractText(raw));
    return { recipes: batch.recipes.slice(0, count), attempts, model };
  }

  private async call(parts: GeminiPart[], model: string, webSearch: boolean): Promise<GeminiResponse> {
    const base = (this.options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey ?? '' },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: webSearch ? SUGGESTION_SYSTEM_PROMPT : SUGGESTION_SYSTEM_PROMPT_NO_SEARCH }] },
          contents: [{ role: 'user', parts }],
          // La recherche web est l'intérêt même de ce fournisseur : elle interdit
          // `responseSchema` (vigilance 1). Elle est aussi facturée par requête,
          // à part des jetons, et certaines clés la refusent — d'où le réglage
          // qui permet de s'en passer sans perdre les suggestions.
          ...(webSearch ? { tools: [{ google_search: {} }] } : {}),
          // `temperature`, `top_p` et `top_k` sont dépréciés côté Gemini : sans
          // effet depuis la 3.6 Flash, ils deviendront une erreur. Le modèle
          // applique ses propres valeurs, qui sont les bonnes.
          generationConfig: { maxOutputTokens: 8192 },
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
