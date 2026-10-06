import { Global, Module } from '@nestjs/common';
import { AvailableModelsService } from './available-models.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService, AvailableModelsService], exports: [SettingsService] })
export class SettingsModule {}
