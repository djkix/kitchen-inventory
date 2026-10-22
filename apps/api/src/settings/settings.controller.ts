import { Controller, Get, Patch, Put } from '@nestjs/common';
import { geminiLimitsInputSchema, updateSettingsSchema, type GeminiLimitsInput, type GeminiStatus, type Settings, type UpdateSettingsInput } from '@kitchen/shared';
import { AdminOnly } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { GeminiService } from '../gemini/gemini.service.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly gemini: GeminiService,
  ) {}

  @Get()
  get(): Promise<Settings> {
    return this.settings.get();
  }

  /**
   * Modèles Gemini dans l'ordre d'emploi, consommation, limites et pause.
   * Réservé aux admins : la liste renseigne sur la configuration du fournisseur.
   */
  @AdminOnly()
  @Get('gemini')
  geminiStatus(): Promise<GeminiStatus> {
    return this.gemini.status();
  }

  @AdminOnly()
  @Put('gemini/limits')
  geminiLimits(@ZodBody(geminiLimitsInputSchema) body: GeminiLimitsInput): Promise<GeminiStatus> {
    return this.gemini.setLimits(body);
  }

  @AdminOnly()
  @Patch()
  update(@ZodBody(updateSettingsSchema) body: UpdateSettingsInput): Promise<Settings> {
    return this.settings.update(body);
  }
}
