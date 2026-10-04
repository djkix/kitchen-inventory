import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  classifyMatch,
  modelBatchSchema,
  pickSeedIngredients,
  recipeCoverage,
  type CoverageIngredient,
  type ModelRecipe,
  type StockSnapshot,
  type SuggestionBatchDto,
  type SuggestionDto,
  type SuggestionIngredientDto,
  type SuggestionQuery,
} from '@kitchen/shared';
import { Prisma, type SuggestionBatch } from '@prisma/client';
import { ApiError, assertProviderEnabled } from '../common/api-error.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import type { RequestUser } from '../auth/request-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { loadCategoryRows, loadSeedCandidates, RecipesCoverageService } from '../recipes/recipes.coverage.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { VISION_PROVIDER_NAMES } from '../recognition/recognition.service.js';
import { SUGGESTION_PROVIDER, type SuggestionOutput, type SuggestionProvider, type SuggestionRequest } from './suggestion-provider.js';

/** Taille visée d'une fournée (section 5.1, B8) : douze recettes, huit web pour quatre composées. */
export const SUGGESTION_BATCH_SIZE = 12;
const SUGGESTION_AI_TARGET = 4;
const SUGGESTION_WEB_TARGET = SUGGESTION_BATCH_SIZE - SUGGESTION_AI_TARGET;
/**
 * Marge demandée au fournisseur au-delà du total voulu (voir « Vigilance 2 » du
 * rapport de tâche 5) : `GeminiSuggestionProvider.suggest()` tronque déjà à `count`
 * dans l'ordre brut du modèle, avant que ce service ne voie le résultat — si le
 * modèle plaçait toutes ses recettes web avant les composées, une troncature
 * stricte à `SUGGESTION_BATCH_SIZE` effacerait la part composée en entier. Demander
 * quelques recettes de plus borne ce risque (la répartition finale se fait ensuite
 * ici, dans `rebalance`), sans pouvoir l'exclure complètement : une vraie garantie
 * demanderait de ne plus tronquer du tout côté fournisseur, hors périmètre ici.
 */
const SUGGESTION_REQUEST_BUFFER = 4;

/** Signature de cache (B12) : identifiants de départ triés + orientation + version du prompt. */
const SUGGESTION_SIGNATURE_VERSION = 'v1';
/** Une fournée en cache de plus de 24 heures est ignorée (section 9, B12). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Score minimal pour qu'un candidat pg_trgm soit retenu dans la liste envoyée à `classifyMatch`. */
const MATCH_CANDIDATE_FLOOR = 0.15;
/** Candidats conservés par libellé : assez pour laisser `classifyMatch` choisir, jamais pour tout le catalogue. */
const MATCH_CANDIDATES_PER_LABEL = 5;

/**
 * `productId` impossible (jamais généré par `cuid()`) pour qu'un ingrédient sans
 * aucun rapprochement (`classifyMatch` → `absent`) traverse `ingredientOutcome`
 * comme « suivi mais absent du stock », donc `missing` — jamais `untracked`, qui
 * le sortirait silencieusement du calcul de couverture et ferait apparaître une
 * recette dont le foyer ne possède aucun ingrédient comme entièrement couverte
 * (défaut critique corrigé en revue de tâche 6). La règle partagée elle-même
 * n'est pas touchée : `untracked` reste le bon verdict pour un ingrédient libre
 * d'une recette du foyer, qui n'a jamais prétendu viser un produit.
 */
const ABSENT_MATCH_SENTINEL = '__suggestion_absent_match__';

interface StoredBatchPayload {
  recipes: ModelRecipe[];
}

/** Fournée validée, prête à être rendue : signature de stockage nettoyée de la ligne Prisma brute. */
interface ParsedBatch {
  id: string;
  generatedAt: string;
  recipes: ModelRecipe[];
}

/**
 * Répartit la fournée reçue entre web et composé plutôt que de garder l'ordre
 * brut du modèle (voir le commentaire de `SUGGESTION_REQUEST_BUFFER`) : prend
 * jusqu'à `SUGGESTION_WEB_TARGET` recettes web et `SUGGESTION_AI_TARGET`
 * composées, puis complète avec le reste si l'une des deux sources est en
 * déficit, jusqu'à `SUGGESTION_BATCH_SIZE`.
 */
function rebalance(recipes: readonly ModelRecipe[]): ModelRecipe[] {
  const web = recipes.filter((r) => r.provenance === 'web');
  const ai = recipes.filter((r) => r.provenance === 'ai');
  const webTaken = web.slice(0, SUGGESTION_WEB_TARGET);
  const aiTaken = ai.slice(0, SUGGESTION_AI_TARGET);
  let combined = [...webTaken, ...aiTaken];
  if (combined.length < SUGGESTION_BATCH_SIZE) {
    const leftovers = [...web.slice(webTaken.length), ...ai.slice(aiTaken.length)];
    combined = [...combined, ...leftovers.slice(0, SUGGESTION_BATCH_SIZE - combined.length)];
  }
  return combined.slice(0, SUGGESTION_BATCH_SIZE);
}

function computeSignature(seedProductIds: readonly string[], query: SuggestionQuery): string {
  const payload = JSON.stringify({
    seeds: [...seedProductIds].sort(),
    region: query.region ?? null,
    maxMinutes: query.maxMinutes ?? null,
    difficulty: query.difficulty ?? null,
    version: SUGGESTION_SIGNATURE_VERSION,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Service de suggestion de recettes (EF-26) : compose la requête depuis le stock
 * réel, interroge le fournisseur (sous cache et quotas), rapproche les ingrédients
 * rendus du stock, puis calcule leur couverture — en réutilisant les règles pures
 * partagées, jamais en les recopiant.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coverage: RecipesCoverageService,
    @Inject(SUGGESTION_PROVIDER) private readonly provider: SuggestionProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * `user` n'est pas encore consommé par cette tâche (fournée partagée par le
   * foyer, pas personnalisée) : il est conservé dans la signature pour les
   * tâches suivantes (conservation d'une suggestion, tâche 9).
   */
  async list(query: SuggestionQuery, _user: RequestUser): Promise<SuggestionBatchDto> {
    // Vérifié avant toute lecture du stock : inutile de composer une requête
    // si le fournisseur ne pourra de toute façon pas répondre. Garde partagée
    // avec `RecognitionService.recognizeImage` (`assertProviderEnabled`).
    assertProviderEnabled(this.provider, 'suggestions');
    // Une seule lecture de l'arbre des catégories, partagée par l'instantané de
    // stock et par les candidats de départ (revue de tâche 6 : `snapshot()` et
    // `loadSeedCandidates` interrogeaient chacun la table `Category`).
    const categories = await loadCategoryRows(this.prisma);
    const snapshot = await this.coverage.snapshot(new Date(), categories);
    const candidates = await loadSeedCandidates(this.prisma, snapshot, categories);
    const seeds = pickSeedIngredients(candidates, new Date());
    if (seeds.length === 0) {
      throw ApiError.conflict('Le stock ne contient pas assez d’ingrédients pour composer une recherche de recettes', {
        reason: 'stock_insuffisant',
      });
    }

    const signature = computeSignature(
      seeds.map((s) => s.productId),
      query,
    );

    let batch: ParsedBatch | null = query.refresh ? null : await this.readFreshBatch(signature);
    let fromCache = batch !== null;
    let notice: string | null = null;

    if (!batch) {
      const quotaMessage = await this.quotaMessage();
      if (quotaMessage) {
        const stale = await this.readLatestBatch();
        if (!stale) throw ApiError.rateLimited(quotaMessage);
        batch = stale;
        fromCache = true;
        notice = quotaMessage;
      } else {
        batch = await this.fetchAndStore(signature, seeds, query);
        fromCache = false;
      }
    }

    const items = await this.toSuggestionDtos(batch.recipes, snapshot);

    return {
      batchId: batch.id,
      generatedAt: batch.generatedAt,
      fromCache,
      items,
      notice,
    };
  }

  /**
   * Charge une fournée et la valide contre le schéma partagé avant de la faire
   * confiance : une donnée dérivée du modèle, passée par le stockage, se revalide
   * comme n'importe quelle entrée (revue de tâche 6). Une ligne qui ne valide
   * plus (schéma changé entre-temps, donnée corrompue) est traitée comme absente,
   * jamais castée telle quelle.
   */
  private parseRow(row: SuggestionBatch): ParsedBatch | null {
    const result = modelBatchSchema.safeParse(row.payload);
    if (!result.success) return null;
    return { id: row.id, generatedAt: row.createdAt.toISOString(), recipes: result.data.recipes };
  }

  private async readFreshBatch(signature: string): Promise<ParsedBatch | null> {
    const row = await this.prisma.suggestionBatch.findUnique({ where: { signature } });
    if (!row) return null;
    if (Date.now() - row.createdAt.getTime() > CACHE_TTL_MS) return null;
    return this.parseRow(row);
  }

  private async readLatestBatch(): Promise<ParsedBatch | null> {
    const row = await this.prisma.suggestionBatch.findFirst({ orderBy: { createdAt: 'desc' } });
    return row ? this.parseRow(row) : null;
  }

  /** `null` si l'appel est permis ; sinon le message français à afficher avec la dernière fournée connue. */
  private async quotaMessage(): Promise<string | null> {
    const dailyQuota = this.config.RECIPE_SUGGESTION_DAILY_QUOTA;
    const cap = this.config.VISION_MONTHLY_CAP_CENTS;
    // Les deux lectures sont indépendantes (revue de tâche 6) : inutile de les enchaîner.
    const [callsToday, spent] = await Promise.all([
      this.prisma.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION', createdAt: { gte: startOfDay(new Date()) } } }),
      cap > 0
        ? this.prisma.recognitionLog.aggregate({ where: { provider: { in: VISION_PROVIDER_NAMES }, createdAt: { gte: startOfMonth(new Date()) } }, _sum: { costCents: true } })
        : Promise.resolve(null),
    ]);
    if (callsToday >= dailyQuota) {
      return `Quota journalier de suggestions atteint (${dailyQuota} par jour) ; la dernière fournée connue est affichée.`;
    }
    if (cap > 0) {
      const spentCents = spent?._sum.costCents?.toNumber() ?? 0;
      if (spentCents >= cap) {
        return 'Plafond de dépense mensuel atteint ; la dernière fournée connue est affichée.';
      }
    }
    return null;
  }

  private async fetchAndStore(
    signature: string,
    seeds: readonly { productId: string; name: string }[],
    query: SuggestionQuery,
  ): Promise<ParsedBatch> {
    const request: SuggestionRequest = {
      seeds: seeds.map((s) => s.name),
      region: query.region,
      maxMinutes: query.maxMinutes,
      difficulty: query.difficulty,
      count: SUGGESTION_BATCH_SIZE + SUGGESTION_REQUEST_BUFFER,
    };

    const started = Date.now();
    let output: SuggestionOutput;
    try {
      output = await this.provider.suggest(request);
    } catch (error) {
      await this.logCall(null, Date.now() - started, error);
      const message = error instanceof ProviderError ? error.message : 'Fournisseur de suggestions injoignable';
      throw ApiError.providerUnavailable(message);
    }
    await this.logCall(output, Date.now() - started, null);

    const recipes = rebalance(output.recipes);
    const payload: StoredBatchPayload = { recipes };
    const row = await this.prisma.suggestionBatch.upsert({
      where: { signature },
      create: { signature, payload: toJson(payload), model: output.model, costCents: output.costCents },
      update: { payload: toJson(payload), model: output.model, costCents: output.costCents, createdAt: new Date() },
    });
    // Construit directement depuis les recettes qu'on vient d'écrire : pas besoin de
    // relire et revalider ce qu'on a soi-même produit dans le même appel.
    return { id: row.id, generatedAt: row.createdAt.toISOString(), recipes };
  }

  private async logCall(output: SuggestionOutput | null, latencyMs: number, error: unknown): Promise<void> {
    await this.prisma.recognitionLog.create({
      data: {
        provider: this.provider.name,
        purpose: 'RECIPE_SUGGESTION',
        succeeded: output !== null,
        costCents: output?.costCents ?? null,
        latencyMs,
        rawResult: toJson(output?.raw ?? (error ? { error: String(error instanceof Error ? error.message : error) } : null)),
      },
    });
  }

  /**
   * Rapprochement du stock (EF-26) : une seule requête `pg_trgm` pour tous les
   * libellés d'ingrédients de la fournée entière, jamais une par ingrédient —
   * une douzaine de recettes à dix ingrédients chacune ferait cent vingt
   * requêtes si ce n'était pas le cas.
   */
  private async toSuggestionDtos(recipes: readonly ModelRecipe[], snapshot: StockSnapshot): Promise<SuggestionDto[]> {
    const labels = recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.label));
    const matchesByLabel = await this.matchLabels(labels);

    return recipes.map((recipe, recipeIndex) => {
      const rows = recipe.ingredients.map((ingredient, ingredientIndex) => {
        const match = classifyMatch(ingredient.label, matchesByLabel.get(ingredient.label.trim()) ?? []);
        return { id: `${recipeIndex}:${ingredientIndex}`, ingredient, match };
      });

      const coverageIngredients: CoverageIngredient[] = rows.map(({ id, ingredient, match }) => ({
        id,
        // Un rapprochement `absent` reçoit un `productId` factice qui n'existe dans
        // aucun stock (`ABSENT_MATCH_SENTINEL`), jamais `null` : `ingredientOutcome`
        // traiterait `productId` et `categoryId` tous deux `null` comme `untracked`
        // (« rien à vérifier »), ce qui ferait disparaître l'ingrédient du calcul de
        // couverture et rendrait « prête » une recette dont le foyer ne possède
        // aucun ingrédient (défaut critique corrigé en revue de tâche 6). Avec le
        // sentinel, l'ingrédient reste suivi et ressort `missing` (recherche vide
        // dans `snapshot.byProduct`), ce qui est le constat exact.
        productId: match.productId ?? ABSENT_MATCH_SENTINEL,
        categoryId: null,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        // Le modèle ne distingue ni essentiel ni substituable : sans cette
        // information, aucun ingrédient ne doit porter de veto à lui seul sur le
        // groupe « presque » — c'est `missing.length <= 2 && coverage >= 0.6`
        // (règle partagée) qui doit faire la discrimination, pas une essentialité
        // arbitraire (revue de tâche 6 : `essential: true` partout rendait le
        // groupe « presque » inatteignable pour ce module).
        essential: false,
        substitutable: false,
      }));
      const coverage = recipeCoverage(coverageIngredients, snapshot);
      const outcomeById = new Map(coverage.outcomes.map((o) => [o.id, o]));

      const ingredientDtos: SuggestionIngredientDto[] = rows.map(({ id, ingredient, match }) => ({
        label: ingredient.label,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        match: match.state,
        productId: match.productId,
        productName: match.productName,
        state: outcomeById.get(id)?.state ?? 'untracked',
      }));
      const labelById = new Map(rows.map(({ id, ingredient }) => [id, ingredient.label]));
      const missingLabels = coverage.missingIds.map((id) => labelById.get(id) ?? id);

      const dto: SuggestionDto = {
        id: String(recipeIndex),
        title: recipe.title,
        origin: recipe.origin,
        region: recipe.region,
        totalMinutes: recipe.totalMinutes,
        difficulty: recipe.difficulty,
        provenance: recipe.provenance,
        sourceUrl: recipe.sourceUrl,
        ingredients: ingredientDtos,
        coverage: coverage.coverage,
        group: coverage.group,
        missingLabels,
      };
      return dto;
    });
  }

  private async matchLabels(labels: readonly string[]): Promise<Map<string, { productId: string; name: string; similarity: number }[]>> {
    const distinct = [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
    const byLabel = new Map<string, { productId: string; name: string; similarity: number }[]>();
    if (distinct.length === 0) return byLabel;

    // `word_similarity` (pas `similarity`) : le libellé générique d'un ingrédient
    // (« crème ») doit se rapprocher d'un nom de produit complet qui le contient
    // (« Crème fraîche épaisse 30 % »), pas seulement d'un nom presque identique.
    const rows = await this.prisma.$queryRaw<Array<{ label: string; productId: string; name: string; score: number }>>(Prisma.sql`
      SELECT q.label, c.id AS "productId", c.name, c.score
      FROM unnest(${distinct}::text[]) AS q(label)
      CROSS JOIN LATERAL (
        SELECT p.id, p.name, word_similarity(unaccent_lite(q.label), unaccent_lite(p.name)) AS score
        FROM "Product" p
        WHERE p."mergedIntoId" IS NULL
        ORDER BY score DESC
        LIMIT ${MATCH_CANDIDATES_PER_LABEL}
      ) c
      WHERE c.score >= ${MATCH_CANDIDATE_FLOOR}
    `);

    for (const row of rows) {
      const list = byLabel.get(row.label) ?? [];
      list.push({ productId: row.productId, name: row.name, similarity: Number(row.score) });
      byLabel.set(row.label, list);
    }
    return byLabel;
  }
}
