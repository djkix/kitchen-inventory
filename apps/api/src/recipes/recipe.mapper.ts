import type { RecipeDto, RecipeIngredientDto, RecipeStatsDto, RecipeSummaryDto } from '@kitchen/shared';
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

/**
 * Couverture neutre : tant que la tâche 9 ne calcule pas la couverture réelle
 * à partir du stock, chaque recette est renvoyée comme « prête », sans
 * ingrédient manquant ni bonus anti-gaspillage. Ce bloc est le seul endroit
 * qui produit ces valeurs, pour la liste comme pour la fiche détaillée.
 */
function placeholderCoverage(): Pick<RecipeSummaryDto, 'coverage' | 'group' | 'bonus' | 'missingLabels'> {
  return { coverage: 1, group: 'ready', bonus: 0, missingLabels: [] };
}

export function toRecipeIngredientDto(ingredient: RecipeIngredientWithRelations): RecipeIngredientDto {
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
    // Neutre tant que la tâche 9 ne décore pas la fiche depuis l'instantané de stock.
    state: 'untracked',
    availableQuantity: null,
    nearExpiry: false,
    candidates: [],
  };
}

export function toRecipeSummaryDto(recipe: RecipeWithRelations, stats: RecipeStatsDto): RecipeSummaryDto {
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
    ...placeholderCoverage(),
    stats,
  };
}

export function toRecipeDto(recipe: RecipeWithRelations, stats: RecipeStatsDto): RecipeDto {
  return {
    ...toRecipeSummaryDto(recipe, stats),
    cuisineId: recipe.cuisineId,
    restMinutes: recipe.restMinutes,
    activeTime: recipe.activeTime,
    steps: parseSteps(recipe.steps),
    difficultyOverride: recipe.difficultyOverride,
    source: recipe.source,
    sourceUrl: recipe.sourceUrl,
    createdAt: recipe.createdAt.toISOString(),
    ingredients: recipe.ingredients.map(toRecipeIngredientDto),
  };
}
