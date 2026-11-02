import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AiRequestController } from './ai-request.controller.js';
import { AiRequestService } from './ai-request.service.js';
import { DeferralService } from './deferral.service.js';

@Module({
  imports: [NotificationsModule, MediaModule],
  controllers: [AiRequestController],
  providers: [AiRequestService, DeferralService],
  exports: [AiRequestService, DeferralService],
})
export class AiRequestsModule {}
