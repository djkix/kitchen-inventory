import { Controller, Get, Patch } from '@nestjs/common';
import { updateSettingsSchema, type AvailableModels, type Settings, type UpdateSettingsInput } from '@kitchen/shared';
import { AdminOnly } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { AvailableModelsService } from './available-models.service.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly availableModels: AvailableModelsService,
  ) {}

  @Get()
  get(): Promise<Settings> {
    return this.settings.get();
  }

  /**
   * Modèles servis par la clé configurée. Réservé aux admins : seuls eux
   * peuvent changer le réglage, et la liste renseigne indirectement sur la
   * configuration du fournisseur.
   */
  @AdminOnly()
  @Get('models')
  models(): Promise<AvailableModels> {
    return this.availableModels.list();
  }

  @AdminOnly()
  @Patch()
  update(@ZodBody(updateSettingsSchema) body: UpdateSettingsInput): Promise<Settings> {
    return this.settings.update(body);
  }
}
