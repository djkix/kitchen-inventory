import { z } from 'zod';
import type { IngredientState } from '../rules/coverage.js';
import { RECIPE_SORTS } from '../rules/recipe-sort.js';
import { clientOpIdSchema, idSchema, paginationQuerySchema, positiveQuantitySchema, unitSchema } from './common.js';

export const difficultySchema = z.enum(['VERY_EASY', 'EASY', 'INTERMEDIATE', 'HARD']);

/** Type de plat : une seule valeur par recette (A4). */
export const DISH_TYPES = ['STARTER', 'MAIN', 'DESSERT', 'SIDE', 'APERITIF', 'BREAKFAST', 'DRINK'] as const;
export const dishTypeSchema = z.enum(DISH_TYPES);

/** Régimes : plusieurs par recette, liste étendue par migration (A5). */
export const DIETS = ['VEGETARIAN', 'VEGAN', 'GLUTEN_FREE', 'LACTOSE_FREE', 'PORK_FREE'] as const;
export const dietSchema = z.enum(DIETS);

export const RECIPE_TAGS = ['trusted', 'disliked', 'never', 'forgotten'] as const;
export const recipeTagSchema = z.enum(RECIPE_TAGS);
export const recipeSortSchema = z.enum(RECIPE_SORTS);
export const coverageGroupSchema = z.enum(['ready', 'almost', 'excluded']);

export const DIFFICULTY_LABELS_FR: Record<z.infer<typeof difficultySchema>, string> = {
  VERY_EASY: 'Très facile', EASY: 'Facile', INTERMEDIATE: 'Intermédiaire', HARD: 'Difficile',
};
export const DISH_TYPE_LABELS_FR: Record<(typeof DISH_TYPES)[number], string> = {
  STARTER: 'Entrée', MAIN: 'Plat', DESSERT: 'Dessert', SIDE: 'Accompagnement',
  APERITIF: 'Apéritif', BREAKFAST: 'Petit-déjeuner', DRINK: 'Boisson',
};
export const DIET_LABELS_FR: Record<(typeof DIETS)[number], string> = {
  VEGETARIAN: 'Végétarien', VEGAN: 'Végétalien', GLUTEN_FREE: 'Sans gluten',
  LACTOSE_FREE: 'Sans lactose', PORK_FREE: 'Sans porc',
};
export const RECIPE_TAG_LABELS_FR: Record<(typeof RECIPE_TAGS)[number], string> = {
  trusted: 'Valeur sûre', disliked: 'À oublier', never: 'Jamais faite', forgotten: 'Pas faite depuis longtemps',
};
export const COVERAGE_GROUP_LABELS_FR: Record<z.infer<typeof coverageGroupSchema>, string> = {
  ready: 'Prête', almost: 'Presque', excluded: 'Incomplète',
};
/** État d'un ingrédient face au stock réel (section 15, A6, A10) : libellé court affiché par la fiche recette. */
export const INGREDIENT_STATE_LABELS_FR: Record<IngredientState, string> = {
  available: 'Disponible', insufficient: 'Insuffisant', unverifiable: 'Non vérifiable',
  missing: 'Manquant', untracked: 'Hors inventaire',
};
/** Tendance récente des notes d'une recette (EF-28), affichée par le bloc Historique. */
export const RECIPE_TREND_LABELS_FR: Record<NonNullable<RecipeStatsDto['recentTrend']>, string> = {
  up: 'En hausse', stable: 'Stable', down: 'En baisse',
};

export const recipeIngredientInputSchema = z
  .object({
    label: z.string().trim().min(1, { message: 'Libellé requis' }).max(160),
    productId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    quantity: positiveQuantitySchema.nullable().optional(),
    unit: unitSchema.nullable().optional(),
    // Décochées par défaut (A1, A2) : l'utilisateur déclare ce qui est vraiment indispensable.
    essential: z.boolean().default(false),
    substitutable: z.boolean().default(false),
  })
  .refine((i) => !(i.productId && i.categoryId), { message: 'Un ingrédient vise un produit ou une catégorie, pas les deux' })
  .refine((i) => (i.quantity ?? null) === null || (i.unit ?? null) !== null, { message: 'Une quantité exige une unité' })
  .refine((i) => (i.unit ?? null) === null || (i.quantity ?? null) !== null, { message: 'Une unité exige une quantité' });

export const createRecipeSchema = z.object({
  title: z.string().trim().min(1, { message: 'Titre requis' }).max(160),
  cuisineId: idSchema.nullable().optional(),
  dishType: dishTypeSchema.nullable().optional(),
  prepMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  cookMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  restMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  activeTime: z.number().int().min(0).max(1440).nullable().optional(),
  servings: z.number().int().min(1).max(50).default(4),
  steps: z.array(z.string().trim().min(1)).min(1, { message: 'Au moins une étape' }).max(60),
  diets: z.array(dietSchema).default([]),
  /** Renseignée seulement pour corriger le calcul ; pose alors difficultyOverride. */
  difficulty: difficultySchema.optional(),
  ingredients: z.array(recipeIngredientInputSchema).max(60).default([]),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial();
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

/** Un filtre peut arriver une fois (`?cuisine=a`) ou plusieurs (`?cuisine=a&cuisine=b`). */
const repeatable = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]), z.array(inner));

export const recipeListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  difficulty: repeatable(difficultySchema).optional(),
  cuisine: repeatable(idSchema).optional(),
  dishType: repeatable(dishTypeSchema).optional(),
  diet: repeatable(dietSchema).optional(),
  tag: repeatable(recipeTagSchema).optional(),
  group: repeatable(coverageGroupSchema).optional(),
  maxTime: z.coerce.number().int().min(1).max(1440).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  coverageMin: z.coerce.number().min(0).max(1).optional(),
  archived: z.coerce.boolean().default(false),
  sort: recipeSortSchema.default('rating'),
});
export type RecipeListQuery = z.infer<typeof recipeListQuerySchema>;

export const recipeFiltersSchema = recipeListQuerySchema.pick({
  difficulty: true, cuisine: true, dishType: true, diet: true, tag: true, group: true,
  maxTime: true, minRating: true, archived: true, sort: true,
});
export type RecipeFilters = z.infer<typeof recipeFiltersSchema>;

export const cookRecipeSchema = z.object({
  servingsCooked: z.number().int().min(1).max(50),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().trim().max(500).nullable().optional(),
  /** Seules les lignes présentes sont décrémentées : décocher, c'est omettre (A17). */
  lines: z
    .array(
      z.object({
        ingredientId: idSchema,
        /** Produit retenu pour un ingrédient substituable ou visant une catégorie (A15). */
        productId: idSchema.optional(),
      }),
    )
    .max(60),
  clientOpId: clientOpIdSchema.optional(),
});
export type CookRecipeInput = z.infer<typeof cookRecipeSchema>;

/** Réalisation sans décrément : « J'ai fait cette recette » (A26). */
export const logCookedSchema = z.object({
  servingsCooked: z.number().int().min(1).max(50),
  cookedAt: z.string().datetime().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().trim().max(500).nullable().optional(),
  clientOpId: clientOpIdSchema.optional(),
});
export type LogCookedInput = z.infer<typeof logCookedSchema>;

export const rateLogSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).nullable().default(null),
});
export type RateLogInput = z.infer<typeof rateLogSchema>;

export const createCuisineSchema = z.object({
  name: z.string().trim().min(1, { message: 'Nom requis' }).max(60),
  region: z.string().trim().max(60).nullable().optional(),
});
export type CreateCuisineInput = z.infer<typeof createCuisineSchema>;

export interface RecipeIngredientDto {
  id: string;
  label: string;
  productId: string | null;
  productName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  quantity: number | null;
  unit: z.infer<typeof unitSchema> | null;
  essential: boolean;
  substitutable: boolean;
  state: 'available' | 'insufficient' | 'unverifiable' | 'missing' | 'untracked';
  availableQuantity: number | null;
  /**
   * Produits en stock qui peuvent satisfaire cette ligne, pour le choix exigé
   * par A15 à la cuisson. Vide pour une ligne visant un produit précis non
   * substituable. Trié par date effective la plus proche d'abord, ce qui donne
   * la présélection du tiroir.
   */
  candidates: { productId: string; name: string; nearestExpiry: string | null }[];
}

export interface RecipeStatsDto {
  timesCooked: number;
  lastCookedAt: string | null;
  averageRating: number | null;
  ratingCount: number;
  recentTrend: 'up' | 'stable' | 'down' | null;
  tags: (typeof RECIPE_TAGS)[number][];
}

export interface RecipeSummaryDto {
  id: string;
  title: string;
  difficulty: z.infer<typeof difficultySchema>;
  cuisineName: string | null;
  dishType: (typeof DISH_TYPES)[number] | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  servings: number;
  diets: (typeof DIETS)[number][];
  imagePath: string | null;
  archivedAt: string | null;
  coverage: number;
  group: z.infer<typeof coverageGroupSchema>;
  missingLabels: string[];
  stats: RecipeStatsDto;
}

export interface RecipeRatingDto {
  userId: string;
  userName: string;
  stars: number;
  comment: string | null;
  updatedAt: string;
}

export interface RecipeLogDto {
  id: string;
  cookedAt: string;
  servingsCooked: number;
  stockApplied: boolean;
  cookedByName: string | null;
  canRate: boolean;
  ratings: RecipeRatingDto[];
}

export interface RecipeDto extends RecipeSummaryDto {
  cuisineId: string | null;
  restMinutes: number | null;
  activeTime: number | null;
  steps: string[];
  difficultyOverride: boolean;
  source: 'HOUSEHOLD' | 'IMPORTED' | 'GENERATED';
  sourceUrl: string | null;
  createdAt: string;
  ingredients: RecipeIngredientDto[];
}

export interface CookResultLine {
  ingredientId: string;
  label: string;
  requested: number | null;
  applied: number;
  unit: z.infer<typeof unitSchema> | null;
  capped: boolean;
}

export interface CookResult {
  logId: string;
  lines: CookResultLine[];
  message: string | null;
}
