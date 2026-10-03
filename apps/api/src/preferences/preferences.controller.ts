import { Controller, Get, Put } from '@nestjs/common';
import { recipeFiltersSchema, type RecipeFilters } from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody } from '../common/zod-validation.pipe.js';
import { PreferencesService, RECIPE_FILTERS_KEY } from './preferences.service.js';

/** Mémoire des filtres et du tri de la liste des recettes, par utilisateur (section 12). */
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get('recipe-filters')
  getRecipeFilters(@CurrentUser() user: RequestUser): Promise<unknown> {
    return this.preferences.get(user.id, RECIPE_FILTERS_KEY);
  }

  @Put('recipe-filters')
  setRecipeFilters(
    @ZodBody(recipeFiltersSchema) body: RecipeFilters,
    @CurrentUser() user: RequestUser,
  ): Promise<unknown> {
    return this.preferences.set(user.id, RECIPE_FILTERS_KEY, body as unknown as Prisma.InputJsonValue);
  }
}
