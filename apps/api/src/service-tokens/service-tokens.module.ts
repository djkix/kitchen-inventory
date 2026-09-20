import { Module } from '@nestjs/common';
import { ServiceTokensController } from './service-tokens.controller.js';
import { ServiceTokensService } from './service-tokens.service.js';

@Module({ controllers: [ServiceTokensController], providers: [ServiceTokensService] })
export class ServiceTokensModule {}
