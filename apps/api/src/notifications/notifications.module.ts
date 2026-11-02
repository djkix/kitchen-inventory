import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { PushService } from './push.service.js';

@Module({ controllers: [NotificationsController], providers: [PushService], exports: [PushService] })
export class NotificationsModule {}
