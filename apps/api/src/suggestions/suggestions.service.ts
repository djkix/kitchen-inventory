import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  classifyMatch,
  comparePoolEntries,
  createRecipeSchema,
  modelBatchSchema,
  pickSeedIngredients,
  recipeCoverage,
  suggestionIdentity,
  suggestionIdentities,
  type CoverageIngredient,
  type CreateRecipeInput,
  type KeepSuggestionInput,
  type ModelRecipe,
  type RecipeDto,
  type RecipeRewrite,
  type StockSnapshot,
  type SuggestionBatchDto,
  type SuggestionDto,
  type SuggestionIngredientDto,
  type SuggestionQuery,
  type Unit,
} from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import { ApiError, assertProviderEnabled } from '../common/api-error.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import type { RequestUser } from '../auth/request-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { loadCategoryRows, loadSeedCandidates, RecipesCoverageService } from '../recipes/recipes.coverage.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { VISION_PROVIDER_NAMES } from '../recognition/recognition.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { InvalidRewriteError, type GeminiRecipeRewriter, type RecipeRewriteInput } from './gemini-recipe-rewriter.js';
import { RecipePageRefusedError, type PageRecipe, type RecipePageFetcher } from './recipe-page.fetcher.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import { SuggestionPoolService, type PoolRecipe } from './suggestion-pool.service.js';
import { RECIPE_PAGE_FETCHER, RECIPE_REWRITER, SuggestionProviderError, type SuggestionAttempt, type SuggestionOutput, type SuggestionRequest } from './suggestion-provider.js';

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
export const SUGGESTION_REQUEST_BUFFER = 4;

/**
 * Plancher sous lequel le réservoir ne suffit plus pour l'orientation demandée
 * et justifie un appel au modèle (décision D6, 2026-10-15) : la moitié d'une
 * fournée. Au-dessus, rien n'est demandé à Gemini — c'est tout l'objet du
 * réservoir.
 */
const SUGGESTION_POOL_FLOOR = 6;

/**
 * Clé d'orientation d'une `SuggestionBatch` (D11, 2026-10-15) : la question
 * posée au modèle, et elle seule — région, durée, facilité, type de plat,
 * version. **Plus les graines** : elles portent le stock, donc exactement la
 * volatilité que le réservoir supprime (un article consommé changeait la
 * pioche, donc la signature, donc rappelait le modèle). La ligne ne sert plus
 * à servir une réponse (D8) mais à répondre à « cette orientation a-t-elle
 * déjà été demandée, et quand ? » — ce qui n'a de sens que si elle ne dépend
 * pas du contenu du placard.
 *
 * Passée à `v2` le 2026-10-08 avec l'arrivée du type de plat, à `v3` le même
 * jour avec les durées de préparation et de cuisson séparées, et à `v4` le
 * 2026-10-15 avec le retrait des graines : sans ce changement de version, les
 * lignes écrites avant seraient relues comme des orientations qu'elles ne
 * désignent pas.
 */
const SUGGESTION_SIGNATURE_VERSION = 'v4';

/**
 * Au-delà de ce délai, une orientation déjà demandée peut l'être à nouveau
 * (D11) : le réservoir a pu se vider de son intérêt, et une journée est la
 * granularité du quota journalier.
 */
const SAME_ORIENTATION_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Répartit la fournée reçue entre web et composé plutôt que de garder l'ordre
 * brut du modèle (voir le commentaire de `SUGGESTION_REQUEST_BUFFER`) : prend
 * jusqu'à `SUGGESTION_WEB_TARGET` recettes web et `SUGGESTION_AI_TARGET`
 * composées, puis complète avec le reste si l'une des deux sources est en
 * déficit, jusqu'à `SUGGESTION_BATCH_SIZE`.
 *
 * Exportée pour être couverte au nombre réellement demandé en production
 * (`SUGGESTION_BATCH_SIZE + SUGGESTION_REQUEST_BUFFER`, soit seize), et pas
 * seulement à la taille de la fournée rendue.
 */
export function rebalance(recipes: readonly ModelRecipe[]): ModelRecipe[] {
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

function computeSignature(query: SuggestionQuery): string {
  const payload = JSON.stringify({
    region: query.region ?? null,
    maxMinutes: query.maxMinutes ?? null,
    difficulty: query.difficulty ?? null,
    dishType: query.dishType ?? null,
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

/** Somme des coûts connus des tentatives ; `null` si aucune n'a pu être chiffrée. */
function totalCostCents(attempts: readonly { costCents: number | null }[]): number | null {
  const known = attempts.map((a) => a.costCents).filter((c): c is number => c !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, c) => sum + c, 0);
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
    private readonly recipes: RecipesService,
    private readonly provider: GeminiSuggestionProvider,
    private readonly pool: SuggestionPoolService,
    @Inject(RECIPE_PAGE_FETCHER) private readonly pageFetcher: RecipePageFetcher,
    @Inject(RECIPE_REWRITER) private readonly rewriter: GeminiRecipeRewriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
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
      throw ApiError.insufficientStock('Le stock ne contient pas assez d’ingrédients pour composer une recherche de recettes');
    }

    const signature = computeSignature(query);
    // Le réservoir d'abord, toujours (D6) : le modèle n'est appelé que s'il ne
    // rend pas de quoi remplir l'écran pour l'orientation demandée, ou si la
    // relance explicite le réclame. Sur relance, cette lecture serait jetée
    // telle quelle : elle n'est pas faite (revue de la tâche 4).
    let entries = query.refresh ? [] : await this.readPool(query);
    let fromCache = true;
    let notice: string | null = null;

    // Sous le plancher mais déjà demandée aujourd'hui : on sert ce que le
    // réservoir a, même maigre (D11). Un palier étroit — « ≤ 15 min » — laisse
    // sinon le réservoir sous le plancher à chaque visite et rappelle le modèle
    // à chaque fois, jusqu'à manger le plafond mensuel partagé avec le scan.
    const mustAsk = query.refresh || (entries.length < SUGGESTION_POOL_FLOOR && !(await this.askedRecently(signature)));

    if (mustAsk) {
      const breach = await this.quotaBreach();
      if (breach) {
        // Repli : le réservoir entier, sans filtre d'orientation (D8) — mieux
        // vaut des recettes hors orientation qu'un écran vide, à condition de
        // le dire (`quotaMessage`).
        const fallback = await this.readPool({ refresh: false });
        if (fallback.length === 0) throw ApiError.rateLimited(this.quotaMessage(breach, false));
        entries = fallback;
        notice = this.quotaMessage(breach, true);
      } else {
        const fetched = await this.fetchAndStore(signature, seeds, query);
        await this.pool.ingest(fetched.recipes, fetched.model);
        // Relecture obligatoire, jamais la réponse brute du modèle : une recette
        // web dont la page n'existe pas a été jetée à l'ingestion (D4) et ne
        // doit à aucun moment atteindre l'écran.
        entries = await this.readPool(query);
        fromCache = false;
      }
    }

    const items = await this.toSuggestionDtos(entries, snapshot);
    // Ordre du réservoir (D7), par la règle pure partagée : jamais réécrit ici.
    const firstSeenById = new Map(entries.map((entry) => [entry.identity, entry.firstSeenAt]));
    const key = (dto: SuggestionDto): Parameters<typeof comparePoolEntries>[0] => ({
      verified: dto.verified,
      coverage: dto.coverage,
      firstSeenAt: firstSeenById.get(dto.id) ?? '',
      title: dto.title,
      identity: dto.id,
    });
    items.sort((a, b) => comparePoolEntries(key(a), key(b)));

    // `SuggestionBatch` ne sert plus à servir (D8), mais reste le journal de la
    // dernière livraison : `batchId` désigne toujours celle-ci, et la
    // conservation s'en sert encore jusqu'à la tâche 6 (D9).
    const latest = await this.prisma.suggestionBatch.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } });

    return {
      batchId: latest?.id ?? '',
      generatedAt: (latest?.createdAt ?? new Date()).toISOString(),
      fromCache,
      items,
      notice,
    };
  }

  /**
   * Réservoir filtré sur l'orientation demandée, moins les recettes déjà
   * conservées dans « Mes recettes » (D7) : ce que le foyer a gardé n'a pas à
   * lui être reproposé.
   *
   * Le rapprochement se fait par URL source pour une recette web — son titre
   * change à la conservation, réécrit par Gemini, mais pas son lien — et par
   * identité de contenu pour une composition, qui n'a pas de lien et garde son
   * titre. Limite connue : une composition dont le titre serait modifié à la
   * main dans « Mes recettes » pourrait réapparaître une fois.
   */
  private async readPool(query: SuggestionQuery): Promise<PoolRecipe[]> {
    const [entries, kept] = await Promise.all([
      this.pool.read({ dishType: query.dishType, region: query.region, maxMinutes: query.maxMinutes, difficulty: query.difficulty }),
      this.prisma.recipe.findMany({ where: { source: { in: ['IMPORTED', 'GENERATED'] } }, select: { title: true, sourceUrl: true } }),
    ]);
    const keptUrls = new Set<string>();
    const keptIdentities = new Set<string>();
    for (const row of kept) {
      if (row.sourceUrl) keptUrls.add(row.sourceUrl.trim().toLowerCase());
      else keptIdentities.add(suggestionIdentity({ title: row.title, sourceUrl: null }));
    }
    return entries.filter((entry) =>
      entry.recipe.sourceUrl ? !keptUrls.has(entry.recipe.sourceUrl.trim().toLowerCase()) : !keptIdentities.has(entry.identity),
    );
  }

  /**
   * Cette orientation a-t-elle déjà été posée au modèle depuis moins de
   * `SAME_ORIENTATION_TTL_MS` (D11) ? Lu sur la `SuggestionBatch` de même
   * signature, dont l'`upsert` rafraîchit déjà `createdAt` : ni colonne ni
   * migration pour une question à laquelle la table répondait déjà.
   */
  private async askedRecently(signature: string): Promise<boolean> {
    const row = await this.prisma.suggestionBatch.findUnique({ where: { signature }, select: { createdAt: true } });
    return row !== null && Date.now() - row.createdAt.getTime() < SAME_ORIENTATION_TTL_MS;
  }

  /** `null` si l'appel est permis ; sinon la nature du dépassement (quota journalier ou plafond mensuel). */
  private async quotaBreach(): Promise<{ kind: 'daily' | 'monthly' } | null> {
    const dailyQuota = this.config.RECIPE_SUGGESTION_DAILY_QUOTA;
    const cap = this.config.VISION_MONTHLY_CAP_CENTS;
    // Les deux lectures sont indépendantes (revue de tâche 6) : inutile de les enchaîner.
    const [callsToday, spent] = await Promise.all([
      this.prisma.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION', createdAt: { gte: startOfDay(new Date()) } } }),
      cap > 0
        ? this.prisma.recognitionLog.aggregate({ where: { provider: { in: VISION_PROVIDER_NAMES }, createdAt: { gte: startOfMonth(new Date()) } }, _sum: { costCents: true } })
        : Promise.resolve(null),
    ]);
    if (callsToday >= dailyQuota) return { kind: 'daily' };
    if (cap > 0) {
      const spentCents = spent?._sum.costCents?.toNumber() ?? 0;
      if (spentCents >= cap) return { kind: 'monthly' };
    }
    return null;
  }

  /**
   * Un seul dépassement, deux vérités possibles : quand le réservoir porte
   * encore quelque chose (`hasPoolEntries`), le message peut annoncer que ces
   * recettes sont affichées ; sinon il ne doit jamais le promettre — rien n'est
   * montré (revue, round 1 de la tâche 10 : la phrase annonçant un repli
   * s'affichait aussi dans le cas où il n'y en avait aucun).
   *
   * Le repli lit le réservoir **sans filtre d'orientation** (D8) : le message
   * le dit, faute de quoi l'écran afficherait des desserts sous un filtre
   * « Plat » sans que rien ne l'explique (revue de la tâche 4).
   */
  private quotaMessage(breach: { kind: 'daily' | 'monthly' }, hasPoolEntries: boolean): string {
    if (breach.kind === 'daily') {
      const dailyQuota = this.config.RECIPE_SUGGESTION_DAILY_QUOTA;
      return hasPoolEntries
        ? `Quota journalier de suggestions atteint (${dailyQuota} par jour) ; les recettes déjà connues sont affichées, toutes orientations confondues.`
        : `Quota journalier de suggestions atteint (${dailyQuota} par jour) ; réessayez demain, ou augmentez-le dans la configuration du serveur.`;
    }
    return hasPoolEntries
      ? 'Plafond de dépense mensuel atteint ; les recettes déjà connues sont affichées, toutes orientations confondues.'
      : 'Plafond de dépense mensuel atteint ; réessayez le mois prochain, ou augmentez-le dans la configuration du serveur.';
  }

  /**
   * Appelle le modèle et marque l'orientation comme demandée dans
   * `SuggestionBatch` (D2 amendée par D11). Personne ne relit cette ligne pour
   * servir une réponse (D8) : elle dit « cette question a été posée, à telle
   * date, pour tel coût ». Le journal brut par appel, c'est
   * `RecognitionLog.rawResult` qui le tient. Les recettes rendues partent
   * ensuite à l'ingestion.
   */
  private async fetchAndStore(
    signature: string,
    seeds: readonly { productId: string; name: string }[],
    query: SuggestionQuery,
  ): Promise<{ recipes: ModelRecipe[]; model: string }> {
    const request: SuggestionRequest = {
      seeds: seeds.map((s) => s.name),
      region: query.region,
      maxMinutes: query.maxMinutes,
      difficulty: query.difficulty,
      dishType: query.dishType,
      count: SUGGESTION_BATCH_SIZE + SUGGESTION_REQUEST_BUFFER,
    };

    const started = Date.now();
    let output: SuggestionOutput;
    try {
      // Modèle relu à chaque fournée : un changement dans les réglages vaut
      // immédiatement, sans redémarrage du conteneur.
      const settings = await this.settings.get();
      output = await this.provider.suggest({ ...request, model: settings.suggestionModel, webSearch: settings.suggestionWebSearch });
    } catch (error) {
      // Une reprise déjà facturée doit être inscrite même quand tout échoue
      // ensuite : le fournisseur porte ses tentatives sur l'erreur.
      if (error instanceof SuggestionProviderError) {
        await this.logAttempts(error.attempts, false);
      } else {
        await this.logFailure(error, Date.now() - started);
      }
      const message = error instanceof ProviderError ? error.message : 'Fournisseur de suggestions injoignable';
      throw ApiError.providerUnavailable(message);
    }
    // Une ligne de registre par appel réellement passé (une, ou deux en cas de
    // reprise) : sans cela, les jetons de la première tentative échappaient à la
    // fois au quota journalier et au plafond mensuel.
    await this.logAttempts(output.attempts, true);

    const recipes = rebalance(output.recipes);
    const costCents = totalCostCents(output.attempts);
    await this.prisma.suggestionBatch.upsert({
      where: { signature },
      create: { signature, payload: toJson({ recipes }), model: output.model, costCents },
      update: { payload: toJson({ recipes }), model: output.model, costCents, createdAt: new Date() },
    });
    return { recipes, model: output.model };
  }

  /**
   * Journal partagé par toute consommation du fournisseur de suggestions
   * (recherche d'une fournée, tâche 7 ; réécriture à la conservation, tâche
   * 9) : même `purpose`, même plafond mensuel (`quotaBreach`). `providerName`
   * ne vaut `this.provider.name` que par défaut — la réécriture journalise
   * sous le nom du réécrivain, pas du fournisseur de fournées.
   */
  private async logCall(
    entry: { raw: unknown; costCents: number | null },
    succeeded: boolean,
    latencyMs: number,
    providerName: string = this.provider.name,
  ): Promise<void> {
    await this.prisma.recognitionLog.create({
      data: {
        provider: providerName,
        purpose: 'RECIPE_SUGGESTION',
        succeeded,
        costCents: entry.costCents,
        latencyMs,
        rawResult: toJson(entry.raw),
      },
    });
  }

  /** Échec sans aucune réponse du fournisseur : une ligne, sans coût, portant la cause. */
  private logFailure(error: unknown, latencyMs: number, providerName: string = this.provider.name): Promise<void> {
    return this.logCall({ raw: { error: String(error instanceof Error ? error.message : error) }, costCents: null }, false, latencyMs, providerName);
  }

  /** Une ligne de registre par tentative facturée, dans l'ordre où elles ont été faites. */
  private async logAttempts(attempts: readonly SuggestionAttempt[], succeeded: boolean): Promise<void> {
    for (const [index, attempt] of attempts.entries()) {
      // Seule la dernière tentative a pu aboutir ; les précédentes ont été payées pour rien.
      await this.logCall(attempt, succeeded && index === attempts.length - 1, attempt.latencyMs);
    }
  }

  /**
   * Rapprochement du stock (EF-26) : une seule requête `pg_trgm` pour tous les
   * libellés d'ingrédients de la fournée entière, jamais une par ingrédient —
   * une douzaine de recettes à dix ingrédients chacune ferait cent vingt
   * requêtes si ce n'était pas le cas.
   */
  private async toSuggestionDtos(entries: readonly PoolRecipe[], snapshot: StockSnapshot): Promise<SuggestionDto[]> {
    const labels = entries.flatMap((entry) => entry.recipe.ingredients.map((ingredient) => ingredient.label));
    const matchesByLabel = await this.matchLabels(labels);

    const perRecipe = entries.map(({ recipe, identity, verified }, recipeIndex) => {
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
      const labelById = new Map(rows.map(({ id, ingredient }) => [id, ingredient.label]));
      const missingLabels = coverage.missingIds.map((id) => labelById.get(id) ?? id);

      return { recipe, identity, verified, rows, coverage, outcomeById, missingLabels };
    });

    // Photo du produit rapproché (EF-23) : une seule requête pour toute la
    // fournée, sur les produits réellement rapprochés (jamais le sentinel de
    // couverture, qui ne désigne aucun produit réel).
    const matchedProductIds = [
      ...new Set(perRecipe.flatMap(({ rows }) => rows.map(({ match }) => match.productId).filter((id): id is string => id !== null))),
    ];
    const imagePathByProduct = await this.productImagePaths(matchedProductIds);

    return perRecipe.map(({ recipe, identity, verified, rows, coverage, outcomeById, missingLabels }) => {
      const ingredientDtos: SuggestionIngredientDto[] = rows.map(({ id, ingredient, match }) => {
        // Emplacement du lot qui sera consommé en premier (C4) : lu sur
        // l'instantané déjà chargé, jamais recalculé ici. `null` pour un
        // ingrédient non rapproché ou dont le produit n'est pas en stock.
        const entry = match.productId ? snapshot.byProduct.get(match.productId) : undefined;
        return {
          label: ingredient.label,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          match: match.state,
          productId: match.productId,
          productName: match.productName,
          productImagePath: match.productId ? (imagePathByProduct.get(match.productId) ?? null) : null,
          locationName: entry?.locationName ?? null,
          locationTemperature: entry?.locationTemperature ?? null,
          state: outcomeById.get(id)?.state ?? 'untracked',
        };
      });

      const dto: SuggestionDto = {
        // Identité dérivée du contenu, jamais le rang dans le tableau : un rang
        // ne désigne pas la même recette d'une liste à l'autre, et le tiroir
        // resté ouvert pendant un rafraîchissement en arrière-plan pouvait
        // conserver une autre recette que celle affichée. C'est désormais la
        // clé unique de la ligne du réservoir (D3), déjà dédoublonnée : plus
        // aucune désambiguïsation de titre n'est nécessaire ici.
        id: identity,
        title: recipe.title,
        origin: recipe.origin,
        region: recipe.region,
        totalMinutes: recipe.totalMinutes,
        prepMinutes: recipe.prepMinutes,
        cookMinutes: recipe.cookMinutes,
        difficulty: recipe.difficulty,
        dishType: recipe.dishType,
        provenance: recipe.provenance,
        sourceUrl: recipe.sourceUrl,
        // Page lue avec succès à l'ingestion (D4) : toujours faux pour une
        // composition, qui n'a pas de page à vérifier.
        verified,
        // Jamais les étapes d'une recette `web` : le modèle les propose sans
        // avoir lu la page, seule la conservation (réécriture Gemini de la
        // page réelle, B6) en garantit le contenu. Une composition `ai` n'a
        // pas cette réserve : ses étapes SONT la recette, déjà dans la fournée.
        steps: recipe.provenance === 'ai' ? recipe.steps : [],
        ingredients: ingredientDtos,
        coverage: coverage.coverage,
        group: coverage.group,
        missingLabels,
      };
      return dto;
    });
  }

  /** Photo de chaque produit rapproché (EF-23), en une seule requête pour toute la fournée. */
  private async productImagePaths(productIds: readonly string[]): Promise<Map<string, string | null>> {
    if (productIds.length === 0) return new Map();
    const products = await this.prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, imagePath: true } });
    return new Map(products.map((p) => [p.id, p.imagePath]));
  }

  /**
   * Conservation d'une suggestion (EF-25, EF-26, tâche 9) : « l'application
   * n'envoie jamais Franck vers le site » — pour `web`, la page est récupérée
   * en sécurité, lue si elle porte `schema.org/Recipe` [B14], sinon soumise en
   * texte nettoyé, puis réécrite par Gemini au format de l'application. Pour
   * `ai`, la composition est déjà au bon format : aucun appel réseau [B6].
   * Idempotente par `clientOpId` (section 8, migration 0006) sur
   * `Recipe.clientOpId` : vérifié ici en tout premier, avant toute dépense
   * (page récupérée, modèle appelé, quota entamé) — un rejeu ne doit payer
   * pour rien (revue de tâche 9, round 2). `RecipesService.createFromSuggestion`
   * garde son propre contrôle juste avant l'écriture, pour la course
   * concurrente que cette vérification préalable laisse passer ; ce n'est
   * qu'un filet, pas le chemin normal.
   */
  async keep(input: KeepSuggestionInput, user: RequestUser): Promise<RecipeDto> {
    if (input.clientOpId) {
      const existing = await this.recipes.findByClientOpId(input.clientOpId);
      if (existing) return existing;
    }

    const row = await this.prisma.suggestionBatch.findUnique({ where: { id: input.batchId } });
    if (!row) throw ApiError.notFound('Fournée de suggestions introuvable');

    const validated = modelBatchSchema.safeParse(row.payload);
    if (!validated.success) throw ApiError.notFound('Fournée de suggestions introuvable');
    const recipes = validated.data.recipes;

    // Recherchée par son identité de contenu, pas par un rang : une fournée dont
    // une entrée a été écartée à la validation décale tous les rangs suivants.
    // Mêmes identités qu'à la construction des DTO (`suggestionIdentities` sur
    // ce même tableau validé) : un titre dupliqué par le modèle y est
    // désambiguïsé de la même façon, donc la bonne recette est conservée.
    const identities = suggestionIdentities(recipes);
    const suggestionIndex = identities.indexOf(input.suggestionId);
    const suggestion = suggestionIndex === -1 ? undefined : recipes[suggestionIndex];
    if (!suggestion) throw ApiError.notFound('Suggestion introuvable dans cette fournée');

    const createInput = await this.buildCreateInput(suggestion);
    const source = suggestion.provenance === 'web' ? 'IMPORTED' : 'GENERATED';
    const sourceUrl = suggestion.provenance === 'web' ? suggestion.sourceUrl : null;
    return this.recipes.createFromSuggestion(createInput, source, sourceUrl, input.clientOpId ?? null, user.id);
  }

  /**
   * Matière de la recette à créer, selon la provenance [B6]. `ai` reprend les
   * étapes déjà rendues sans aucun appel ; `web` récupère la page puis la fait
   * réécrire par Gemini au format de l'application.
   */
  private async buildCreateInput(suggestion: ModelRecipe): Promise<CreateRecipeInput> {
    let title = suggestion.title;
    let steps: string[];
    let rawIngredients: { label: string; quantity: number | null; unit: Unit | null }[];

    if (suggestion.provenance === 'ai') {
      steps = suggestion.steps;
      rawIngredients = suggestion.ingredients;
    } else {
      // `modelRecipeSchema` exige déjà une URL https pour `web` (vigilance 2) : une
      // absence ici serait une donnée corrompue, jamais un cas normal à deviner.
      const sourceUrl = suggestion.sourceUrl;
      if (!sourceUrl) throw ApiError.notFound('Suggestion introuvable dans cette fournée');

      assertProviderEnabled(this.rewriter, 'suggestions');
      // La réécriture est un appel au même modèle que la recherche de fournée
      // (revue de tâche 9) : comptée dans le même quota journalier et le même
      // plafond mensuel, vérifié avant de dépenser quoi que ce soit — y
      // compris la récupération de la page, pour ne pas la payer en vain.
      // Pas de fournée de repli ici : une réécriture n'en sert jamais une, le
      // message ne doit donc jamais prétendre en afficher une.
      const breach = await this.quotaBreach();
      if (breach) throw ApiError.rateLimited(this.quotaMessage(breach, false));

      const material = await this.fetchWebRecipeMaterial(sourceUrl);
      const rewriteInput: RecipeRewriteInput =
        material.structured !== null
          ? { title: suggestion.title, origin: suggestion.origin, ingredients: material.structured.ingredients, steps: material.structured.steps, pageText: null }
          : { title: suggestion.title, origin: suggestion.origin, ingredients: [], steps: [], pageText: material.text };

      const started = Date.now();
      let rewritten: RecipeRewrite;
      try {
        const output = await this.rewriter.rewrite(rewriteInput, await this.settings.suggestionModel());
        await this.logCall(output, true, Date.now() - started, this.rewriter.name);
        rewritten = output.recipe;
      } catch (error) {
        await this.logFailure(error, Date.now() - started, this.rewriter.name);
        // Gemini a répondu mais le contenu est inexploitable (JSON illisible,
        // hors schéma) : distinct d'un fournisseur ou d'un transport en échec
        // (revue de tâche 9, round 2) — les deux se confondaient derrière le
        // même code d'erreur.
        if (error instanceof InvalidRewriteError) throw ApiError.providerInvalidResponse(error.message);
        const message = error instanceof ProviderError ? error.message : 'Fournisseur de suggestions injoignable';
        throw ApiError.providerUnavailable(message);
      }
      title = rewritten.title;
      steps = rewritten.steps;
      rawIngredients = rewritten.ingredients;
    }

    const ingredients = await this.attachProducts(rawIngredients);
    // Les durées annoncées par le modèle restent crédibles (seule la difficulté
    // est recalculée au barème du foyer, B15). `prepMinutes`/`cookMinutes`
    // viennent de la suggestion d'origine, jamais de la réécriture (tâche 9,
    // B6) : celle-ci ne porte que titre, étapes et ingrédients.
    //
    // `prepMinutes`/`cookMinutes` sont `nullable` au schéma (fixture
    // `gemini-batch-absent.json`) : avant la ventilation prep/cuisson,
    // `prepMinutes` recevait `suggestion.totalMinutes`, qui lui reste
    // obligatoire et positif. Sans repli ici, une suggestion sans détail
    // perdrait silencieusement toute durée en arrivant dans « Mes recettes »
    // (carte, filtre « temps maximum », difficulté recalculée un cran trop
    // bas — `difficulty.ts` lit `prepMinutes ?? 0`) alors que la fournée
    // portait bien une durée totale.
    const hasDetailedDuration = suggestion.prepMinutes !== null || suggestion.cookMinutes !== null;
    const draft = {
      title,
      servings: 4,
      steps,
      diets: [],
      prepMinutes: hasDetailedDuration ? suggestion.prepMinutes : suggestion.totalMinutes,
      cookMinutes: hasDetailedDuration ? suggestion.cookMinutes : null,
      // Le classement du modèle suit la recette conservée : « Mes recettes »
      // filtre sur le même vocabulaire, une suggestion gardée n'a pas à être
      // reclassée à la main (demande du 2026-10-08).
      dishType: suggestion.dishType,
      ingredients,
      // `difficulty` délibérément omis : `RecipesService.create` la calcule via
      // `computeDifficulty`, jamais recopiée ici (B15, règle métier partagée).
    };
    const parsed = createRecipeSchema.safeParse(draft);
    if (!parsed.success) throw ApiError.providerInvalidResponse('Réponse de réécriture non exploitable pour créer la recette', parsed.error.issues);
    return parsed.data;
  }

  /**
   * Récupère la page de la recette en sécurité (vigilance « the application
   * never sends him to the website ») : lue structurée si `schema.org/Recipe`
   * est présent, sinon son texte nettoyé — un seul GET pour les deux lectures
   * (revue de tâche 9). Un refus de sécurité (HTTPS, adresse privée) arrête
   * tout de suite, sans jamais tenter la suite. Une page qui ne répond pas
   * échoue en français, sans créer de recette.
   */
  private async fetchWebRecipeMaterial(url: string): Promise<{ structured: PageRecipe | null; text: string }> {
    let content: { structured: PageRecipe | null; text: string } | null;
    try {
      content = await this.pageFetcher.fetchContent(url);
    } catch (error) {
      if (error instanceof RecipePageRefusedError) {
        throw ApiError.businessRule(`La page de la recette ne peut pas être récupérée : ${error.message}`);
      }
      throw error;
    }
    if (!content) throw ApiError.providerUnavailable('La page de la recette n’a pas répondu ; aucune recette n’a été créée');
    if (!content.structured && content.text.length === 0) {
      throw ApiError.providerUnavailable('La page de la recette n’a pas répondu ; aucune recette n’a été créée');
    }
    return content;
  }

  /** Rattache chaque ingrédient à un produit rapproché (sûr ou probable, A11) ; les autres restent en texte libre. */
  private async attachProducts(
    ingredients: readonly { label: string; quantity: number | null; unit: Unit | null }[],
  ): Promise<CreateRecipeInput['ingredients']> {
    const matchesByLabel = await this.matchLabels(ingredients.map((i) => i.label));
    return ingredients.map((ingredient) => {
      const match = classifyMatch(ingredient.label, matchesByLabel.get(ingredient.label.trim()) ?? []);
      return {
        label: ingredient.label,
        productId: match.productId,
        categoryId: null,
        quantity: ingredient.quantity,
        // Une unité sans quantité chiffrée violerait `recipeIngredientInputSchema` (quantité ↔ unité) : alignée ici.
        unit: ingredient.quantity === null ? null : ingredient.unit,
        essential: false,
        substitutable: false,
      };
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
