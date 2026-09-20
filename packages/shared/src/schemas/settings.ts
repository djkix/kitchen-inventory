import { z } from 'zod';

export const settingsSchema = z.object({
  expiryAlertDays: z.number().int().min(0).max(365),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
