import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@kitchen/shared';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ApiError } from './api-error.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'validation_failed',
  415: 'validation_failed',
  422: 'business_rule',
  429: 'rate_limited',
  502: 'provider_unavailable',
  503: 'not_ready',
};

const FRENCH_MESSAGES: Partial<Record<number, string>> = {
  400: 'Requête invalide',
  401: 'Session absente ou expirée',
  403: 'Action interdite',
  404: 'Ressource introuvable',
  413: 'Fichier trop volumineux',
  415: 'Type de contenu non pris en charge',
  429: 'Trop de requêtes, réessayez dans un instant',
  503: 'Service indisponible',
};

/** Convertit toute exception en enveloppe d'erreur normalisée. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'internal_error';
    let message = 'Erreur interne';
    let details: unknown;

    if (exception instanceof ApiError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'internal_error' : 'validation_failed');
      message = FRENCH_MESSAGES[status] ?? 'Requête refusée';
    } else {
      this.logger.error({ err: exception, path: request.url }, 'Exception non gérée');
    }

    if (status >= 500 && !(exception instanceof ApiError)) {
      // Jamais de détail technique vers le client.
      details = undefined;
    }

    response.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
  }
}
