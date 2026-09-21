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
});
export type RecognitionStats = z.infer<typeof recognitionStatsSchema>;
