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

  /**
   * Réglage ponctuel non couvert par `settingsSchema` (section 22 ne liste que
   * `expiryAlertDays`) : lecture brute d'une clé numérique de la table
   * `Setting`, par exemple le seuil « pas faite depuis longtemps » des
   * statistiques de recettes (`recipeForgottenAfterDays`). `undefined` laisse
   * l'appelant appliquer son propre défaut.
   */
  async rawNumber(key: string): Promise<number | undefined> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row && typeof row.value === 'number' ? row.value : undefined;
  }
}
