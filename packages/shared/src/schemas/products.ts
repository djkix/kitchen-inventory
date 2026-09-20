import { z } from 'zod';
import { idSchema, paginationQuerySchema, unitSchema } from './common.js';

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{8}|\d{12,14})$/, { message: 'Code-barres EAN-8, UPC ou EAN-13 attendu' });

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
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.omit({ recognitionLogId: true }).partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

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
