import { z } from 'zod';
import type { CoverageGroup, IngredientState } from '../rules/coverage.js';
import type { MatchState } from '../rules/ingredient-match.js';
import { clientOpIdSchema, idSchema, positiveQuantitySchema, unitSchema } from './common.js';
import { difficultySchema, dishTypeSchema } from './recipes.js';

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
  /**
   * Type de plat demandé au modèle. Le filtre de l'écran s'applique d'abord sur
   * la fournée déjà chargée, sans rien coûter ; cette orientation ne sert qu'au
   * bouton de relance proposé quand le filtre ne laisse aucune recette.
   */
  dishType: dishTypeSchema.optional(),
  /**
   * Redemande un lot plutôt que de resservir le dernier (notice de B-cache).
   * Jamais `z.coerce.boolean()` : il rend `true` pour la chaîne `"false"`, si
   * bien qu'un `refresh=false` posé par défaut dans l'orientation ferait payer
   * un appel à chaque chargement. Seule la chaîne `"true"` vaut vrai.
   */
  refresh: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === 'true' || value === true),
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
  /**
   * Préparation et cuisson séparées, `null` quand la recette n'en a pas (une
   * salade n'a pas de cuisson) ou quand le modèle ne les distingue pas. Jamais
   * `0` : zéro minute de cuisson et pas de cuisson ne se lisent pas pareil.
   * `totalMinutes` reste la durée de référence affichée sur les cartes.
   */
  prepMinutes: z.number().int().positive().max(1440).nullable(),
  cookMinutes: z.number().int().positive().max(1440).nullable(),
  difficulty: difficultySchema,
  /**
   * Entrée, plat, dessert… La taxonomie est celle de `Recipe.dishType` : une
   * suggestion conservée garde son classement sans conversion, et les deux
   * écrans filtrent sur le même vocabulaire.
   */
  dishType: dishTypeSchema,
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
    // Test insensible à la casse : `HTTPS://…` est une URL https valide, le
    // rejeter faisait tomber la recette (et, avant la validation recette par
    // recette ci-dessous, le lot entier avec elle).
    const isHttps = recipe.sourceUrl !== null && /^https:\/\//i.test(recipe.sourceUrl);
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
 *
 * Validation **recette par recette** : les entrées arrivent non typées et sont
 * validées une à une, les valides étant conservées et les autres écartées en
 * silence. Un tableau validé d'un bloc faisait échouer le lot entier — donc une
 * reprise, donc un second appel payant, puis `provider_unavailable` et un écran
 * en erreur — pour une seule recette sur seize mal formée.
 */
export const modelBatchSchema = z
  .object({ recipes: z.array(z.unknown()) })
  .transform((batch, ctx) => {
    const kept: ModelRecipe[] = [];
    for (const entry of batch.recipes) {
      const parsed = modelRecipeSchema.safeParse(entry);
      if (parsed.success) kept.push(parsed.data);
    }
    // Un lot vide est une réponse légitime (« je ne propose rien ») ; un lot
    // dont *aucune* entrée ne tient debout, non : c'est une réponse à reprendre.
    if (batch.recipes.length > 0 && kept.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Aucune recette exploitable dans le lot rendu par le modèle',
        path: ['recipes'],
      });
      return z.NEVER;
    }
    return { recipes: kept };
  });
export type ModelBatch = z.infer<typeof modelBatchSchema>;

/** Conserve une suggestion d'un lot déjà généré, pour en faire une recette du foyer. */
export const keepSuggestionSchema = z.object({
  batchId: idSchema,
  suggestionId: idSchema,
  clientOpId: clientOpIdSchema.optional(),
});
export type KeepSuggestionInput = z.infer<typeof keepSuggestionSchema>;

const recipeRewriteIngredientSchema = z.object({
  label: z.string().trim().min(1, { message: "Libellé d'ingrédient requis" }).max(160),
  quantity: positiveQuantitySchema.nullable(),
  unit: unitSchema.nullable(),
});

/**
 * Recette telle que rendue par Gemini lors de la réécriture au format de
 * l'application (tâche 9, B6) : pas d'origine ni d'URL ici, portées par la
 * suggestion d'origine, jamais par la réécriture elle-même.
 */
export const recipeRewriteSchema = z.object({
  title: z.string().trim().min(1, { message: 'Titre requis' }).max(160),
  steps: z.array(z.string().trim().min(1)).min(1, { message: 'Au moins une étape' }).max(60),
  ingredients: z.array(recipeRewriteIngredientSchema).min(1, { message: 'Au moins un ingrédient requis' }).max(60),
});
export type RecipeRewrite = z.infer<typeof recipeRewriteSchema>;

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
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: z.infer<typeof difficultySchema>;
  dishType: z.infer<typeof dishTypeSchema>;
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
