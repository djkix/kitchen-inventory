import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { NutritionBackfillStatus } from '@kitchen/shared';
import { ApiError } from '../common/api-error.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { rattraper } from './nutrition-backfill.js';

/**
 * Le rattrapage derrière un bouton (Réglages › Inventaire), pour que djkix
 * n'ait pas à ouvrir un terminal (EF-30, 2026-10-23).
 *
 * L'état vit en mémoire, pas en base : un rattrapage interrompu par un
 * redémarrage n'a rien à reprendre, puisqu'une relance ne considère de toute
 * façon que les produits encore sans repère. Un seul passage à la fois — Open
 * Food Facts coupe le débit bien assez vite sans qu'on s'y mette à deux.
 */
@Injectable()
export class NutritionBackfillService {
  private status: NutritionBackfillStatus = { running: false, examined: 0, updated: 0, withoutData: 0, failed: 0, rateLimited: false, finishedAt: null };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HTTP_CLIENT) private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  read(): NutritionBackfillStatus {
    return this.status;
  }

  /**
   * Rend la main tout de suite : la boucle tourne en fond, l'écran suit par
   * `GET`. Plusieurs minutes d'attente ne tiendraient dans aucune requête.
   */
  start(all: boolean): NutritionBackfillStatus {
    if (this.status.running) throw ApiError.conflict('Un rattrapage est déjà en cours');
    this.status = { running: true, examined: 0, updated: 0, withoutData: 0, failed: 0, rateLimited: false, finishedAt: null };
    void this.run(all);
    return this.status;
  }

  private async run(all: boolean): Promise<void> {
    let rateLimited = false;
    try {
      const tally = await rattraper(
        this.prisma,
        {
          all,
          fetch: this.http,
          onProgress: (progress) => {
            this.status = { ...this.status, ...progress };
          },
          onRateLimited: () => {
            rateLimited = true;
          },
        },
        (line) => this.logger.log({ backfill: true }, line),
      );
      this.status = { ...tally, running: false, rateLimited, finishedAt: new Date().toISOString() };
    } catch (error) {
      this.logger.error({ err: error }, 'Rattrapage des repères nutritionnels interrompu');
      this.status = { ...this.status, running: false, finishedAt: new Date().toISOString() };
    }
  }
}
