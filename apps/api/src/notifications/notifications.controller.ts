import { Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { pushSubscriptionSchema, unsubscribeSchema, type PushPublicKeyDto, type PushSubscriptionInput, type UnsubscribeInput } from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { PushService } from './push.service.js';

/**
 * Abonnement de l'appareil aux notifications. La clé publique est servie à
 * l'exécution, comme `GOOGLE_CLIENT_ID` : elle dépend de l'installation et
 * n'a donc rien à faire dans l'image.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  publicKey(): PushPublicKeyDto {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscription')
  @HttpCode(204)
  subscribe(
    @ZodBody(pushSubscriptionSchema) body: PushSubscriptionInput,
    @CurrentUser() user: RequestUser,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    return this.push.subscribe(user.id, body, userAgent);
  }

  @Delete('subscription')
  @HttpCode(204)
  unsubscribe(@ZodBody(unsubscribeSchema) body: UnsubscribeInput, @CurrentUser() user: RequestUser): Promise<void> {
    return this.push.unsubscribe(user.id, body.endpoint);
  }
}
