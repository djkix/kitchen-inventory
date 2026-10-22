import { z } from 'zod';
import { clientOpIdSchema, idSchema } from './common.js';
import { productSchema } from './products.js';

/**
 * Quantité d'une ligne de ticket (EF-29). Bornée parce que le modèle peut
 * halluciner : 1e9 passerait sinon jusqu'au stock. Le plancher 0,01 est la
 * précision de `ReceiptLine.quantity` (Decimal(10,2)) ; le plafond 99 dépasse
 * tout achat réel d'un même article sur un ticket de supermarché.
 */
export const RECEIPT_QUANTITY_MAX = 99;
export const receiptQuantitySchema = z.number().finite().min(0.01).max(RECEIPT_QUANTITY_MAX);

export const createReceiptSchema = z.object({ locationId: idSchema });
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const receiptLineSchema = z.object({
  id: idSchema,
  position: z.number().int().min(0),
  rawLabel: z.string(),
  quantity: receiptQuantitySchema,
  state: z.enum(['MATCHED', 'AMBIGUOUS', 'UNKNOWN']),
  product: productSchema.nullable(),
  candidates: z.array(productSchema),
  /** Total du produit dans l'emplacement choisi, tous lots confondus : le « 2 » du « 2 → 3 ». */
  currentQuantity: z.number(),
});
export type ReceiptLineDto = z.infer<typeof receiptLineSchema>;

export const receiptSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  lines: z.array(receiptLineSchema),
});
export type ReceiptDto = z.infer<typeof receiptSchema>;

/**
 * Validation d'un ticket (EF-29) : seules les lignes cochées sont envoyées.
 * Le `clientOpId` de chaque ligne rend la validation rejouable sans doubler.
 */
export const validateReceiptSchema = z
  .object({
    lines: z
      .array(z.object({ id: idSchema, productId: idSchema, quantity: receiptQuantitySchema, clientOpId: clientOpIdSchema }))
      .min(1)
      .max(200),
  })
  .refine((v) => new Set(v.lines.map((l) => l.id)).size === v.lines.length, { message: 'Ligne en double', path: ['lines'] })
  .refine((v) => new Set(v.lines.map((l) => l.clientOpId)).size === v.lines.length, { message: 'clientOpId en double', path: ['lines'] });
export type ValidateReceiptInput = z.infer<typeof validateReceiptSchema>;
