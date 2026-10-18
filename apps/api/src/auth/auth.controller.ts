import { Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { googleLoginSchema, recoveryLoginSchema, type AuthStatus, type CurrentUser, type GoogleLoginInput, type RecoveryLoginInput } from '@kitchen/shared';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { AuthService, toCurrentUser } from './auth.service.js';
import { Public } from './public.decorator.js';
import { CurrentUser as User, type RequestUser } from './request-user.js';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('auth/status')
  async status(): Promise<AuthStatus> {
    return { setupRequired: await this.auth.setupRequired() };
  }

  /**
   * Client ID servi à l'exécution : Vite fige ses variables au build et l'image
   * est construite une seule fois par la CI (piège n° 1 du guide). Vide = le
   * front n'affiche pas de bouton.
   */
  @Public()
  @Get('auth/google/client-id')
  clientId(): { clientId: string } {
    return { clientId: this.config.GOOGLE_CLIENT_ID };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/google')
  @HttpCode(200)
  loginWithGoogle(@ZodBody(googleLoginSchema) body: GoogleLoginInput, @Res({ passthrough: true }) res: Response): Promise<CurrentUser> {
    return this.auth.loginWithGoogle(body, res);
  }

  /**
   * Porte de secours (D6). Volontairement absente de l'interface : aucun
   * formulaire ne la présente, et elle n'ouvre rien tant que
   * `tools/acces-secours.ts` n'a pas posé de mot de passe à usage unique.
   * Même limitation de débit que `POST /auth/google`.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/recovery')
  @HttpCode(200)
  loginWithRecovery(@ZodBody(recoveryLoginSchema) body: RecoveryLoginInput, @Res({ passthrough: true }) res: Response): Promise<CurrentUser> {
    return this.auth.loginWithRecovery(body, res);
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@User() user: RequestUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    return this.auth.logout(user, res);
  }

  @Get('me')
  me(@User() user: RequestUser): CurrentUser {
    return toCurrentUser(user);
  }
}
