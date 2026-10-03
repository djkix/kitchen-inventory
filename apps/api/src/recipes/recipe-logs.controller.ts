import { Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
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
import { type PendingRatingDto, RecipeLogsService } from './recipe-logs.service.js';

/** Réponse de `GET /recipe-logs/pending-rating` : enveloppée pour que « rien en attente » reste un corps JSON normal (`{ pending: null }`), sans sortir du pipeline de réponse standard de Nest. */
export interface PendingRatingResponse {
  pending: PendingRatingDto | null;
}

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
   * capturé par un paramètre. Réponse enveloppée dans `{ pending }` : un
   * retour `null` nu serait traduit par Nest en corps vide plutôt qu'en
   * littéral JSON `null`, ce qui empêcherait le client de distinguer « rien
   * en attente » d'une réponse tronquée — sans pour autant sortir ce point de
   * terminaison du pipeline de réponse standard (`@Res()`).
   */
  @Get('pending-rating')
  async pendingRating(@CurrentUser() user: RequestUser): Promise<PendingRatingResponse> {
    return { pending: await this.logs.pendingRating(user) };
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
