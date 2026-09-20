import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../common/api-error.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ADMIN_ONLY_KEY, type AuthenticatedRequest } from './request-user.js';
import { SessionService } from './session.service.js';

/**
 * Garde globale : toute route exige une session valide (cookie `sid`) ou un
 * jeton de service (`Authorization: Bearer kit_…`, lecture seule), sauf les
 * routes marquées `@Public()`.
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
    if (user.via === 'service-token' && request.method !== 'GET') {
      throw ApiError.forbidden('Un jeton de service ne permet que la lecture');
    }
    if (adminOnly && user.role !== 'ADMIN') throw ApiError.forbidden();
    return true;
  }
}
