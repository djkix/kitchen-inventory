import { ApiError } from '../common/api-error.js';

/**
 * Gemini ne peut pas être appelé avant `until` : pause commune après un 429 non
 * journalier, ou modèle arrêté (quota local, quota du jour, saturation). Le message, en
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

/** Modèle indisponible : `day` et `overloaded` font basculer sur le suivant. */
export class GeminiQuotaError extends GeminiPausedError {
  constructor(
    until: Date,
    readonly reason: 'minute' | 'tokens' | 'day' | 'overloaded',
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
