import { z } from 'zod';

export const settingsSchema = z.object({
  expiryAlertDays: z.number().int().min(0).max(365),
  /**
   * Recherche web réelle pour les suggestions (outil `google_search`). Activée,
   * une partie des recettes vient de pages trouvées en ligne ; désactivée, le
   * modèle les compose toutes lui-même. Google facture chaque requête de
   * recherche à part des jetons, hors du plafond mensuel de l'application :
   * c'est pour cela que le choix revient à l'administrateur et non au code.
   */
  suggestionWebSearch: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** Limites d'un modèle chez Google, réglées par un administrateur (`PUT /settings/gemini/limits`). */
export const geminiLimitsSchema = z.object({
  rpm: z.number().int().min(1).max(100_000),
  tpm: z.number().int().min(1).max(100_000_000),
  rpd: z.number().int().min(1).max(1_000_000),
});
export type GeminiLimitsValue = z.infer<typeof geminiLimitsSchema>;

export const geminiLimitsInputSchema = geminiLimitsSchema.extend({ model: z.string().trim().min(1).max(120) });
export type GeminiLimitsInput = z.infer<typeof geminiLimitsInputSchema>;

/**
 * État de Gemini pour l'écran des modèles (`GET /settings/gemini`). Les
 * modèles sont dans l'ordre d'emploi : l'application prend le premier qui
 * n'est pas bloqué et bascule sur le suivant quand un quota l'arrête.
 */
export const geminiStatusSchema = z.object({
  /** Modèle qui servirait maintenant ; `null` en pause ou si tous sont bloqués. */
  current: z.string().nullable(),
  models: z.array(
    z.object({
      model: z.string(),
      limits: geminiLimitsSchema,
      minuteRequests: z.number().int(),
      minuteTokens: z.number().int(),
      /** Requêtes du jour du Pacifique, celui de Google. */
      dayRequests: z.number().int(),
      blockedUntil: z.string().nullable(),
      blockedMessage: z.string().nullable(),
    }),
  ),
  /** Pause commune après un 429 ou un 503 de Google. */
  pause: z.object({ until: z.string(), message: z.string() }).nullable(),
  /** Prochain minuit du Pacifique : remise à zéro des quotas du jour. */
  dayResetsAt: z.string(),
  /** Liste de Google indisponible : raison, à afficher telle quelle. */
  error: z.string().optional(),
});
export type GeminiStatus = z.infer<typeof geminiStatusSchema>;

/**
 * État de la sauvegarde vers le NAS (`GET /backup`, administrateurs), lu dans
 * la table que remplit le service `backup` (docker/backup/).
 */
export interface BackupStatus {
  /** Dernière sauvegarde réussie : fin et taille du dump de la base. */
  lastSuccess: { finishedAt: string; dumpBytes: number | null } | null;
  /** « Sauvegarder maintenant » attend d'être pris par le service (5 minutes au plus). */
  requested: boolean;
  /** Ce qui demande l'attention de l'administrateur, en phrases ; vide si tout va bien. */
  warnings: string[];
}
