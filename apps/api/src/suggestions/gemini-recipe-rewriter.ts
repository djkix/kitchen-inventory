import { recipeRewriteSchema, UNITS, type RecipeRewrite } from '@kitchen/shared';
import type { HttpClient } from '../common/http-client.js';
import { estimateCostCents, type GeminiResponse } from '../recognition/providers/gemini.provider.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { stripJsonFences } from './prompt.js';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Matière fournie pour la réécriture (tâche 9, B6) : soit le contenu structuré lu sur la page, soit son texte nettoyé. */
export interface RecipeRewriteInput {
  title: string;
  origin: string;
  ingredients: string[];
  steps: string[];
  pageText: string | null;
}

export interface RecipeRewriteOutput {
  recipe: RecipeRewrite;
  raw: unknown;
  costCents: number | null;
}

const REWRITE_SYSTEM_PROMPT = `Tu réécris une recette de cuisine lue sur une page web, dans le format attendu par une application d'inventaire domestique.
Tu ne fais que restituer la recette telle que trouvée, sans l'inventer ni la modifier.
Tu réponds strictement par un objet JSON, sans texte avant ni après, sans clôtures de bloc de code (pas de \`\`\`).`;

function buildRewritePrompt(input: RecipeRewriteInput): string {
  const lines: string[] = [`Titre de la recette : ${input.title}`, `Site d'origine : ${input.origin}`];
  if (input.ingredients.length > 0 || input.steps.length > 0) {
    lines.push(
      'Ingrédients tels que lus sur la page :',
      ...input.ingredients.map((i) => `- ${i}`),
      'Étapes telles que lues sur la page :',
      ...input.steps.map((s) => `- ${s}`),
    );
  } else {
    lines.push('Texte nettoyé de la page (aucune donnée structurée trouvée) :', input.pageText ?? '');
  }
  lines.push(
    'Réponds par un objet JSON unique de la forme { "title": string, "steps": string[], "ingredients": [{ "label": string, "quantity": number|null, "unit": string|null }] }.',
    `Les unités possibles pour "unit" sont : ${UNITS.join(', ')}. Laisse "quantity" et "unit" à null si la quantité n'est pas chiffrée (« une pincée », « au goût »).`,
    'Garde les étapes dans leur ordre d\'origine, une action par étape, reformulées en français si besoin.',
    'Aucun texte, aucune explication, aucune clôture de bloc de code autour de cet objet JSON.',
  );
  return lines.join('\n');
}

/**
 * Réécriture d'une recette lue sur le web au format de l'application (tâche
 * 9, B6) : même fournisseur, même client HTTP, même comptage de coût que
 * `GeminiSuggestionProvider` — pas d'outil de recherche ici, la page est déjà
 * en main, donc `responseSchema` n'a pas besoin d'être exclu.
 */
export class GeminiRecipeRewriter {
  readonly enabled: boolean;
  private readonly model: string;

  constructor(private readonly options: { apiKey?: string; model?: string; baseURL?: string; httpClient: HttpClient }) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.enabled = Boolean(options.apiKey);
  }

  async rewrite(input: RecipeRewriteInput): Promise<RecipeRewriteOutput> {
    if (!this.options.apiKey) throw new ProviderError('Fournisseur de suggestions désactivé');

    const base = (this.options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: REWRITE_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: buildRewritePrompt(input) }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      });
    } catch (error) {
      throw new ProviderError('Fournisseur de suggestions Gemini injoignable', error);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('Clé API Gemini refusée');
    if (response.status === 429) throw new ProviderError('Quota Gemini atteint');
    if (!response.ok) throw new ProviderError(`Fournisseur de suggestions Gemini en erreur (${response.status})`);

    const raw = (await response.json()) as GeminiResponse;
    if (raw.promptFeedback?.blockReason) throw new ProviderError('Gemini a refusé la réécriture de la recette');
    const candidate = raw.candidates?.[0];
    if (!candidate) throw new ProviderError('Gemini n’a pas produit de réponse (aucun candidat)');
    if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('Réponse de réécriture tronquée par la limite de jetons');
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      throw new ProviderError(`Gemini n’a pas produit de réponse (${candidate.finishReason})`);
    }

    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const stripped = stripJsonFences(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      throw new ProviderError('JSON de réécriture illisible');
    }
    const result = recipeRewriteSchema.safeParse(parsed);
    if (!result.success) throw new ProviderError('Réponse de réécriture non conforme au schéma', result.error.issues);

    return { recipe: result.data, raw, costCents: estimateCostCents(this.model, raw.usageMetadata) };
  }
}
