import { Injectable } from '@nestjs/common';
import { computeRecipeStats, type CookedLog, type RecipeStatsDto } from '@kitchen/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** Clé de réglage lue par `SettingsService.rawNumber`, section 22. */
const FORGOTTEN_AFTER_DAYS_KEY = 'recipeForgottenAfterDays';

/**
 * Statistiques de réalisation (EF-21) : ne dépend que de `RecipeLog` et de ses
 * notes, jamais du stock — ce qui lui permet d'exister dès la tâche 8, avant
 * que la tâche 9 n'apporte la couverture.
 */
@Injectable()
export class RecipesStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Charge les réalisations de plusieurs recettes en une seule requête. */
  async statsFor(recipeIds: readonly string[], today = new Date()): Promise<Map<string, RecipeStatsDto>> {
    const result = new Map<string, RecipeStatsDto>();
    if (recipeIds.length === 0) return result;

    const forgottenAfterDays = await this.settings.rawNumber(FORGOTTEN_AFTER_DAYS_KEY);
    const logs = await this.prisma.recipeLog.findMany({
      where: { recipeId: { in: [...recipeIds] } },
      include: { ratings: { select: { userId: true, stars: true } } },
    });

    const byRecipe = new Map<string, CookedLog[]>();
    for (const id of recipeIds) byRecipe.set(id, []);
    for (const log of logs) {
      byRecipe.get(log.recipeId)?.push({ id: log.id, cookedAt: log.cookedAt, ratings: log.ratings });
    }

    for (const [recipeId, cookedLogs] of byRecipe) {
      const stats = computeRecipeStats(cookedLogs, today, forgottenAfterDays);
      result.set(recipeId, {
        timesCooked: stats.timesCooked,
        lastCookedAt: stats.lastCookedAt ? stats.lastCookedAt.toISOString() : null,
        averageRating: stats.averageRating,
        ratingCount: stats.ratingCount,
        recentTrend: stats.recentTrend,
        tags: stats.tags,
      });
    }
    return result;
  }

  async statsForOne(recipeId: string, today = new Date()): Promise<RecipeStatsDto> {
    const stats = (await this.statsFor([recipeId], today)).get(recipeId);
    // `statsFor` initialise toujours la clé demandée, même sans réalisation.
    return stats!;
  }
}
