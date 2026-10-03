import { Injectable } from '@nestjs/common';
import {
  canRate,
  RATING_WINDOW_DAYS,
  type LogCookedInput,
  type Paginated,
  type PaginationQuery,
  type RateLogInput,
  type RecipeLogDto,
} from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PendingRatingDto {
  logId: string;
  recipeId: string;
  recipeTitle: string;
  cookedAt: string;
}

const LOG_INCLUDE = {
  user: true,
  ratings: { include: { user: true } },
} satisfies Prisma.RecipeLogInclude;

type RecipeLogWithRelations = Prisma.RecipeLogGetPayload<{ include: typeof LOG_INCLUDE }>;

/**
 * Historique des réalisations (A26) et notation par membre (A24, A25). Ne
 * touche jamais au stock : la décrémentation reste du ressort de la tâche 10
 * (`POST /recipes/{id}/cook`), qui pose `stockApplied` à vrai.
 */
@Injectable()
export class RecipeLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(recipeId: string, query: PaginationQuery, today = new Date()): Promise<Paginated<RecipeLogDto>> {
    await this.requireRecipe(recipeId);
    const where = { recipeId };
    const [rows, total] = await Promise.all([
      this.prisma.recipeLog.findMany({
        where,
        include: LOG_INCLUDE,
        orderBy: { cookedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.recipeLog.count({ where }),
    ]);
    return { items: rows.map((log) => this.toDto(log, today)), total, page: query.page, limit: query.limit };
  }

  async logCooked(recipeId: string, input: LogCookedInput, user: RequestUser): Promise<RecipeLogDto> {
    await this.requireRecipe(recipeId);

    if (input.clientOpId) {
      const existing = await this.prisma.recipeLog.findUnique({ where: { clientOpId: input.clientOpId }, include: LOG_INCLUDE });
      if (existing) return this.toDto(existing, new Date());
    }

    try {
      const created = await this.prisma.recipeLog.create({
        data: {
          recipeId,
          userId: user.id,
          servingsCooked: input.servingsCooked,
          cookedAt: input.cookedAt ? new Date(input.cookedAt) : undefined,
          stockApplied: false,
          clientOpId: input.clientOpId ?? null,
          ratings:
            input.stars != null ? { create: { userId: user.id, stars: input.stars, comment: input.comment ?? null } } : undefined,
        },
        include: LOG_INCLUDE,
      });
      return this.toDto(created, new Date());
    } catch (error) {
      // Rejeu concurrent du même `clientOpId` : la vérification préalable laisse passer une course.
      if (input.clientOpId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.recipeLog.findUniqueOrThrow({ where: { clientOpId: input.clientOpId }, include: LOG_INCLUDE });
        return this.toDto(existing, new Date());
      }
      throw error;
    }
  }

  /**
   * Dernière réalisation, tous recettes confondues, que l'utilisateur courant
   * n'a pas encore notée et qui reste dans la fenêtre de notation (A25) — pour
   * le bandeau de rappel de la liste des recettes (EF-28). La fenêtre vient de
   * `canRate` (packages/shared) : jamais redérivée ici.
   */
  async pendingRating(user: RequestUser, today = new Date()): Promise<PendingRatingDto | null> {
    const cutoff = new Date(today.getTime() - RATING_WINDOW_DAYS * 86_400_000);
    const logs = await this.prisma.recipeLog.findMany({
      where: { cookedAt: { gte: cutoff } },
      include: { recipe: true, ratings: true },
      orderBy: { cookedAt: 'desc' },
    });
    for (const log of logs) {
      if (!canRate(log, today)) continue;
      if (log.ratings.some((rating) => rating.userId === user.id)) continue;
      return { logId: log.id, recipeId: log.recipeId, recipeTitle: log.recipe.title, cookedAt: log.cookedAt.toISOString() };
    }
    return null;
  }

  /** Note ou remplace sa propre note (A24) ; refuse hors fenêtre de sept jours (A25). */
  async rate(logId: string, input: RateLogInput, user: RequestUser): Promise<RecipeLogDto> {
    const log = await this.requireLog(logId);
    if (!canRate(log, new Date())) {
      throw ApiError.conflict('La notation est close après sept jours');
    }
    // `upsert` se traduit par un `INSERT ... ON CONFLICT DO UPDATE` atomique côté PostgreSQL :
    // pas de vérification préalable à protéger contre une course, contrairement à une création.
    await this.prisma.recipeRating.upsert({
      where: { recipeLogId_userId: { recipeLogId: logId, userId: user.id } },
      create: { recipeLogId: logId, userId: user.id, stars: input.stars, comment: input.comment },
      update: { stars: input.stars, comment: input.comment },
    });
    const updated = await this.requireLog(logId);
    return this.toDto(updated, new Date());
  }

  /** Refuse quand le stock a été décrémenté (A26) : seule la fiche article corrige un mouvement. */
  async remove(logId: string): Promise<void> {
    const log = await this.requireLog(logId);
    if (log.stockApplied) {
      throw ApiError.conflict('Cette réalisation a décrémenté le stock : passez par la correction manuelle depuis la fiche article');
    }
    await this.prisma.recipeLog.delete({ where: { id: logId } });
  }

  private toDto(log: RecipeLogWithRelations, today: Date): RecipeLogDto {
    return {
      id: log.id,
      cookedAt: log.cookedAt.toISOString(),
      servingsCooked: log.servingsCooked,
      stockApplied: log.stockApplied,
      cookedByName: log.user?.name ?? null,
      canRate: canRate(log, today),
      ratings: log.ratings.map((rating) => ({
        userId: rating.userId,
        userName: rating.user.name,
        stars: rating.stars,
        comment: rating.comment,
        updatedAt: rating.updatedAt.toISOString(),
      })),
    };
  }

  private async requireRecipe(id: string): Promise<void> {
    if (!(await this.prisma.recipe.findUnique({ where: { id } }))) throw ApiError.notFound('Recette introuvable');
  }

  private async requireLog(id: string): Promise<RecipeLogWithRelations> {
    const log = await this.prisma.recipeLog.findUnique({ where: { id }, include: LOG_INCLUDE });
    if (!log) throw ApiError.notFound('Réalisation introuvable');
    return log;
  }
}
