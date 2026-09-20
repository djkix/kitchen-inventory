import { z } from 'zod';
import { ERROR_CODES } from '../constants.js';
import { UNITS } from '../units.js';

export const unitSchema = z.enum(UNITS);
export const dateTypeSchema = z.enum(['USE_BY', 'BEST_BEFORE']);

/** Date civile « YYYY-MM-DD », sans heure : une DLC est un jour, pas un instant. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date attendue au format AAAA-MM-JJ' })
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), { message: 'Date invalide' });

export const idSchema = z.string().min(1).max(64);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** Identifiant d'opération généré par le client pour l'idempotence (section 8). */
export const clientOpIdSchema = z.string().min(8).max(128);

/** Quantité décimale à deux chiffres, strictement positive. */
export const positiveQuantitySchema = z
  .number()
  .positive({ message: 'La quantité doit être positive' })
  .max(1_000_000)
  .refine((q) => Math.abs(q * 100 - Math.round(q * 100)) < 1e-6, { message: 'Deux décimales au maximum' });
