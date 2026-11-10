import { Body, Controller, Get, HttpCode, OnModuleInit, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  keepSuggestionSchema,
  suggestionQuerySchema,
  VOICE_MAX_BYTES,
  type CatalogueStatus,
  type KeepSuggestionInput,
  type RecipeDto,
  type SuggestionBatchDto,
  type SuggestionQuery,
  type VoiceSuggestionBatchDto,
} from '@kitchen/shared';
import { aiRequestField } from '../ai-requests/ai-request-field.js';
import { DeferralService } from '../ai-requests/deferral.service.js';
import { ApiError } from '../common/api-error.js';
import { AdminOnly, CurrentUser, type RequestUser } from '../auth/request-user.js';
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
export class SuggestionsController implements OnModuleInit {
  constructor(
    private readonly suggestions: SuggestionsService,
    private readonly deferral: DeferralService,
  ) {}

  onModuleInit(): void {
    this.deferral.register('SUGGESTIONS', async ({ json }) => {
      const batch = await this.suggestions.list(json as SuggestionQuery);
      return { result: batch, count: batch.items.length };
    });
    this.deferral.register('VOICE', async ({ file, mimeType }) => {
      const batch = await this.suggestions.listFromVoice(file!, mimeType!);
      return { result: batch, count: batch.items.length };
    });
  }

  /**
   * Lecture seule (revue de sécurité du 2026-10-22) : le réservoir tel qu'il
   * est, couverture recalculée contre le stock, **sans jamais appeler le
   * modèle ni écrire** — `refresh` y est ignoré. C'est la seule forme
   * accessible à un jeton de service.
   */
  @Get()
  list(@ZodQuery(suggestionQuerySchema) query: SuggestionQuery): Promise<SuggestionBatchDto> {
    return this.suggestions.list(query, { allowModelCall: false });
  }

  /**
   * Recherche (écran Suggestions) : même orientation, dans le corps. Peut
   * appeler le modèle — sous le plancher du réservoir ou sur relance
   * explicite —, consommer le quota et écrire au réservoir. En `POST` pour
   * que ni un lien, ni un préchargement, ni un jeton de service (lecture
   * seule, refusé par `SessionGuard`) ne la déclenchent, et pour passer par
   * la garde des écritures inter-origines.
   *
   * C'est ici, et pas sur le `GET`, que la demande est suivie et gardée si
   * Gemini est saturé (2026-11-02) : la lecture seule n'appelle jamais le
   * modèle, elle n'a donc rien à différer ni à annoncer.
   */
  @Post()
  @HttpCode(200)
  search(@ZodBody(suggestionQuerySchema) body: SuggestionQuery, @CurrentUser() user: RequestUser): Promise<SuggestionBatchDto> {
    return this.deferral.track(
      { id: body.requestId, userId: user.id, kind: 'SUGGESTIONS', payload: () => ({ json: body }) },
      () => this.suggestions.list(body),
      (batch) => batch.items.length,
    );
  }

  /**
   * Demande parlée (spécification du 2026-10-21) : l'enregistrement monte en
   * multipart, le modèle le transcrit et propose dans le même appel (D2).
   *
   * Route payante et soumise au quota, comme `scan/image`, et limitée par
   * adresse — **cinq par minute, pas vingt** (tour de correction 1). Vingt
   * ne mordait jamais : `RECIPE_SUGGESTION_DAILY_QUOTA` vaut vingt par jour,
   * le quota fermait donc toujours la porte le premier. Le garde-fou n'est
   * pas inutile pour autant : un refus pour borne ou pour format
   * n'incrémente aucun quota, si bien qu'un flot de corps de quatre
   * mébioctets serait accepté, mis en mémoire et analysé par `multer` sans
   * qu'aucun compteur ne bouge. C'est ce chemin-là que cinq par minute
   * protègent — pas la dépense, que le quota journalier et le plafond
   * mensuel tiennent déjà.
   *
   * La borne de `multer` est posée **au-dessus** de `VOICE_MAX_BYTES` : c'est
   * le service qui refuse, avec la règle partagée et une phrase en français
   * (D8, D9), plutôt qu'une coupure de transport sans message. Multer ne
   * reste qu'un dernier rempart contre un corps démesuré.
   *
   * L'audio n'est jamais écrit : il n'est pas confié à `MediaService`
   * (contrairement à la photo du scan), il traverse le service et disparaît
   * (D6).
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('voice')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: VOICE_MAX_BYTES + 1024, files: 1 } }))
  voice(@UploadedFile() file: Express.Multer.File | undefined, @Body() rawBody: unknown, @CurrentUser() user: RequestUser): Promise<VoiceSuggestionBatchDto> {
    if (!file) throw new ApiError(400, 'validation_failed', 'Enregistrement manquant (champ « audio »)');
    return this.deferral.track(
      {
        id: aiRequestField(rawBody),
        userId: user.id,
        kind: 'VOICE',
        payload: () => ({ file: { buffer: file.buffer, mimeType: file.mimetype } }),
      },
      () => this.suggestions.listFromVoice(file.buffer, file.mimetype),
      (batch) => batch.items.length,
    );
  }

  /**
   * Rattrapage des recettes du réservoir (D6), derrière le bouton de
   * Réglages › Recettes. Le passage dure, donc le serveur rend la main tout de
   * suite (202) et l'écran suit par `GET`.
   */
  @Get('catalogue')
  catalogueStatus(): CatalogueStatus {
    return this.suggestions.readCatalogueStatus();
  }

  @Post('catalogue')
  @HttpCode(202)
  @AdminOnly()
  startCatalogue(): CatalogueStatus {
    return this.suggestions.startCatalogueAll();
  }

  @Post('keep')
  keep(@ZodBody(keepSuggestionSchema) body: KeepSuggestionInput, @CurrentUser() user: RequestUser): Promise<RecipeDto> {
    return this.suggestions.keep(body, user);
  }
}

