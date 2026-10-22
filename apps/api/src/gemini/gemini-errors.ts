import { ApiError } from '../common/api-error.js';

/**
 * Gemini ne peut pas être appelé avant `until` : pause commune après un 429 ou
 * un 503, ou quota atteint (local, ou journalier chez Google). Le message, en
 * français, porte l'heure de reprise et se dit tel quel à l'utilisateur.
 */
export class GeminiPausedError extends Error {
  constructor(
    readonly until: Date,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiPausedError';
  }
}

/** Quota d'un modèle atteint : `day` fait basculer sur le modèle suivant. */
export class GeminiQuotaError extends GeminiPausedError {
  constructor(
    until: Date,
    readonly reason: 'minute' | 'tokens' | 'day',
    message: string,
  ) {
    super(until, message);
    this.name = 'GeminiQuotaError';
  }
}

/** Réponse 429 d'un refus de Gemini : message avec l'heure de reprise, et `retryAt` pour l'écran. */
export function geminiRefusal(error: GeminiPausedError, details: Record<string, unknown> = {}): ApiError {
  return ApiError.rateLimited(error.message, { ...details, retryAt: error.until.toISOString() });
}
