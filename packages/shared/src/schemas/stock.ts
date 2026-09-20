import { z } from 'zod';
import { clientOpIdSchema, dateTypeSchema, idSchema, isoDateSchema, paginationQuerySchema, positiveQuantitySchema, unitSchema } from './common.js';
import { productSchema } from './products.js';

export const createStockItemSchema = z.object({
  productId: idSchema,
  locationId: idSchema,
  quantity: positiveQuantitySchema.default(1),
  unit: unitSchema.optional(),
  expiryDate: isoDateSchema.nullable().optional(),
  dateType: dateTypeSchema.nullable().optional(),
  /** Demande d'estimation depuis la catégorie quand aucune date n'est fournie (décision 6). */
  estimateExpiry: z.boolean().default(false),
  purchasePrice: z.number().min(0).nullable().optional(),
  clientOpId: clientOpIdSchema.optional(),
});
export type CreateStockItemInput = z.infer<typeof createStockItemSchema>;

export const consumeStockSchema = z.object({
  quantity: positiveQuantitySchema,
  reason: z.string().trim().max(160).optional(),
  clientOpId: clientOpIdSchema.optional(),
});
export type ConsumeStockInput = z.infer<typeof consumeStockSchema>;

export const adjustStockSchema = z.object({
  delta: z.number().refine((d) => d !== 0, { message: 'Le delta ne peut pas être nul' }),
  reason: z.string().trim().max(160).optional(),
  clientOpId: clientOpIdSchema.optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const moveStockSchema = z.object({ locationId: idSchema });
export type MoveStockInput = z.infer<typeof moveStockSchema>;

export const updateStockItemSchema = z.object({
  expiryDate: isoDateSchema.nullable().optional(),
  dateType: dateTypeSchema.nullable().optional(),
  dateEstimated: z.boolean().optional(),
  purchasePrice: z.number().min(0).nullable().optional(),
});
export type UpdateStockItemInput = z.infer<typeof updateStockItemSchema>;

export const stockStatusFilterSchema = z.enum(['active', 'archived', 'all']);

export const stockListQuerySchema = paginationQuerySchema.extend({
  location: idSchema.optional(),
  expiringBefore: isoDateSchema.optional(),
  q: z.string().trim().max(120).optional(),
  status: stockStatusFilterSchema.default('active'),
  product: idSchema.optional(),
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

export const expiringQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(3650).optional(),
});
export type ExpiringQuery = z.infer<typeof expiringQuerySchema>;

export const expiryStatusSchema = z.enum(['none', 'ok', 'soon', 'expired_use_by', 'expired_best_before']);
export const movementTypeSchema = z.enum(['INBOUND', 'CONSUMPTION', 'ADJUSTMENT', 'LOSS', 'RECIPE']);

export const stockMovementSchema = z.object({
  id: z.string(),
  type: movementTypeSchema,
  delta: z.number(),
  reason: z.string().nullable(),
  userId: z.string().nullable(),
  userName: z.string().nullable().optional(),
  occurredAt: z.string(),
});
export type StockMovementDto = z.infer<typeof stockMovementSchema>;

export const stockItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  product: productSchema,
  locationId: z.string(),
  location: z.object({ id: z.string(), name: z.string(), path: z.string() }),
  quantity: z.number(),
  unit: unitSchema,
  expiryDate: z.string().nullable(),
  dateType: dateTypeSchema.nullable(),
  dateEstimated: z.boolean(),
  opened: z.boolean(),
  openedAt: z.string().nullable(),
  effectiveExpiry: z.string().nullable(),
  expiryStatus: expiryStatusSchema,
  daysUntilExpiry: z.number().nullable(),
  purchasePrice: z.number().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  movements: z.array(stockMovementSchema).optional(),
});
export type StockItemDto = z.infer<typeof stockItemSchema>;

export const stockWriteResultSchema = z.object({
  item: stockItemSchema,
  movement: stockMovementSchema.nullable(),
  /** Vrai si la quantité demandée a été ramenée au stock disponible. */
  capped: z.boolean().optional(),
  /** Vrai si l'entrée a été fusionnée dans un lot existant à date identique. */
  merged: z.boolean().optional(),
  /** Vrai si le clientOpId avait déjà été traité. */
  replayed: z.boolean().optional(),
  message: z.string().optional(),
});
export type StockWriteResult = z.infer<typeof stockWriteResultSchema>;
