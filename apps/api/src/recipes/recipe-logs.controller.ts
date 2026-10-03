import { Controller, Delete, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  logCookedSchema,
  paginationQuerySchema,
  rateLogSchema,
  type LogCookedInput,
  type Paginated,
  type PaginationQuery,
  type RateLogInput,
  type RecipeLogDto,
} from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe.js';
import { RecipeLogsService } from './recipe-logs.service.js';

/** Historique des réalisations d'une recette (A26), imbriqué sous `/recipes`. */
@Controller('recipes/:recipeId/logs')
export class RecipeLogsController {
  constructor(private readonly logs: RecipeLogsService) {}

  @Get()
  list(
    @Param('recipeId') recipeId: string,
    @ZodQuery(paginationQuerySchema) query: PaginationQuery,
  ): Promise<Paginated<RecipeLogDto>> {
    return this.logs.list(recipeId, query);
  }

  @Post()
  create(
    @Param('recipeId') recipeId: string,
    @ZodBody(logCookedSchema) body: LogCookedInput,
    @CurrentUser() user: RequestUser,
  ): Promise<RecipeLogDto> {
    return this.logs.logCooked(recipeId, body, user);
  }
}

/** Notation et suppression d'une réalisation (A24, A25, A26) : identifiée par elle-même, hors de toute recette. */
@Controller('recipe-logs')
export class RecipeLogRatingsController {
  constructor(private readonly logs: RecipeLogsService) {}

  /**
   * Rappel de notation (EF-28) : à déclarer avant `:id/*` pour ne pas être
   * capturé par un paramètre. `@Res()` est nécessaire ici : Nest renvoie un
   * corps vide (pas le littéral JSON `null`) pour une valeur de retour nulle,
   * ce qui empêcherait le client de distinguer « rien en attente » d'une
   * réponse tronquée.
   */
  @Get('pending-rating')
  async pendingRating(@CurrentUser() user: RequestUser, @Res() res: Response): Promise<void> {
    const pending = await this.logs.pendingRating(user);
    res.json(pending);
  }

  @Put(':id/rating')
  rate(
    @Param('id') id: string,
    @ZodBody(rateLogSchema) body: RateLogInput,
    @CurrentUser() user: RequestUser,
  ): Promise<RecipeLogDto> {
    return this.logs.rate(id, body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.logs.remove(id);
  }
}
