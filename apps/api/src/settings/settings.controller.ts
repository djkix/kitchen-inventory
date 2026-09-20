import { Controller, Get, Patch } from '@nestjs/common';
import { updateSettingsSchema, type Settings, type UpdateSettingsInput } from '@kitchen/shared';
import { AdminOnly } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<Settings> {
    return this.settings.get();
  }

  @AdminOnly()
  @Patch()
  update(@ZodBody(updateSettingsSchema) body: UpdateSettingsInput): Promise<Settings> {
    return this.settings.update(body);
  }
}
