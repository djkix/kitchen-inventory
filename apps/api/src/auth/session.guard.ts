import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../common/api-error.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ADMIN_ONLY_KEY, type AuthenticatedRequest } from './request-user.js';
import { SessionService } from './session.service.js';

/**
 * Ce qu'un jeton de service peut lire, et rien d'autre : l'inventaire, de quoi
 * le nommer, et la vérification de vie.
 *
 * La lecture seule ne suffisait pas (audit du 2026-11-11) : elle ouvrait aussi
 * l'export complet, les tickets de caisse, les médias et le journal des
 * réalisations du foyer à un jeton posé dans une intégration domotique. Un
 * jeton sert à lire le stock ; tout le reste demande un compte. `/suggestions`
 * y reste : la revue du 2026-10-22 en a fait une lecture qui n'appelle jamais
 * le modèle, et un lecteur extérieur peut légitimement l'afficher.
 */
const SERVICE_TOKEN_PREFIXES = ['/stock', '/products', '/locations', '/categories', '/suggestions', '/health', '/me'];

/** Le chemin sous `/api/v1`, tel que les préfixes ci-dessus l'écrivent. */
function apiPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path.replace(/^\/api\/v1/, '');
}

export function serviceTokenMayRead(url: string): boolean {
  const path = apiPath(url);
  return SERVICE_TOKEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Garde globale : toute route exige une session valide (cookie `sid`) ou un
 * jeton de service (`Authorization: Bearer kit_…`, lecture seule, et seulement
 * sur l'inventaire), sauf les routes marquées `@Public()`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [context.getHandler(), context.getClass()]);

    const user = await this.sessions.authenticate(request);
    if (user) request.user = user;
    if (isPublic) return true;
    if (!user) throw ApiError.unauthenticated();
    if (user.via === 'service-token') {
      if (request.method !== 'GET') throw ApiError.forbidden('Un jeton de service ne permet que la lecture');
      if (!serviceTokenMayRead(request.originalUrl ?? request.url)) {
        throw ApiError.forbidden("Un jeton de service ne donne accès qu'à l'inventaire");
      }
    }
    if (adminOnly && user.role !== 'ADMIN') throw ApiError.forbidden();
    return true;
  }
}
