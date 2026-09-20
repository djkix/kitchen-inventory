import { Inject, Injectable } from '@nestjs/common';
import { settingsSchema, type Settings, type UpdateSettingsInput } from '@kitchen/shared';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Réglages d'instance (section 22) : valeur en base, sinon variable d'environnement, sinon défaut. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const parsed = settingsSchema.safeParse({ expiryAlertDays: this.config.EXPIRY_ALERT_DAYS, ...stored });
    return parsed.success ? parsed.data : { expiryAlertDays: this.config.EXPIRY_ALERT_DAYS };
  }

  async update(input: UpdateSettingsInput): Promise<Settings> {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    return this.get();
  }

  async expiryAlertDays(): Promise<number> {
    return (await this.get()).expiryAlertDays;
  }
}
