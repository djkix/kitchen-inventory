import { z } from 'zod';
import { idSchema, isoDateSchema } from './common.js';
import { barcodeSchema, productSchema } from './products.js';

export const scanBarcodeSchema = z.object({ barcode: barcodeSchema });
export type ScanBarcodeInput = z.infer<typeof scanBarcodeSchema>;

export const scanBarcodeResultSchema = z.object({
  product: productSchema,
  source: z.enum(['cache', 'off']),
});
export type ScanBarcodeResult = z.infer<typeof scanBarcodeResultSchema>;

export const scanImageHintSchema = z.object({
  hint: z.string().trim().max(200).optional(),
  barcode: barcodeSchema.optional(),
});
export type ScanImageHint = z.infer<typeof scanImageHintSchema>;

/** JSON strict attendu du fournisseur de vision (section 5, niveau 4). */
export const visionSuggestionSchema = z.object({
  name: z.string().trim().min(1).max(160),
  originalName: z.string().trim().max(160).nullable().default(null),
  brand: z.string().trim().max(120).nullable().default(null),
  category: z.string().trim().max(80).nullable().default(null),
  packaging: z.string().trim().max(80).nullable().default(null),
  expiryDate: isoDateSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
});
export type VisionSuggestion = z.infer<typeof visionSuggestionSchema>;

export const scanImageResultSchema = z.object({
  suggestion: visionSuggestionSchema,
  confidence: z.number(),
  rawId: z.string(),
  imagePath: z.string(),
  /** Catégorie rapprochée par nom parmi celles de l'instance, si trouvée. */
  categoryId: z.string().nullable(),
  needsReview: z.boolean(),
  /** Confiance trop basse : reprendre la photo plutôt que valider (section 17). */
  rejected: z.boolean(),
  /**
   * Modèle réellement utilisé quand le quota du modèle choisi était épuisé et
   * qu'on a basculé sur le repli. Absent dans le cas normal : l'écran ne dit
   * rien quand il n'y a rien à signaler.
   */
  fallbackModelUsed: z.string().optional(),
});
export type ScanImageResult = z.infer<typeof scanImageResultSchema>;

export const scanCorrectionSchema = z.object({
  rawId: idSchema,
  productId: idSchema,
});
export type ScanCorrectionInput = z.infer<typeof scanCorrectionSchema>;

export const recognitionStatsSchema = z.object({
  visionCallsToday: z.number(),
  visionCallsThisMonth: z.number(),
  visionCostCentsThisMonth: z.number(),
  dailyQuota: z.number(),
  /** Plafond de dépense mensuel en centimes ; 0 signifie « pas de plafond ». */
  monthlyCapCents: z.number(),
  automaticRate30d: z.number().nullable(),
  cacheShare30d: z.number().nullable(),
  pendingIdentification: z.number(),
  provider: z.string(),
  /**
   * Appels réellement partis chez le fournisseur aujourd'hui et dans la
   * dernière minute, scan **et** recettes confondus — c'est ainsi que Google
   * les compte. Indicatifs : ils ne voient que ce que cette application a
   * envoyé, pas ce qu'un autre outil consommerait sur la même clé.
   */
  providerCallsToday: z.number(),
  providerCallsLastMinute: z.number(),
  /**
   * Appels partis pour les **recettes** (suggestions, demande parlée,
   * réécriture) aujourd'hui et sur le mois, avec leur dépense. Les compteurs
   * « photos » les excluent délibérément — une fournée de recettes faisait
   * chuter le taux d'automatisation du scan — mais ils n'étaient alors visibles
   * nulle part : on ne lisait leur consommation que fondue dans le coût du mois.
   */
  recipeCallsToday: z.number(),
  recipeCallsThisMonth: z.number(),
  recipeCostCentsThisMonth: z.number(),
  /** Fournées de recettes autorisées par jour (`RECIPE_SUGGESTION_DAILY_QUOTA`). */
  recipeDailyQuota: z.number(),
  /**
   * Limites annoncées par la console Google pour ce projet, recopiées dans
   * `GEMINI_RPD` et `GEMINI_RPM` — aucune API ne permet de les lire. `null`
   * quand elles ne sont pas renseignées : on affiche alors le compte seul,
   * plutôt qu'un rapport à une valeur inventée.
   */
  providerDailyLimit: z.number().nullable(),
  providerMinuteLimit: z.number().nullable(),
});
export type RecognitionStats = z.infer<typeof recognitionStatsSchema>;
