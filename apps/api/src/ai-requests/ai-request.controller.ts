import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { aiRequestIdSchema, type AiRequestStatusDto } from '@kitchen/shared';
import { CurrentUser, type RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { AiRequestService } from './ai-request.service.js';

/**
 * Retrouver sa demande (conception du 2026-11-02). Deux gestes seulement :
 * dire qu'on a posé le téléphone, et réclamer le résultat au retour.
 */
@Controller('ai-requests')
export class AiRequestController {
  constructor(private readonly requests: AiRequestService) {}

  @Get(':id')
  status(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<AiRequestStatusDto> {
    return this.requests.status(parseId(id), user.id);
  }

  /** Appelé par `navigator.sendBeacon` : la page est en train d'être gelée. */
  @Post(':id/background')
  @HttpCode(204)
  background(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    return this.requests.markLeftScreen(parseId(id), user.id);
  }
}

/** Un identifiant mal formé est introuvable, pas invalide : même réponse qu'un inconnu. */
function parseId(id: string): string {
  const parsed = aiRequestIdSchema.safeParse(id);
  if (!parsed.success) throw ApiError.notFound('Demande introuvable');
  return parsed.data;
}
