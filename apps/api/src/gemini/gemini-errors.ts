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

/**
 * Délai des appels de génération (`generateContent`).
 *
 * Il valait 45 s, un pari sur une latence qui n'est plus celle des modèles
 * actuels : mesuré le 2026-11-09 sur le serveur de production, un lot de six
 * recettes demande 65 s à `gemini-3.6-flash`, et 44,5 s en désactivant la
 * réflexion — soit la borne elle-même. L'application coupait donc une requête
 * que Google allait honorer, et comme un délai dépassé n'a pas de code HTTP,
 * elle ne pouvait ni basculer de modèle ni nommer la cause : l'écran disait
 * « injoignable » alors que Gemini répondait.
 *
 * Attendre deux minutes est devenu supportable depuis la notification de
 * résultat (EF-31) : l'écran quitté, le serveur poursuit et annonce.
 */
export const GENERATION_TIMEOUT_MS = 120_000;

/**
 * Délai dépassé plutôt que panne : `AbortSignal.timeout` rejette avec
 * `TimeoutError`, et un `AbortError` vient d'une annulation. Ni l'un ni l'autre
 * ne porte de statut, d'où la distinction par le nom.
 */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * Message d'un échec de transport, qui ne confond plus « pas de réponse à
 * temps » avec « injoignable ». Le premier se répare en réessayant, le second
 * en regardant le réseau ou la clé : les dire pareil fait chercher au mauvais
 * endroit.
 */
export function transportMessage(quoi: string, error: unknown): string {
  if (isTimeout(error)) return `${quoi} : Gemini n’a pas répondu en ${Math.round(GENERATION_TIMEOUT_MS / 1000)} s`;
  return `${quoi} injoignable`;
}
