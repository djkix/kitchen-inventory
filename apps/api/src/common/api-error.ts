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
  /** Fournisseur non configuré (clé absente) : un état du serveur, pas un échec d'appel — jamais 502. */
  static providerDisabled(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'provider_disabled', message, details);
  }
}
