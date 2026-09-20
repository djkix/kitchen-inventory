import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  via: 'session' | 'service-token';
  /** Identifiant de la session, pour la révoquer à la déconnexion. */
  sessionId: string | null;
}

export type AuthenticatedRequest = Request & { user?: RequestUser };

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
});

export const ADMIN_ONLY_KEY = 'adminOnly';
/** Route réservée aux administrateurs : `403 forbidden` sinon. */
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY_KEY, true);
