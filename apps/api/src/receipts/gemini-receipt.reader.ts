import type { HttpClient } from '../common/http-client.js';
import { estimateCostCents, throwQuotaRefusal, type GeminiResponse } from '../recognition/providers/gemini.provider.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';

export type RawReceiptLine = { label: string; quantity: number };

/**
 * Types acceptés à l'envoi d'un ticket : les images du scan, plus le PDF. Liste propre
 * aux tickets, distincte de celle de `MediaService` : le ticket n'est jamais enregistré
 * (EF-29), et élargir `isSupportedMime` ferait accepter un PDF au scan photo.
 */
export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif', 'application/pdf'] as const;

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

const SYSTEM_PROMPT = `Tu lis un ticket de caisse de supermarché, fourni en photo ou en PDF.
Rends chaque ligne imprimée dans l'ordre du ticket, avec :
- label : le libellé recopié tel qu'il est imprimé, abréviations comprises, sans le corriger ni le développer ;
- quantity : le nombre d'unités achetées (« 3 x RIZ » donne 3), 1 si rien n'est indiqué ;
- kind : PRODUCT pour un produit alimentaire, OTHER pour tout le reste (sacs, consigne, remises, total, sous-total, TVA, fidélité, moyen de paiement, rendu monnaie, produits non alimentaires).
N'invente aucune ligne.`;

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    required: ['label', 'quantity', 'kind'],
    properties: {
      label: { type: 'STRING' },
      quantity: { type: 'NUMBER' },
      kind: { type: 'STRING', enum: ['PRODUCT', 'OTHER'] },
    },
  },
} as const;

/** Échec survenu APRÈS une réponse facturée : porte le coût, comme `SuggestionProviderError` porte ses tentatives. */
export class ReceiptReadError extends ProviderError {
  constructor(
    message: string,
    readonly costCents: number | null,
    readonly raw: GeminiResponse,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'ReceiptReadError';
  }
}

/**
 * Lecture d'un ticket de caisse (EF-29). Le modèle ne fait que lire : le
 * rapprochement au catalogue est une règle pure de `packages/shared`.
 * Le fichier n'est jamais conservé, ni ici ni dans un message d'erreur.
 */
export class GeminiReceiptReader {
  constructor(private readonly options: { apiKey?: string; model?: string; baseURL?: string; httpClient: HttpClient }) {}

  async read(file: Buffer, mimeType: string, model?: string): Promise<{ lines: RawReceiptLine[]; raw: GeminiResponse; costCents: number | null }> {
    if (!this.options.apiKey) throw new ProviderError('Lecture de ticket désactivée');
    const used = model ?? this.options.model ?? DEFAULT_MODEL;
    const base = (this.options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.options.httpClient(`${base}/v1beta/models/${encodeURIComponent(used)}:generateContent`, {
        method: 'POST',
        // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: file.toString('base64') } }, { text: 'Lis ce ticket.' }] }],
          generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
      });
    } catch (error) {
      throw new ProviderError('Fournisseur de lecture de ticket Gemini injoignable', error);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('Clé API Gemini refusée');
    if (response.status === 429) await throwQuotaRefusal(response);
    if (!response.ok) throw new ProviderError(`Fournisseur de lecture de ticket Gemini en erreur (${response.status})`);

    const raw = (await response.json()) as GeminiResponse;
    // La réponse est reçue donc facturée : tout échec d'ici à la fin porte son coût
    // (`ReceiptReadError`), pour que l'appelant l'inscrive et que le plafond mensuel compte juste.
    const costCents = estimateCostCents(used, raw.usageMetadata);
    let lines: RawReceiptLine[];
    try {
      lines = interpret(raw);
    } catch (error) {
      if (error instanceof ProviderError) throw new ReceiptReadError(error.message, costCents, raw, error);
      throw error;
    }
    return { lines, raw, costCents };
  }
}

/** Contrôles portant sur une réponse déjà reçue. Lève `ProviderError` ; l'appelant y joint le coût. */
function interpret(raw: GeminiResponse): RawReceiptLine[] {
  if (raw.promptFeedback?.blockReason) throw new ProviderError('Gemini a refusé de lire ce ticket');
  const candidate = raw.candidates?.[0];
  if (!candidate) throw new ProviderError('Gemini n’a pas produit de réponse (aucun candidat)');
  if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('Ticket trop long : la lecture a été tronquée');
  if (candidate.finishReason && candidate.finishReason !== 'STOP') throw new ProviderError(`Gemini n’a pas produit de réponse (${candidate.finishReason})`);

  const lines = parseLines((candidate.content?.parts ?? []).map((p) => p.text ?? '').join(''));
  if (lines.length === 0) throw new ProviderError('Aucun produit lisible sur ce ticket. Cadrez-le entièrement, bien à plat, et réessayez.');
  return lines;
}

/** Ne garde que les produits, dans l'ordre ; une quantité absente ou invalide vaut 1. */
function parseLines(text: string): RawReceiptLine[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProviderError('Le fournisseur n’a pas renvoyé de lecture exploitable pour ce ticket');
  }
  if (!Array.isArray(data)) throw new ProviderError('Le fournisseur n’a pas renvoyé de lecture exploitable pour ce ticket');
  const lines: RawReceiptLine[] = [];
  for (const item of data as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { label, quantity, kind } = item as Record<string, unknown>;
    if (kind !== 'PRODUCT' || typeof label !== 'string' || label.trim() === '') continue;
    lines.push({ label: label.trim(), quantity: typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? quantity : 1 });
  }
  return lines;
}
