import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { changePasswordSchema, loginSchema, setupSchema, type AuthStatus, type ChangePasswordInput, type CurrentUser, type LoginInput, type SetupInput } from '@kitchen/shared';
import type { Response } from 'express';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { AuthService, toCurrentUser } from './auth.service.js';
import { Public } from './public.decorator.js';
import { CurrentUser as User, type RequestUser } from './request-user.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('auth/status')
  async status(): Promise<AuthStatus> {
    return { setupRequired: await this.auth.setupRequired() };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/setup')
  setup(@ZodBody(setupSchema) body: SetupInput, @Res({ passthrough: true }) res: Response): Promise<CurrentUser> {
    return this.auth.setup(body, res);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login')
  @HttpCode(204)
  login(@ZodBody(loginSchema) body: LoginInput, @Res({ passthrough: true }) res: Response): Promise<void> {
    return this.auth.login(body, res);
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

  @Post('me/password')
  @HttpCode(204)
  changePassword(@User() user: RequestUser, @ZodBody(changePasswordSchema) body: ChangePasswordInput): Promise<void> {
    return this.auth.changePassword(user, body);
  }
}
