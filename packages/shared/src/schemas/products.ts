import { z } from 'zod';
import { idSchema, paginationQuerySchema, unitSchema } from './common.js';

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{8}|\d{12,14})$/, { message: 'Code-barres EAN-8, UPC ou EAN-13 attendu' });

/**
 * Repères nutritionnels d'Open Food Facts, recopiés tels quels (EF-30) : le
 * Nutri-Score est calculé par eux, jamais ici. Une lettre absente vaut
 * « non renseigné », cas fréquent sur l'épicerie peu référencée.
 */
export const nutriscoreGradeSchema = z.enum(['a', 'b', 'c', 'd', 'e']);
export type NutriscoreGrade = z.infer<typeof nutriscoreGradeSchema>;

export const nutrientLevelSchema = z.enum(['low', 'moderate', 'high']);
export type NutrientLevel = z.infer<typeof nutrientLevelSchema>;

export const nutrientLevelsSchema = z.object({
  fat: nutrientLevelSchema.optional(),
  'saturated-fat': nutrientLevelSchema.optional(),
  sugars: nutrientLevelSchema.optional(),
  salt: nutrientLevelSchema.optional(),
});
export type NutrientLevels = z.infer<typeof nutrientLevelsSchema>;

/**
 * `unknown` et `not-applicable` sont des réponses normales d'Open Food Facts
 * quand la table nutritionnelle manque : elles valent « non renseigné »
 * plutôt qu'une note.
 */
export function parseNutriscoreGrade(raw: unknown): NutriscoreGrade | null {
  return nutriscoreGradeSchema.safeParse(typeof raw === 'string' ? raw.trim().toLowerCase() : raw).data ?? null;
}

/** Les niveaux inconnus sont écartés un à un ; un objet vide vaut null. */
export function parseNutrientLevels(raw: unknown): NutrientLevels | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (nutrientLevelsSchema.keyof().safeParse(key).success && nutrientLevelSchema.safeParse(value).success) kept[key] = value;
  }
  const parsed = nutrientLevelsSchema.safeParse(kept).data;
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

/** Champs nutritionnels demandés à Open Food Facts (scan et rattrapage). */
export const OFF_NUTRITION_FIELDS = ['nutriscore_grade', 'nutrient_levels'] as const;

export const createProductSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(160),
  barcode: barcodeSchema.nullable().optional(),
  originalName: z.string().trim().max(160).nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  defaultUnit: unitSchema.default('PIECE'),
  netContent: z.number().positive().nullable().optional(),
  netContentUnit: unitSchema.nullable().optional(),
  afterOpeningDays: z.number().int().min(0).max(3650).nullable().optional(),
  minThreshold: z.number().min(0).nullable().optional(),
  /** Identifiant d'un RecognitionLog à rattacher (EF-14). */
  recognitionLogId: idSchema.optional(),
  /** Chemin média déjà téléversé (photo de scan). */
  imagePath: z.string().max(300).nullable().optional(),
  nutriscoreGrade: nutriscoreGradeSchema.nullable().optional(),
  nutrientLevels: nutrientLevelsSchema.nullable().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.omit({ recognitionLogId: true }).partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Avancement du rattrapage des repères nutritionnels (EF-30), suivi par Réglages. */
export interface NutritionBackfillStatus {
  running: boolean;
  examined: number;
  updated: number;
  withoutData: number;
  failed: number;
  /** Vrai dès qu'Open Food Facts a refusé une requête pour cause de débit. */
  rateLimited: boolean;
  finishedAt: string | null;
}

export const nutritionBackfillSchema = z.object({ all: z.boolean().default(false) });
export type NutritionBackfillInput = z.infer<typeof nutritionBackfillSchema>;

export const productListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  category: idSchema.optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const mergeProductSchema = z.object({ targetId: idSchema });
export type MergeProductInput = z.infer<typeof mergeProductSchema>;

export const recognitionSourceSchema = z.enum(['BARCODE_CACHE', 'OPEN_FOOD_FACTS', 'VISION', 'MANUAL']);

export const productSchema = z.object({
  id: z.string(),
  barcode: z.string().nullable(),
  name: z.string(),
  originalName: z.string().nullable(),
  brand: z.string().nullable(),
  categoryId: z.string().nullable(),
  category: z.object({ id: z.string(), name: z.string(), icon: z.string().nullable() }).nullable().optional(),
  defaultUnit: unitSchema,
  netContent: z.number().nullable(),
  netContentUnit: unitSchema.nullable(),
  afterOpeningDays: z.number().nullable(),
  minThreshold: z.number().nullable(),
  imagePath: z.string().nullable(),
  nutriscoreGrade: nutriscoreGradeSchema.nullable(),
  nutrientLevels: nutrientLevelsSchema.nullable(),
  recognitionSource: recognitionSourceSchema,
  confidence: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductDto = z.infer<typeof productSchema>;

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  shelfLifeDays: z.number().nullable(),
  afterOpeningDays: z.number().nullable(),
});
export type CategoryDto = z.infer<typeof categorySchema>;
