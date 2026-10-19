import { Inject, Injectable } from '@nestjs/common';
import { modelRecipeSchema, suggestionIdentity, type Difficulty, type DishType, type ModelRecipe, type SuggestionRegion } from '@kitchen/shared';
import { Prisma, type SuggestionPoolRecipe as SuggestionPoolRecipeRow } from '@prisma/client';
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

/**
 * Orientation demandée à l'écran (D6). Seul `dishType` est une colonne de la
 * table : les trois autres vivent dans le `payload` JSON et se filtrent donc
 * après revalidation, en mémoire. Le volume du réservoir (quelques centaines de
 * lignes au pire, D1) rend une colonne indexée par critère inutile.
 */
export interface PoolFilter {
  dishType?: DishType;
  region?: SuggestionRegion;
  /** Durée totale maximale acceptée, en minutes. */
  maxMinutes?: number;
  difficulty?: Difficulty;
}

/** Ligne du réservoir revalidée, ou `null` si son `payload` n'est plus conforme au schéma. */
function toPoolRecipe(row: SuggestionPoolRecipeRow): PoolRecipe | null {
  const parsed = modelRecipeSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  return {
    identity: row.identity,
    recipe: parsed.data,
    verified: row.verifiedAt !== null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    pageRecipe: row.pageRecipe as PageRecipe | null,
    pageText: row.pageText,
  };
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

  /** Rend le nombre de recettes nouvellement créées au réservoir (une ligne déjà connue, seulement revue, ne compte pas). Un échec sur une recette n'en fait jamais tomber une autre. */
  async ingest(recipes: readonly ModelRecipe[], model: string): Promise<number> {
    const identities = recipes.map((recipe) => suggestionIdentity(recipe));
    const known = await this.prisma.suggestionPoolRecipe.findMany({ where: { identity: { in: identities } }, select: { identity: true, verifiedAt: true } });
    const existing = new Set(known.map((row) => row.identity));
    // D10 : une page déjà lue ne se relit pas, on ne fait que rafraîchir lastSeenAt.
    const alreadyRead = new Set(known.filter((row) => row.verifiedAt !== null).map((row) => row.identity));
    // Un seul instant pour toute la fournée (revue de la tâche 4) : pris dans
    // `ingestOne`, il tombait APRÈS l'`await` de lecture de page, si bien que
    // les recettes web héritaient d'un `firstSeenAt` dicté par l'ordre d'arrivée
    // des réponses HTTP — donc d'un ordre d'affichage instable d'une exécution
    // à l'autre. Une fournée est découverte d'un bloc, et l'ordre se départage
    // ensuite sur le titre et l'identité (`comparePoolEntries`).
    const now = new Date();
    // Dédoublonnage AVANT l'écriture, la première occurrence gagne (CI du
    // 2026-10-18). Deux compositions de même titre portent la même identité :
    // les passer toutes les deux à `Promise.all` lançait deux `upsert`
    // concurrents sur la même ligne, et la survivante dépendait de l'ordre
    // d'arrivée — stable sur ma machine, inversé en intégration continue, où le
    // test qui épingle laquelle survit est tombé. Filtrer ici rend le résultat
    // déterministe et supprime au passage la collision d'écriture.
    const unique = recipes
      .map((recipe, index) => ({ recipe, identity: identities[index] as string }))
      .filter((entry, index) => identities.indexOf(entry.identity) === index);
    const written = await Promise.all(unique.map((entry) => this.ingestOne(entry.recipe, entry.identity, model, alreadyRead, now)));
    return unique.filter((entry, index) => written[index] && !existing.has(entry.identity)).length;
  }

  /** Nombre de recettes au réservoir, toutes orientations confondues (2026-10-19). */
  async count(): Promise<number> {
    return this.prisma.suggestionPoolRecipe.count();
  }

  async read(filter: PoolFilter = {}): Promise<PoolRecipe[]> {
    const rows = await this.prisma.suggestionPoolRecipe.findMany({ where: filter.dishType ? { dishType: filter.dishType } : {}, orderBy: { firstSeenAt: 'desc' } });
    const result: PoolRecipe[] = [];
    for (const row of rows) {
      const entry = toPoolRecipe(row);
      if (!entry) continue; // ligne non conforme : traitée comme absente
      // Filtres portés par le `payload`, appliqués sur la recette revalidée.
      if (filter.region && entry.recipe.region !== filter.region) continue;
      if (filter.maxMinutes !== undefined && entry.recipe.totalMinutes > filter.maxMinutes) continue;
      if (filter.difficulty && entry.recipe.difficulty !== filter.difficulty) continue;
      result.push(entry);
    }
    return result;
  }

  /**
   * Une recette du réservoir par son identité (D9), ou `null`. `identity` est
   * unique : la conservation est une lecture directe, sans fournée à
   * revalider ni rang à retrouver.
   */
  async findByIdentity(identity: string): Promise<PoolRecipe | null> {
    const row = await this.prisma.suggestionPoolRecipe.findUnique({ where: { identity } });
    return row ? toPoolRecipe(row) : null;
  }

  private async ingestOne(recipe: ModelRecipe, identity: string, model: string, alreadyRead: ReadonlySet<string>, now: Date): Promise<boolean> {
    let content: PageContent | null = null;
    if (recipe.provenance === 'web' && !alreadyRead.has(identity)) {
      try {
        content = recipe.sourceUrl ? await this.pageFetcher.fetchContent(recipe.sourceUrl) : null;
      } catch (error) {
        // Refus de sécurité ou panne quelconque : la recette est jetée, la fournée continue.
        content = null;
        this.logger.warn({ sourceUrl: recipe.sourceUrl, err: error }, 'Page de recette illisible');
      }
      // Jetée sans exception : `fetchContent` rend `null` pour une page qui ne
      // répond pas, et ne lève que pour un refus de sécurité. Sans cette ligne,
      // une recette disparaissait du réservoir sans laisser la moindre trace —
      // exactement le silence que le reste de ce service cherche à éviter.
      if (content === null) {
        this.logger.warn({ sourceUrl: recipe.sourceUrl }, 'Recette web écartée : page injoignable');
        return false;
      }
    }
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
        // Atomique, et pas redondant avec le garde `alreadyRead` (contre-revue du
        // 2026-10-15) : ce garde est calculé AVANT les lectures de pages, donc deux
        // fournées simultanées portant la même recette peuvent toutes deux lire la
        // page. Sans `verifiedAt: null`, la seconde écraserait le contenu déjà
        // recopié par la première — une seconde lecture du site, contraire à D10.
        // Aucun test ne couvre cette course : il faudrait deux `ingest` concurrents
        // à latence contrôlée. Le filet reste, il ne coûte qu'une clause.
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
