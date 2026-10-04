import type { ErrorCode } from '@kitchen/shared';

/**
 * Erreur métier ou technique renvoyée au client sous la forme unique de la
 * section 16 : `{ error: { code, message, details? } }`, message en français.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(message = 'Ressource introuvable', details?: unknown): ApiError {
    return new ApiError(404, 'not_found', message, details);
  }
  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }
  static businessRule(message: string, details?: unknown): ApiError {
    return new ApiError(422, 'business_rule', message, details);
  }
  static forbidden(message = 'Action réservée à un administrateur'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }
  static unauthenticated(message = 'Session absente ou expirée'): ApiError {
    return new ApiError(401, 'unauthenticated', message);
  }
  static rateLimited(message: string, details?: unknown): ApiError {
    return new ApiError(429, 'rate_limited', message, details);
  }
  static providerUnavailable(message: string, details?: unknown): ApiError {
    return new ApiError(502, 'provider_unavailable', message, details);
  }
  /**
   * Fournisseur non configuré (clé absente) : un état du serveur qui interdit
   * de poursuivre, pas un échec d'appel (jamais 502) ni un conflit de
   * ressource (jamais 409) — 422, comme le reste des règles métier du projet,
   * mais avec un code dédié pour que l'écran distingue « configurez une clé »
   * d'une règle métier générique.
   */
  static providerDisabled(message: string, details?: unknown): ApiError {
    return new ApiError(422, 'provider_disabled', message, details);
  }
}

/**
 * Garde commune à `RecognitionService` et `SuggestionsService` : même condition
 * (`provider.enabled === false`), même code d'erreur, même gabarit de message —
 * seul le nom du fournisseur change. `label` est le nom tel qu'il apparaît dans
 * le message français (« vision », « suggestions »).
 */
export function assertProviderEnabled(provider: { enabled: boolean }, label: string): void {
  if (!provider.enabled) {
    throw ApiError.providerDisabled(`Fournisseur de ${label} désactivé : renseignez VISION_PROVIDER et VISION_API_KEY`);
  }
}
