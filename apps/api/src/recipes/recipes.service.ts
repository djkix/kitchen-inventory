import { Injectable } from '@nestjs/common';
import {
  computeDifficulty,
  excludedFromRecipes,
  expiryStatus,
  recipeCoverage,
  sortRecipes,
  type CoverageIngredient,
  type CreateRecipeInput,
  type Paginated,
  type RecipeDto,
  type RecipeIngredientDto,
  type RecipeListQuery,
  type RecipeSummaryDto,
  type SortableRecipe,
  type StockSnapshot,
  type UpdateRecipeInput,
} from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { formatCivilDate, toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  RECIPE_INCLUDE,
  parseSteps,
  toRecipeDto,
  toRecipeSummaryDto,
  type IngredientCoverage,
  type RecipeIngredientWithRelations,
  type RecipeWithRelations,
  type SummaryCoverage,
} from './recipe.mapper.js';
import { RecipesCoverageService } from './recipes.coverage.js';
import { RecipesStatsService } from './recipes.stats.js';

type IngredientInput = CreateRecipeInput['ingredients'][number];

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: RecipesStatsService,
    private readonly coverage: RecipesCoverageService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: RecipeListQuery): Promise<Paginated<RecipeSummaryDto>> {
    const where: Prisma.RecipeWhereInput = {
      archivedAt: query.archived ? { not: null } : null,
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.difficulty?.length ? { difficulty: { in: query.difficulty } } : {}),
      ...(query.cuisine?.length ? { cuisineId: { in: query.cuisine } } : {}),
      ...(query.dishType?.length ? { dishType: { in: query.dishType } } : {}),
      ...(query.diet?.length ? { diets: { hasSome: query.diet } } : {}),
    };
    const [rows, snapshot] = await Promise.all([
      this.prisma.recipe.findMany({ where, include: RECIPE_INCLUDE }),
      this.coverage.snapshot(),
    ]);
    const statsByRecipe = await this.stats.statsFor(rows.map((r) => r.id));
    let summaries = rows.map((r) => toRecipeSummaryDto(r, statsByRecipe.get(r.id)!, this.summaryCoverage(r, snapshot)));

    if (query.maxTime !== undefined) {
      const maxTime = query.maxTime;
      summaries = summaries.filter((s) => s.totalMinutes !== null && s.totalMinutes <= maxTime);
    }
    if (query.minRating !== undefined) {
      const minRating = query.minRating;
      summaries = summaries.filter((s) => s.stats.averageRating !== null && s.stats.averageRating >= minRating);
    }
    if (query.tag?.length) {
      const tags = query.tag;
      summaries = summaries.filter((s) => tags.some((tag) => s.stats.tags.includes(tag)));
    }
    if (query.group?.length) {
      const groups = query.group;
      summaries = summaries.filter((s) => groups.includes(s.group));
    }
    if (query.coverageMin !== undefined) {
      const coverageMin = query.coverageMin;
      summaries = summaries.filter((s) => s.coverage >= coverageMin);
    }

    const sortable: (RecipeSummaryDto & SortableRecipe)[] = summaries.map((s) => ({
      ...s,
      averageRating: s.stats.averageRating,
      ratingCount: s.stats.ratingCount,
      timesCooked: s.stats.timesCooked,
      lastCookedAt: s.stats.lastCookedAt ? new Date(s.stats.lastCookedAt) : null,
    }));
    const sorted = sortRecipes(sortable, query.sort);

    const total = sorted.length;
    const start = (query.page - 1) * query.limit;
    const items = sorted.slice(start, start + query.limit);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string): Promise<RecipeDto> {
    const recipe = await this.require(id);
    return this.toDto(recipe);
  }

  async create(input: CreateRecipeInput, userId: string | null): Promise<RecipeDto> {
    if (input.cuisineId) await this.requireCuisine(input.cuisineId);
    await this.requireIngredientRefs(input.ingredients);

    const difficultyOverride = input.difficulty !== undefined;
    const difficulty =
      input.difficulty ??
      computeDifficulty({ steps: input.steps, activeTime: input.activeTime ?? null, prepMinutes: input.prepMinutes ?? null });

    const created = await this.prisma.recipe.create({
      data: {
        title: input.title,
        difficulty,
        difficultyOverride,
        cuisineId: input.cuisineId ?? null,
        dishType: input.dishType ?? null,
        prepMinutes: input.prepMinutes ?? null,
        cookMinutes: input.cookMinutes ?? null,
        restMinutes: input.restMinutes ?? null,
        activeTime: input.activeTime ?? null,
        servings: input.servings,
        steps: input.steps,
        diets: input.diets,
        createdById: userId,
        ingredients: { create: input.ingredients.map(toIngredientCreateData) },
      },
      include: RECIPE_INCLUDE,
    });
    return this.toDto(created);
  }

  async update(id: string, input: UpdateRecipeInput): Promise<RecipeDto> {
    const current = await this.require(id);
    if (input.cuisineId) await this.requireCuisine(input.cuisineId);
    if (input.ingredients !== undefined) await this.requireIngredientRefs(input.ingredients);

    // Ne recalcule que si la difficulté n'a jamais été corrigée à la main.
    let difficulty = current.difficulty;
    let difficultyOverride = current.difficultyOverride;
    if (input.difficulty !== undefined) {
      difficulty = input.difficulty;
      difficultyOverride = true;
    } else if (!current.difficultyOverride) {
      const steps = input.steps ?? parseSteps(current.steps);
      const activeTime = input.activeTime !== undefined ? input.activeTime : current.activeTime;
      const prepMinutes = input.prepMinutes !== undefined ? input.prepMinutes : current.prepMinutes;
      difficulty = computeDifficulty({ steps, activeTime, prepMinutes });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Les ingrédients sont remplacés en bloc : pas d'orphelin, pas de fusion ligne à ligne.
      if (input.ingredients !== undefined) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      }
      return tx.recipe.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          difficulty,
          difficultyOverride,
          ...(input.cuisineId !== undefined ? { cuisineId: input.cuisineId } : {}),
          ...(input.dishType !== undefined ? { dishType: input.dishType } : {}),
          ...(input.prepMinutes !== undefined ? { prepMinutes: input.prepMinutes } : {}),
          ...(input.cookMinutes !== undefined ? { cookMinutes: input.cookMinutes } : {}),
          ...(input.restMinutes !== undefined ? { restMinutes: input.restMinutes } : {}),
          ...(input.activeTime !== undefined ? { activeTime: input.activeTime } : {}),
          ...(input.servings !== undefined ? { servings: input.servings } : {}),
          ...(input.steps !== undefined ? { steps: input.steps } : {}),
          ...(input.diets !== undefined ? { diets: input.diets } : {}),
          ...(input.ingredients !== undefined ? { ingredients: { create: input.ingredients.map(toIngredientCreateData) } } : {}),
        },
        include: RECIPE_INCLUDE,
      });
    });
    return this.toDto(updated);
  }

  /** Refuse au-delà d'une réalisation (A20) : l'historique prime sur le ménage. */
  async remove(id: string): Promise<void> {
    await this.require(id);
    const timesCooked = await this.prisma.recipeLog.count({ where: { recipeId: id } });
    if (timesCooked > 0) {
      throw ApiError.conflict('Cette recette a déjà été réalisée : archivez-la plutôt que de la supprimer', { timesCooked });
    }
    await this.prisma.recipe.delete({ where: { id } });
  }

  async archive(id: string): Promise<RecipeDto> {
    await this.require(id);
    const updated = await this.prisma.recipe.update({ where: { id }, data: { archivedAt: new Date() }, include: RECIPE_INCLUDE });
    return this.toDto(updated);
  }

  async restore(id: string): Promise<RecipeDto> {
    await this.require(id);
    const updated = await this.prisma.recipe.update({ where: { id }, data: { archivedAt: null }, include: RECIPE_INCLUDE });
    return this.toDto(updated);
  }

  private async toDto(recipe: RecipeWithRelations): Promise<RecipeDto> {
    const snapshot = await this.coverage.snapshot();
    const [stats, ingredientCoverages] = await Promise.all([
      this.stats.statsForOne(recipe.id),
      this.ingredientCoverages(recipe, snapshot),
    ]);
    return toRecipeDto(recipe, stats, this.summaryCoverage(recipe, snapshot), ingredientCoverages);
  }

  /** Ligne de couverture résolue (A15) : produit ou catégorie, jamais les deux, suivant la fusion (tâche 9). */
  private toCoverageIngredient(ingredient: RecipeIngredientWithRelations): CoverageIngredient {
    return {
      id: ingredient.id,
      productId: ingredient.productId ? (ingredient.product?.mergedIntoId ?? ingredient.productId) : null,
      categoryId: this.resolvedIngredientCategoryId(ingredient),
      quantity: toNumber(ingredient.quantity),
      unit: ingredient.unit,
      essential: ingredient.essential,
      substitutable: ingredient.substitutable,
    };
  }

  /**
   * Catégorie déjà résolue par l'appelant (voir `CoverageIngredient.categoryId`
   * dans `packages/shared`) : celle visée explicitement, ou — pour une ligne
   * substituable qui cible un produit — celle de ce produit.
   */
  private resolvedIngredientCategoryId(ingredient: RecipeIngredientWithRelations): string | null {
    if (ingredient.categoryId) return ingredient.categoryId;
    if (ingredient.substitutable && ingredient.product) return ingredient.product.categoryId;
    return null;
  }

  private summaryCoverage(recipe: RecipeWithRelations, snapshot: StockSnapshot): SummaryCoverage {
    const result = recipeCoverage(recipe.ingredients.map((i) => this.toCoverageIngredient(i)), snapshot);
    const labelById = new Map(recipe.ingredients.map((i) => [i.id, i.label]));
    const missingLabels = result.missingIds.map((id) => labelById.get(id)).filter((label): label is string => !!label);
    return { coverage: result.coverage, group: result.group, bonus: result.bonus, missingLabels };
  }

  /** Décoration complète d'une fiche recette (A15) : état, quantité disponible et candidats par ligne. */
  private async ingredientCoverages(
    recipe: RecipeWithRelations,
    snapshot: StockSnapshot,
  ): Promise<Map<string, IngredientCoverage>> {
    const result = recipeCoverage(recipe.ingredients.map((i) => this.toCoverageIngredient(i)), snapshot);
    const outcomeById = new Map(result.outcomes.map((o) => [o.id, o]));

    // Les candidats (choix à la cuisson, A15) ne valent que pour une ligne
    // substituable ou qui vise directement une catégorie.
    const categoryByIngredient = new Map<string, string | null>();
    for (const ingredient of recipe.ingredients) {
      const needsCandidates = ingredient.substitutable || (!ingredient.productId && !!ingredient.categoryId);
      categoryByIngredient.set(ingredient.id, needsCandidates ? this.resolvedIngredientCategoryId(ingredient) : null);
    }
    const categoryIds = [...new Set([...categoryByIngredient.values()].filter((c): c is string => c !== null))];
    const candidatesByCategory = await this.candidatesByCategory(categoryIds, snapshot);

    const map = new Map<string, IngredientCoverage>();
    for (const ingredient of recipe.ingredients) {
      const outcome = outcomeById.get(ingredient.id);
      const categoryId = categoryByIngredient.get(ingredient.id) ?? null;
      map.set(ingredient.id, {
        state: outcome?.state ?? 'untracked',
        availableQuantity: outcome?.availableQuantity ?? null,
        nearExpiry: outcome?.nearExpiry ?? false,
        candidates: categoryId ? (candidatesByCategory.get(categoryId) ?? []) : [],
      });
    }
    return map;
  }

  /** Produits candidats d'une catégorie (et ses sous-catégories, A3), triés par date effective la plus proche. */
  private async candidatesByCategory(
    categoryIds: readonly string[],
    snapshot: StockSnapshot,
  ): Promise<Map<string, RecipeIngredientDto['candidates']>> {
    const result = new Map<string, RecipeIngredientDto['candidates']>();
    if (categoryIds.length === 0) return result;

    const productIds = new Set<string>();
    for (const categoryId of categoryIds) {
      for (const entry of snapshot.byCategory.get(categoryId) ?? []) productIds.add(entry.productId);
    }
    if (productIds.size === 0) {
      for (const categoryId of categoryIds) result.set(categoryId, []);
      return result;
    }

    const [alertDays, products] = await Promise.all([
      this.settings.expiryAlertDays(),
      this.prisma.product.findMany({
        where: { id: { in: [...productIds] } },
        select: {
          id: true,
          name: true,
          stockItems: { where: { archivedAt: null, quantity: { gt: 0 } }, select: { effectiveExpiry: true, dateType: true, dateEstimated: true } },
        },
      }),
    ]);
    const today = new Date();
    const nearestByProduct = new Map<string, Date | null>();
    const nameByProduct = new Map<string, string>();
    for (const product of products) {
      nameByProduct.set(product.id, product.name);
      const dates = product.stockItems
        .filter(
          (lot) => !excludedFromRecipes(expiryStatus({ effectiveExpiry: lot.effectiveExpiry, dateType: lot.dateType, dateEstimated: lot.dateEstimated }, today, alertDays)),
        )
        .map((lot) => lot.effectiveExpiry)
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      nearestByProduct.set(product.id, dates[0] ?? null);
    }

    for (const categoryId of categoryIds) {
      const entries = snapshot.byCategory.get(categoryId) ?? [];
      const candidates = entries
        .map((entry) => ({
          productId: entry.productId,
          name: nameByProduct.get(entry.productId) ?? '',
          nearestExpiry: formatCivilDate(nearestByProduct.get(entry.productId) ?? null),
        }))
        .sort((a, b) => {
          if (a.nearestExpiry === b.nearestExpiry) return 0;
          if (a.nearestExpiry === null) return 1;
          if (b.nearestExpiry === null) return -1;
          return a.nearestExpiry.localeCompare(b.nearestExpiry);
        });
      result.set(categoryId, candidates);
    }
    return result;
  }

  private async require(id: string): Promise<RecipeWithRelations> {
    const recipe = await this.prisma.recipe.findUnique({ where: { id }, include: RECIPE_INCLUDE });
    if (!recipe) throw ApiError.notFound('Recette introuvable');
    return recipe;
  }

  private async requireCuisine(id: string): Promise<void> {
    if (!(await this.prisma.cuisine.findUnique({ where: { id } }))) throw ApiError.notFound('Cuisine introuvable');
  }

  private async requireIngredientRefs(ingredients: readonly IngredientInput[]): Promise<void> {
    const productIds = [...new Set(ingredients.map((i) => i.productId).filter((v): v is string => !!v))];
    const categoryIds = [...new Set(ingredients.map((i) => i.categoryId).filter((v): v is string => !!v))];
    if (productIds.length > 0) {
      const found = await this.prisma.product.count({ where: { id: { in: productIds } } });
      if (found !== productIds.length) throw ApiError.notFound('Produit introuvable');
    }
    if (categoryIds.length > 0) {
      const found = await this.prisma.category.count({ where: { id: { in: categoryIds } } });
      if (found !== categoryIds.length) throw ApiError.notFound('Catégorie introuvable');
    }
  }
}

function toIngredientCreateData(i: IngredientInput): Prisma.RecipeIngredientCreateWithoutRecipeInput {
  return {
    label: i.label,
    product: i.productId ? { connect: { id: i.productId } } : undefined,
    category: i.categoryId ? { connect: { id: i.categoryId } } : undefined,
    quantity: i.quantity ?? null,
    unit: i.unit ?? null,
    essential: i.essential,
    substitutable: i.substitutable,
  };
}
