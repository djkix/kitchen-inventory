import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  cookRecipeSchema,
  createRecipeSchema,
  recipeListQuerySchema,
  updateRecipeSchema,
  type CookRecipeInput,
  type CookResult,
  type CreateRecipeInput,
  type Paginated,
  type RecipeDto,
  type RecipeListQuery,
  type RecipeSummaryDto,
  type UpdateRecipeInput,
} from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe.js';
import { RecipesCookService } from './recipes.cook.js';
import { RecipesService } from './recipes.service.js';

/** Recettes du foyer (section 12) : tout membre a les mêmes droits, y compris l'archivage. */
@Controller('recipes')
export class RecipesController {
  constructor(
    private readonly recipes: RecipesService,
    private readonly cooking: RecipesCookService,
  ) {}

  @Get()
  list(@ZodQuery(recipeListQuerySchema) query: RecipeListQuery): Promise<Paginated<RecipeSummaryDto>> {
    return this.recipes.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<RecipeDto> {
    return this.recipes.get(id);
  }

  @Post()
  create(@ZodBody(createRecipeSchema) body: CreateRecipeInput, @CurrentUser() user?: RequestUser): Promise<RecipeDto> {
    return this.recipes.create(body, user?.id ?? null);
  }

  @Patch(':id')
  update(@Param('id') id: string, @ZodBody(updateRecipeSchema) body: UpdateRecipeInput): Promise<RecipeDto> {
    return this.recipes.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.recipes.remove(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string): Promise<RecipeDto> {
    return this.recipes.archive(id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string): Promise<RecipeDto> {
    return this.recipes.restore(id);
  }

  /** Cuisson (EF-18) : décrémente le stock au prorata des portions, en une transaction. */
  @Post(':id/cook')
  @HttpCode(200)
  cook(
    @Param('id') id: string,
    @ZodBody(cookRecipeSchema) body: CookRecipeInput,
    @CurrentUser() user: RequestUser,
  ): Promise<CookResult> {
    return this.cooking.cook(id, body, user);
  }
}
