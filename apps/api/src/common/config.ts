import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { VISION_PROVIDERS } from '@kitchen/shared';
import { z } from 'zod';

/**
 * Variables d'environnement de la section 9, validées au démarrage. Une valeur
 * absente ou invalide empêche le démarrage avec un message explicite plutôt
 * qu'un comportement silencieusement dégradé.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),
  SECRET_KEY: z.string().min(32, 'SECRET_KEY doit faire au moins 32 caractères'),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  VISION_PROVIDER: z.enum(VISION_PROVIDERS).default('none'),
  VISION_API_KEY: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  // Modèle des appels recettes (suggestions et réécriture), séparé de la reconnaissance
  // photo : celle-ci lit des étiquettes, celles-là cherchent sur le web. Défaut
  // `gemini-3.5-flash-lite`, le moins cher des modèles utilisables ici.
  SUGGESTION_MODEL: z.string().optional(),
  // Recherche web réelle pour les suggestions. Valeur de départ : un
  // administrateur la remplace depuis Réglages, et son choix prime.
  SUGGESTION_WEB_SEARCH: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  VISION_BASE_URL: z.string().url().optional(),
  VISION_DAILY_QUOTA: z.coerce.number().int().min(0).default(50),
  // Plafond de dépense mensuel, en centimes, partagé par la reconnaissance photo et
  // les suggestions de recettes (EF-26, section 9 de la spec). Porté de 2 € à 5 €
  // par mois quand les suggestions ont été ajoutées au même compteur ; 0 désactive
  // le plafond.
  VISION_MONTHLY_CAP_CENTS: z.coerce.number().int().min(0).default(500),
  // Quota journalier propre aux suggestions de recettes (EF-26), pour éviter
  // l'emballement malgré le plafond de dépense partagé.
  RECIPE_SUGGESTION_DAILY_QUOTA: z.coerce.number().int().min(0).default(20),
  OFF_USER_AGENT: z.string().default('KitchenInventory/0.1 (self-hosted; https://github.com/djkix/kitchen-inventory)'),
  OFF_BASE_URL: z.string().url().default('https://world.openfoodfacts.org'),
  EXPIRY_ALERT_DAYS: z.coerce.number().int().min(0).max(365).default(7),
  MEDIA_DIR: z.string().default('./media'),
  WEB_DIST_DIR: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  APP_VERSION: z.string().default('0.0.0-dev'),
});

export type AppConfig = z.infer<typeof configSchema> & {
  migrationsDir: string;
  mediaDir: string;
  webDistDir: string | null;
  isDev: boolean;
  isTest: boolean;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

function firstExisting(candidates: string[]): string {
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

/**
 * Docker Compose transmet `VAR=` comme une chaîne vide, pas comme une variable
 * absente : sans ce nettoyage, `VISION_BASE_URL=` est une « URL invalide » et
 * `VISION_MODEL=` deviendrait un nom de modèle vide.
 */
export function dropEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(dropEmptyValues(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${lines}`);
  }
  const c = parsed.data;
  const cwd = process.cwd();
  return {
    ...c,
    migrationsDir: c.MIGRATIONS_DIR ?? firstExisting([resolve(cwd, 'prisma/migrations'), resolve(cwd, '../../prisma/migrations')]),
    mediaDir: resolve(cwd, c.MEDIA_DIR),
    webDistDir: c.WEB_DIST_DIR ? resolve(cwd, c.WEB_DIST_DIR) : firstExisting([resolve(cwd, 'web'), resolve(cwd, '../web/dist')]),
    isDev: c.NODE_ENV === 'development',
    isTest: c.NODE_ENV === 'test',
  };
}
