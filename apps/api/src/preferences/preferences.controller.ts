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

  /** Partiels : un membre n'a pas forcément déjà enregistré tous les champs (ex. `{}` au premier accès). */
  @Get('recipe-filters')
  async getRecipeFilters(@CurrentUser() user: RequestUser): Promise<Partial<RecipeFilters>> {
    return (await this.preferences.get(user.id, RECIPE_FILTERS_KEY)) as Partial<RecipeFilters>;
  }

  @Put('recipe-filters')
  async setRecipeFilters(
    @ZodBody(recipeFiltersSchema) body: RecipeFilters,
    @CurrentUser() user: RequestUser,
  ): Promise<Partial<RecipeFilters>> {
    return (await this.preferences.set(user.id, RECIPE_FILTERS_KEY, body as unknown as Prisma.InputJsonValue)) as Partial<RecipeFilters>;
  }
}
