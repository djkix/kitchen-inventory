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
    // Une valeur stockée vide vaut « pas de choix » : elle rend la main à
    // l'environnement, sinon un réglage effacé à l'écran masquerait le `.env`
    // par une chaîne vide, et le fournisseur appellerait un modèle sans nom.
    const stored = Object.fromEntries(rows.filter((r) => r.value !== '').map((r) => [r.key, r.value]));
    const fromEnv = {
      expiryAlertDays: this.config.EXPIRY_ALERT_DAYS,
      ...(this.config.VISION_MODEL ? { visionModel: this.config.VISION_MODEL } : {}),
      ...(this.config.SUGGESTION_MODEL ? { suggestionModel: this.config.SUGGESTION_MODEL } : {}),
      // Recherche web active par défaut : c'est la fonctionnalité demandée
      // (« des recettes trouvées sur internet »), pas une option à activer.
      suggestionWebSearch: this.config.SUGGESTION_WEB_SEARCH ?? true,
    };
    const parsed = settingsSchema.safeParse({ ...fromEnv, ...stored });
    return parsed.success ? parsed.data : fromEnv;
  }

  /**
   * Modèle de la reconnaissance photo, résolu à chaque appel et non au
   * démarrage : un réglage changé depuis l'écran doit valoir immédiatement,
   * sans redémarrage du conteneur. `undefined` laisse le fournisseur appliquer
   * son propre défaut.
   */
  async visionModel(): Promise<string | undefined> {
    return (await this.get()).visionModel;
  }

  /** Modèle des appels recettes (suggestions et réécriture), même résolution par appel. */
  async suggestionModel(): Promise<string | undefined> {
    return (await this.get()).suggestionModel;
  }

  /** Recherche web réelle pour les suggestions, même résolution par appel. */
  async suggestionWebSearch(): Promise<boolean> {
    return (await this.get()).suggestionWebSearch;
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
