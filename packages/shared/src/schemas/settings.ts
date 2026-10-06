import { z } from 'zod';

/**
 * Un nom de modèle reste une chaîne libre côté schéma : la liste des modèles
 * servis par la clé est connue du serveur, pas du schéma partagé, et elle
 * change au rythme du fournisseur. La chaîne vide vaut « pas de choix » et
 * rend la main à la variable d'environnement puis au défaut du code.
 */
const modelName = z.string().trim().max(120);

export const settingsSchema = z.object({
  expiryAlertDays: z.number().int().min(0).max(365),
  /** Modèle de la reconnaissance photo ; absent quand ni la base ni l'environnement n'en fixent un. */
  visionModel: modelName.optional(),
  /** Modèle des appels recettes (suggestions et réécriture). */
  suggestionModel: modelName.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** Un modèle proposé au choix, tel que le fournisseur le déclare (`GET /settings/models`). */
export const availableModelSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type AvailableModel = z.infer<typeof availableModelSchema>;

export const availableModelsSchema = z.object({
  models: z.array(availableModelSchema),
  /** Raison pour laquelle la liste est vide, à afficher telle quelle ; absente quand tout va bien. */
  unavailable: z.string().optional(),
});
export type AvailableModels = z.infer<typeof availableModelsSchema>;
