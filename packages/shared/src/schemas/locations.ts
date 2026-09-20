import { z } from 'zod';
import { idSchema } from './common.js';

export const temperatureSchema = z.enum(['ambient', 'chilled', 'frozen']);

export const createLocationSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(80),
  parentId: idSchema.nullable().optional(),
  kind: z.string().trim().max(40).nullable().optional(),
  temperature: temperatureSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema.partial();
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export interface LocationNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  kind: string | null;
  temperature: string | null;
  sortOrder: number;
  itemCount: number;
  children: LocationNode[];
}
