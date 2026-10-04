import { Controller, Get, Post } from '@nestjs/common';
import { keepSuggestionSchema, suggestionQuerySchema, type KeepSuggestionInput, type RecipeDto, type SuggestionBatchDto, type SuggestionQuery } from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Suggestions de recettes (EF-25, EF-26, section 12) : orientation en
 * paramètres de requête, le reste est décidé par le service (stock réel,
 * cache, quotas). `POST /suggestions/keep` conserve une suggestion d'une
 * fournée déjà rendue en recette du foyer (tâche 9) — jamais un lien renvoyé
 * vers le site d'origine, la recette reste dans l'application.
 */
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  list(@ZodQuery(suggestionQuerySchema) query: SuggestionQuery, @CurrentUser() user: RequestUser): Promise<SuggestionBatchDto> {
    return this.suggestions.list(query, user);
  }

  @Post('keep')
  keep(@ZodBody(keepSuggestionSchema) body: KeepSuggestionInput, @CurrentUser() user: RequestUser): Promise<RecipeDto> {
    return this.suggestions.keep(body, user);
  }
}
