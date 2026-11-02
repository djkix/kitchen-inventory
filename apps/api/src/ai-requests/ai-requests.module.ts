import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AiRequestController } from './ai-request.controller.js';
import { AiRequestService } from './ai-request.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [AiRequestController],
  providers: [AiRequestService],
  exports: [AiRequestService],
})
export class AiRequestsModule {}
