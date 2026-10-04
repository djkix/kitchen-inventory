import type { CoverageGroup, IngredientState, RecipeDto, RecipeIngredientDto, RecipeStatsDto, RecipeSummaryDto } from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import { toNumber } from '../common/decimal.js';

/** Inclusion Prisma commune à la lecture, la création et la modification d'une recette. */
export const RECIPE_INCLUDE = {
  cuisine: true,
  ingredients: { include: { product: true, category: true } },
} satisfies Prisma.RecipeInclude;

export type RecipeWithRelations = Prisma.RecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;
export type RecipeIngredientWithRelations = RecipeWithRelations['ingredients'][number];

/** `steps` est un Json : une donnée héritée ou corrompue ne doit pas casser la fiche. */
export function parseSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
}

/** Temps affiché et filtré : préparation et cuisson, jamais le repos (A13). */
export function totalMinutes(recipe: { prepMinutes: number | null; cookMinutes: number | null }): number | null {
  if (recipe.prepMinutes === null && recipe.cookMinutes === null) return null;
  return (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
}

/** Couverture agrégée de la recette, calculée par `recipeCoverage` (tâche 9). */
export interface SummaryCoverage {
  coverage: number;
  group: CoverageGroup;
  missingLabels: string[];
}

/** Couverture d'une ligne d'ingrédient, calculée par `ingredientOutcome` (tâche 9). */
export interface IngredientCoverage {
  state: IngredientState;
  availableQuantity: number | null;
  candidates: RecipeIngredientDto['candidates'];
}

const NEUTRAL_INGREDIENT_COVERAGE: IngredientCoverage = {
  state: 'untracked',
  availableQuantity: null,
  candidates: [],
};

export function toRecipeIngredientDto(
  ingredient: RecipeIngredientWithRelations,
  coverage: IngredientCoverage = NEUTRAL_INGREDIENT_COVERAGE,
): RecipeIngredientDto {
  return {
    id: ingredient.id,
    label: ingredient.label,
    productId: ingredient.productId,
    productName: ingredient.product?.name ?? null,
    categoryId: ingredient.categoryId,
    categoryName: ingredient.category?.name ?? null,
    quantity: toNumber(ingredient.quantity),
    unit: ingredient.unit,
    essential: ingredient.essential,
    substitutable: ingredient.substitutable,
    state: coverage.state,
    availableQuantity: coverage.availableQuantity,
    candidates: coverage.candidates,
  };
}

export function toRecipeSummaryDto(recipe: RecipeWithRelations, stats: RecipeStatsDto, coverage: SummaryCoverage): RecipeSummaryDto {
  return {
    id: recipe.id,
    title: recipe.title,
    difficulty: recipe.difficulty,
    cuisineName: recipe.cuisine?.name ?? null,
    dishType: recipe.dishType,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    totalMinutes: totalMinutes(recipe),
    servings: recipe.servings,
    diets: recipe.diets,
    imagePath: recipe.imagePath,
    archivedAt: recipe.archivedAt ? recipe.archivedAt.toISOString() : null,
    coverage: coverage.coverage,
    group: coverage.group,
    missingLabels: coverage.missingLabels,
    stats,
  };
}

export function toRecipeDto(
  recipe: RecipeWithRelations,
  stats: RecipeStatsDto,
  coverage: SummaryCoverage,
  ingredientCoverages: ReadonlyMap<string, IngredientCoverage>,
): RecipeDto {
  return {
    ...toRecipeSummaryDto(recipe, stats, coverage),
    cuisineId: recipe.cuisineId,
    restMinutes: recipe.restMinutes,
    activeTime: recipe.activeTime,
    steps: parseSteps(recipe.steps),
    difficultyOverride: recipe.difficultyOverride,
    source: recipe.source,
    sourceUrl: recipe.sourceUrl,
    createdAt: recipe.createdAt.toISOString(),
    ingredients: recipe.ingredients.map((ingredient) =>
      toRecipeIngredientDto(ingredient, ingredientCoverages.get(ingredient.id) ?? NEUTRAL_INGREDIENT_COVERAGE),
    ),
  };
}
