import { z } from 'zod';
import type { CoverageGroup, IngredientState } from '../rules/coverage.js';
import type { MatchState } from '../rules/ingredient-match.js';
import { clientOpIdSchema, idSchema, positiveQuantitySchema, unitSchema } from './common.js';
import { difficultySchema } from './recipes.js';

/**
 * Régions de cuisine proposées comme orientation de recherche (section 12,
 * EF-25). Pas de région « autre » : une orientation vide équivaut à aucune
 * contrainte, voir `suggestionQuerySchema`.
 */
export const SUGGESTION_REGIONS = [
  'europeenne',
  'mediterraneenne',
  'asiatique',
  'latino-americaine',
  'moyen-orientale',
  'africaine',
  'nord-americaine',
] as const;
export type SuggestionRegion = (typeof SUGGESTION_REGIONS)[number];
export const suggestionRegionSchema = z.enum(SUGGESTION_REGIONS);

export const SUGGESTION_REGION_LABELS_FR: Record<SuggestionRegion, string> = {
  europeenne: 'Européenne',
  mediterraneenne: 'Méditerranéenne',
  asiatique: 'Asiatique',
  'latino-americaine': 'Latino-américaine',
  'moyen-orientale': 'Moyen-orientale',
  africaine: 'Africaine',
  'nord-americaine': 'Nord-américaine',
};

/** Paliers de durée totale proposés comme orientation (B9) : pas de valeur libre. */
export const SUGGESTION_DURATIONS = [15, 30, 60] as const;
export type SuggestionDuration = (typeof SUGGESTION_DURATIONS)[number];

export const suggestionQuerySchema = z.object({
  region: suggestionRegionSchema.optional(),
  maxMinutes: z.coerce
    .number()
    .refine((value) => SUGGESTION_DURATIONS.includes(value as SuggestionDuration), {
      message: 'Durée attendue parmi les paliers proposés : 15, 30 ou 60 minutes',
    })
    .optional(),
  difficulty: difficultySchema.optional(),
  /** Redemande un lot plutôt que de resservir le dernier (notice de B-cache). */
  refresh: z.coerce.boolean().default(false),
});
export type SuggestionQuery = z.infer<typeof suggestionQuerySchema>;

const modelRecipeIngredientSchema = z.object({
  label: z.string().trim().min(1, { message: "Libellé d'ingrédient requis" }).max(160),
  // Une quantité absente est légitime (« une pincée », « au goût ») : non manquante, juste non chiffrée.
  quantity: positiveQuantitySchema.nullable(),
  unit: unitSchema.nullable(),
});

const modelRecipeBaseSchema = z.object({
  title: z.string().trim().min(1, { message: 'Titre requis' }).max(160),
  origin: z.string().trim().min(1, { message: 'Origine requise' }).max(120),
  region: suggestionRegionSchema,
  totalMinutes: z.number().int().positive({ message: 'Durée totale requise' }).max(1440),
  difficulty: difficultySchema,
  provenance: z.enum(['web', 'ai']),
  sourceUrl: z.string().trim().url({ message: 'URL invalide' }).nullable(),
  steps: z.array(z.string().trim().min(1)).max(60),
  ingredients: z.array(modelRecipeIngredientSchema).min(1, { message: 'Au moins un ingrédient requis' }).max(60),
});

/**
 * Recette telle que rendue par le modèle, avant tout rapprochement avec le
 * stock. Porte les deux règles croisées de la vigilance 2 : une recette `web`
 * ne vaut que par son lien source, une composition `ai` n'a de légitimité que
 * par ses étapes et ne doit jamais prétendre venir d'ailleurs.
 */
export const modelRecipeSchema = modelRecipeBaseSchema.superRefine((recipe, ctx) => {
  if (recipe.provenance === 'web') {
    const isHttps = recipe.sourceUrl !== null && recipe.sourceUrl.startsWith('https://');
    if (!isHttps) {
      ctx.addIssue({
        code: 'custom',
        message: 'Une recette trouvée sur le web exige une URL source en https',
        path: ['sourceUrl'],
      });
    }
  } else {
    if (recipe.sourceUrl !== null) {
      ctx.addIssue({
        code: 'custom',
        message: "Une composition du modèle ne porte pas d'URL source",
        path: ['sourceUrl'],
      });
    }
    if (recipe.steps.length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Une composition du modèle exige au moins une étape',
        path: ['steps'],
      });
    }
  }
});
export type ModelRecipe = z.infer<typeof modelRecipeSchema>;

/**
 * Réponse brute attendue du fournisseur de suggestions (Gemini, retenu).
 * Pas de borne haute ici : la taille du lot est décidée par `SuggestionRequest.count`
 * au moment de l'appel (huit recettes web et quatre composées, dosage ajustable),
 * pas par une limite arbitraire sur la forme validée.
 */
export const modelBatchSchema = z.object({
  recipes: z.array(modelRecipeSchema),
});
export type ModelBatch = z.infer<typeof modelBatchSchema>;

/** Conserve une suggestion d'un lot déjà généré, pour en faire une recette du foyer. */
export const keepSuggestionSchema = z.object({
  batchId: idSchema,
  suggestionId: idSchema,
  clientOpId: clientOpIdSchema.optional(),
});
export type KeepSuggestionInput = z.infer<typeof keepSuggestionSchema>;

export interface SuggestionIngredientDto {
  label: string;
  quantity: number | null;
  unit: z.infer<typeof unitSchema> | null;
  match: MatchState;
  productId: string | null;
  productName: string | null;
  state: IngredientState;
}

export interface SuggestionDto {
  id: string;
  title: string;
  origin: string;
  region: SuggestionRegion;
  totalMinutes: number;
  difficulty: z.infer<typeof difficultySchema>;
  provenance: 'web' | 'ai';
  sourceUrl: string | null;
  ingredients: SuggestionIngredientDto[];
  coverage: number;
  group: CoverageGroup;
  missingLabels: string[];
}

export interface SuggestionBatchDto {
  batchId: string;
  generatedAt: string;
  fromCache: boolean;
  items: SuggestionDto[];
  /** Message affiché au-dessus du lot (ex. limite du fournisseur atteinte) ; `null` si rien à signaler. */
  notice: string | null;
}
