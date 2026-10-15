import { Inject, Injectable } from '@nestjs/common';
import { modelRecipeSchema, suggestionIdentity, type DishType, type ModelRecipe } from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';
import { type PageRecipe, type RecipePageFetcher } from './recipe-page.fetcher.js';
import { RECIPE_PAGE_FETCHER } from './suggestion-provider.js';

/** Recette du réservoir telle que relue : `payload` revalidé, jamais casté. */
export interface PoolRecipe {
  identity: string;
  recipe: ModelRecipe;
  verified: boolean;
  firstSeenAt: string;
  pageRecipe: PageRecipe | null;
  pageText: string | null;
}

interface PageContent {
  structured: PageRecipe | null;
  text: string;
}

/**
 * Réservoir permanent des recettes suggérées (EF-25, EF-26). Une recette web
 * n'y entre qu'après lecture réussie de sa page, dont le contenu est recopié
 * une fois pour toutes (D10) : le site n'est plus rappelé ensuite.
 */
@Injectable()
export class SuggestionPoolService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RECIPE_PAGE_FETCHER) private readonly pageFetcher: RecipePageFetcher,
    private readonly logger: Logger,
  ) {}

  /** Rend le nombre de recettes retenues. Un échec sur une recette n'en fait jamais tomber une autre. */
  async ingest(recipes: readonly ModelRecipe[], model: string): Promise<number> {
    const identities = recipes.map((recipe) => suggestionIdentity(recipe));
    // D10 : une page déjà lue ne se relit pas, on ne fait que rafraîchir lastSeenAt.
    const alreadyRead = new Set(
      (await this.prisma.suggestionPoolRecipe.findMany({ where: { identity: { in: identities }, verifiedAt: { not: null } }, select: { identity: true } })).map((row) => row.identity),
    );
    const kept = await Promise.all(recipes.map((recipe, index) => this.ingestOne(recipe, identities[index] as string, model, alreadyRead)));
    return kept.filter(Boolean).length;
  }

  async read(filter: { dishType?: DishType } = {}): Promise<PoolRecipe[]> {
    const rows = await this.prisma.suggestionPoolRecipe.findMany({ where: filter.dishType ? { dishType: filter.dishType } : {}, orderBy: { firstSeenAt: 'desc' } });
    const result: PoolRecipe[] = [];
    for (const row of rows) {
      const parsed = modelRecipeSchema.safeParse(row.payload);
      if (!parsed.success) continue; // ligne non conforme : traitée comme absente
      result.push({
        identity: row.identity,
        recipe: parsed.data,
        verified: row.verifiedAt !== null,
        firstSeenAt: row.firstSeenAt.toISOString(),
        pageRecipe: row.pageRecipe as PageRecipe | null,
        pageText: row.pageText,
      });
    }
    return result;
  }

  private async ingestOne(recipe: ModelRecipe, identity: string, model: string, alreadyRead: ReadonlySet<string>): Promise<boolean> {
    let content: PageContent | null = null;
    if (recipe.provenance === 'web' && !alreadyRead.has(identity)) {
      try {
        content = recipe.sourceUrl ? await this.pageFetcher.fetchContent(recipe.sourceUrl) : null;
      } catch (error) {
        // Refus de sécurité ou panne quelconque : la recette est jetée, la fournée continue.
        content = null;
        this.logger.warn({ sourceUrl: recipe.sourceUrl, err: error }, 'Page de recette illisible');
      }
      if (content === null) return false;
    }
    const now = new Date();
    try {
      await this.prisma.suggestionPoolRecipe.upsert({
        where: { identity },
        create: {
          identity,
          payload: recipe as unknown as Prisma.InputJsonValue,
          provenance: recipe.provenance,
          dishType: recipe.dishType,
          sourceUrl: recipe.sourceUrl,
          verifiedAt: content ? now : null,
          pageRecipe: content?.structured ? (content.structured as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          pageText: content?.text ?? null,
          model,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: { lastSeenAt: now, model },
      });
      if (content) {
        // Atomique : ne remplit que si la ligne n'a encore aucun contenu de page.
        await this.prisma.suggestionPoolRecipe.updateMany({
          where: { identity, verifiedAt: null },
          data: {
            verifiedAt: now,
            pageRecipe: content.structured ? (content.structured as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            pageText: content.text,
          },
        });
      }
      return true;
    } catch (error) {
      this.logger.warn({ identity, err: error }, 'Recette non écrite au réservoir');
      return false; // une écriture en échec ne fait pas échouer la fournée
    }
  }
}
