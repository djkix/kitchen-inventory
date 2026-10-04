import { Controller, Get } from '@nestjs/common';
import { suggestionQuerySchema, type SuggestionBatchDto, type SuggestionQuery } from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ZodQuery } from '../common/zod-validation.pipe.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Suggestions de recettes (EF-26, section 12) : orientation en paramètres de
 * requête, le reste est décidé par le service (stock réel, cache, quotas).
 * `POST /suggestions/keep` n'est pas ici : conservation d'une suggestion,
 * tâche 9.
 */
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  list(@ZodQuery(suggestionQuerySchema) query: SuggestionQuery, @CurrentUser() user: RequestUser): Promise<SuggestionBatchDto> {
    return this.suggestions.list(query, user);
  }
}
