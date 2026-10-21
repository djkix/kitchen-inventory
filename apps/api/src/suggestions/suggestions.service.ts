import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  classifyMatch,
  comparePoolEntries,
  createRecipeSchema,
  pickSeedIngredients,
  normalizeProductName,
  normalizeIngredientTerms,
  labelMatchesTerms,
  recipeCoverage,
  SUGGESTION_PAGE_SIZE,
  SUGGESTION_REGION_LABELS_FR,
  suggestionIdentity,
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
  type SuggestionRegion,
  type Unit,
  type VoiceSuggestionBatchDto,
  voiceAudioRejection,
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
import { withQuotaFallback } from '../recognition/providers/gemini.provider.js';
import { GeminiSuggestionProvider } from './gemini-suggestion.provider.js';
import { SuggestionPoolService, type PoolFilter, type PoolRecipe } from './suggestion-pool.service.js';
import {
  RECIPE_REWRITER,
  SuggestionProviderError,
  type SuggestionAttempt,
  type SuggestionOutput,
  type SuggestionRequest,
  type VoiceSuggestionOutput,
} from './suggestion-provider.js';

/**
 * Nombre de recettes rendues à l'écran en une fois (section 5.1, B8), et base
 * du nombre demandé au modèle.
 *
 * C'était la taille de la fournée, et la fournée était l'écran. Depuis que
 * l'écran est servi par un réservoir permanent (D8), plus rien ne bornait la
 * réponse : au bout de quelques semaines, une visite rendait tout le réservoir
 * — et payait un rapprochement `pg_trgm` par libellé d'ingrédient de chaque
 * recette (revue finale du 2026-10-15). C'est désormais la borne de la page
 * rendue, appliquée APRÈS le tri de `comparePoolEntries` : les meilleures en
 * tête, c'est tout l'objet de ce tri.
 */
export const SUGGESTION_BATCH_SIZE = SUGGESTION_PAGE_SIZE;
/**
 * Marge demandée au fournisseur au-delà de la page rendue (voir « Vigilance 2 »
 * du rapport de tâche 5) : `GeminiSuggestionProvider.suggest()` tronque à
 * `count` dans l'ordre brut du modèle, et si celui-ci plaçait toutes ses
 * recettes web avant les composées, une demande strictement égale à la page
 * rendue effacerait la part composée. En demander quelques-unes de plus borne
 * ce risque. Tout ce qui revient entre au réservoir : ce lot ne jette plus
 * rien de ce qui a été payé (« pas d'âge max, tu logges tout »).
 */
export const SUGGESTION_REQUEST_BUFFER = 4;

/**
 * Nombre de lignes du réservoir sur lesquelles la couverture est réellement
 * calculée avant tri (revue finale du 2026-10-15).
 *
 * Dépendance à résoudre : `comparePoolEntries` trie entre autres sur la
 * couverture, qui n'est connue qu'après `toSuggestionDtos` — c'est-à-dire
 * après la requête `word_similarity` sur tout le catalogue `Product` pour
 * chaque libellé d'ingrédient. La calculer sur un réservoir de plusieurs
 * centaines de recettes à chaque visite est exactement le défaut relevé. Elle
 * se résout en deux temps : d'abord une présélection sur la part de l'ordre
 * qui **ne dépend pas du stock** (recettes vérifiées d'abord, puis les plus
 * récemment découvertes — l'ordre que `pool.read` rend déjà), puis couverture
 * et tri complet sur cette seule fenêtre.
 *
 * Plafond assumé : une recette plus ancienne que la fenêtre ne peut plus
 * remonter sur sa seule couverture. Trois fois la page rendue laisse de quoi
 * départager ; aller plus loin demanderait de porter la couverture en base.
 *
 * C'est un facteur, pas un nombre fixe (2026-10-19) : la page est désormais
 * demandée par le client (« Charger plus »), et une fenêtre figée sur la page
 * par défaut couperait avant la page demandée — les recettes au-delà ne
 * seraient alors ni classées ni rendues, ce que le réservoir promet
 * exactement l'inverse. `SUGGESTION_PAGE_MAX` borne l'ensemble.
 */
const SUGGESTION_RANKING_WINDOW_FACTOR = 3;

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
 * 2026-10-15 avec le retrait des graines, et à `v5` le 2026-10-19 avec les
 * ingrédients dictés (D3) : sans ce changement de version, les lignes écrites
 * avant seraient relues comme des orientations qu'elles ne désignent pas.
 */
const SUGGESTION_SIGNATURE_VERSION = 'v5';

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
 * Présélection avant calcul de la couverture (voir `SUGGESTION_RANKING_WINDOW_FACTOR`) :
 * la part de l'ordre de `comparePoolEntries` qui ne dépend pas du stock —
 * vérifiées d'abord (D5), chaque groupe gardant l'ordre de première apparition
 * décroissant rendu par `pool.read`.
 */
function rankingWindow(entries: readonly PoolRecipe[], pageSize: number): PoolRecipe[] {
  const size = SUGGESTION_RANKING_WINDOW_FACTOR * pageSize;
  if (entries.length <= size) return [...entries];
  return [...entries.filter((entry) => entry.verified), ...entries.filter((entry) => !entry.verified)].slice(0, size);
}

/** Orientation demandée, telle que le réservoir la filtre (D6). */
function orientationFilter(query: SuggestionQuery): PoolFilter {
  return {
    dishType: query.dishType,
    region: query.region,
    maxMinutes: query.maxMinutes,
    difficulty: query.difficulty,
    // Les ingrédients dictés sont une orientation comme les autres (D2) : le
    // réservoir est lu filtré sur eux, et le modèle n'est appelé que si ce
    // réservoir filtré reste sous le plancher de six.
    ingredients: query.ingredients?.terms,
  };
}

function computeSignature(query: SuggestionQuery): string {
  const payload = JSON.stringify({
    region: query.region ?? null,
    maxMinutes: query.maxMinutes ?? null,
    difficulty: query.difficulty ?? null,
    dishType: query.dishType ?? null,
    // Normalisés et TRIÉS par le schéma partagé (D3) : sans le tri, « merguez,
    // pommes de terre » et « pommes de terre, merguez » seraient deux
    // orientations distinctes ; sans leur présence ici, deux combinaisons
    // différentes partageraient le verrou de 24 h et la seconde se verrait
    // refuser son appel à cause de la première.
    ingredients: query.ingredients?.terms ?? [],
    version: SUGGESTION_SIGNATURE_VERSION,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * « 16/10 à 08:15 », en heure locale du serveur. Formaté à la main plutôt que
 * par `toLocaleString` : le message doit être le même quelle que soit la locale
 * de l'hôte, et une dépendance à ICU n'a pas sa place dans une phrase de six
 * mots.
 */
function formatDeadline(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} à ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    @Inject(RECIPE_REWRITER) private readonly rewriter: GeminiRecipeRewriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Suggestions servies du réservoir, couverture recalculée contre le stock du
   * moment (EF-25, EF-26). La liste ne porte rien au nom de l'utilisateur : la
   * recherche est celle du foyer, pas une personnalisation.
   */
  async list(query: SuggestionQuery): Promise<SuggestionBatchDto> {
    // Vérifié avant toute lecture du stock : inutile de composer une requête
    // si le fournisseur ne pourra de toute façon pas répondre. Garde partagée
    // avec `RecognitionService.recognizeImage` (`assertProviderEnabled`).
    assertProviderEnabled(this.provider, 'suggestions');
    // Page demandée par l'écran, bornée au schéma partagé. Elle ne change que
    // ce qui est rendu : ni le plancher du réservoir, ni le nombre de recettes
    // demandées au modèle n'en dépendent.
    const pageSize = query.limit ?? SUGGESTION_PAGE_SIZE;
    // Une seule lecture de l'arbre des catégories, partagée par l'instantané de
    // stock et par les candidats de départ (revue de tâche 6 : `snapshot()` et
    // `loadSeedCandidates` interrogeaient chacun la table `Category`).
    const categories = await loadCategoryRows(this.prisma);
    const snapshot = await this.coverage.snapshot(new Date(), categories);

    const signature = computeSignature(query);
    // Le réservoir d'abord, toujours (D6) : le modèle n'est appelé que s'il ne
    // rend pas de quoi remplir l'écran pour l'orientation demandée, ou si la
    // relance explicite le réclame. Sur relance, cette lecture serait jetée
    // telle quelle : elle n'est pas faite (revue de la tâche 4).
    let entries = query.refresh ? [] : await this.readPool(query);
    let fromCache = true;
    let notice: string | null = null;
    /**
     * Identités rapportées par l'appel au modèle de CETTE requête (2026-10-19).
     * Elles passent en tête de l'affichage : sans cela, une nouveauté moins
     * bien couverte qu'une ancienne restait invisible et la relance explicite
     * rendait exactement la même page. Rien n'est persisté — la requête
     * suivante repart d'un ensemble vide et l'ordre normal reprend.
     */
    let fresh: ReadonlySet<string> = new Set();

    // Sous le plancher mais déjà demandée aujourd'hui : on sert ce que le
    // réservoir a, même maigre (D11). Un palier étroit — « ≤ 15 min » — laisse
    // sinon le réservoir sous le plancher à chaque visite et rappelle le modèle
    // à chaque fois, jusqu'à manger le plafond mensuel partagé avec le scan.
    // Lecture évitée quand le réservoir suffit ou que la relance est explicite :
    // il n'y a alors rien à verrouiller.
    const askedAt = query.refresh || entries.length >= SUGGESTION_POOL_FLOOR ? null : await this.lastAskedAt(signature);
    const mustAsk = query.refresh || (entries.length < SUGGESTION_POOL_FLOOR && askedAt === null);

    // Le prix de D11, dit à l'écran : une orientation que le modèle n'a jamais
    // su satisfaire reste vide jusqu'au bout des 24 heures. Sans ce message,
    // l'utilisateur voyait un écran vide sans la moindre cause (revue de la
    // tâche 4, tour 2) — et la seule sortie, la relance explicite, ne se
    // devine pas.
    if (!mustAsk && askedAt !== null && entries.length === 0) {
      notice =
        `Aucune recette pour cette orientation ; elle a déjà été cherchée récemment, et une nouvelle recherche ne partira pas d’elle-même avant le ${formatDeadline(new Date(askedAt.getTime() + SAME_ORIENTATION_TTL_MS))}. ` +
        'Changez d’orientation, ou relancez la recherche vous-même.';
    }

    if (mustAsk) {
      // Les graines ne servent plus qu'à composer la question posée au modèle
      // (D11) : elles ne sont donc calculées que lorsqu'une question part, et
      // non plus à chaque visite.
      const seeds = pickSeedIngredients(await loadSeedCandidates(this.prisma, snapshot, categories), new Date());
      if (seeds.length === 0) {
        // Un placard momentanément vide ne doit plus masquer le réservoir
        // (revue finale du 2026-10-15) : le lot promet que les recettes
        // trouvées restent disponibles, et leur couverture nulle est
        // justement l'information utile. L'erreur n'est levée que si le
        // réservoir ne rend rien non plus — sur relance explicite, il n'a
        // pas encore été lu.
        if (query.refresh) entries = await this.readPool(query);
        if (entries.length === 0) {
          throw ApiError.insufficientStock('Le stock ne contient pas assez d’ingrédients pour composer une recherche de recettes');
        }
        return this.render(entries, snapshot, true, notice, fresh, pageSize, query.ingredients?.terms ?? []);
      }
      const breach = await this.quotaBreach();
      if (breach) {
        // Repli : le réservoir entier, sans filtre d'orientation (D8) — mieux
        // vaut des recettes hors orientation qu'un écran vide, à condition de
        // le dire (`quotaMessage`).
        const fallback = await this.readPool({ refresh: false });
        if (fallback.length === 0) throw ApiError.rateLimited(this.quotaMessage(breach, false));
        entries = fallback;
        // Le repli lit le réservoir sans AUCUN filtre : ni orientation, ni
        // ingrédients dictés. Le dire (tour de correction 1) — sinon djkix
        // reçoit des recettes sans rapport avec ce qu'il vient de taper, et
        // seul le quota lui est expliqué.
        notice = this.quotaMessage(breach, true, (query.ingredients?.terms.length ?? 0) > 0);
      } else {
        // Titres déjà connus pour cette orientation, cités au modèle pour
        // qu'il ne les repropose pas. Sur relance, `entries` est vide par
        // construction (la lecture a été sautée) : il faut donc relire.
        const known = query.refresh ? await this.pool.read(orientationFilter(query)) : entries;
        const fetched = await this.fetchAndStore(signature, seeds, query, known.map((entry) => entry.recipe.title));
        fresh = new Set(await this.pool.ingest(fetched.recipes, fetched.model));
        // Relecture obligatoire, jamais la réponse brute du modèle : une recette
        // web dont la page n'existe pas a été jetée à l'ingestion (D4) et ne
        // doit à aucun moment atteindre l'écran.
        entries = await this.readPool(query);
        fromCache = false;
      }
    }

    return this.render(entries, snapshot, fromCache, notice, fresh, pageSize, query.ingredients?.terms ?? []);
  }

  /**
   * Demande parlée (spécification du 2026-10-21) : djkix appuie sur un
   * bouton, dit ce qu'il lui reste et ce qu'il veut manger, et reçoit des
   * recettes croisées avec son stock réel.
   *
   * Ce qui se joue ici, dans l'ordre :
   *
   * - **D8** : les bornes de l'enregistrement sont revérifiées côté serveur,
   *   avec la règle partagée — l'écran les applique déjà, mais un client
   *   n'est jamais une garantie ;
   * - **D5** : le réservoir n'est pas lu d'abord (une phrase est unique, il
   *   n'y a rien à y retrouver), l'appel consomme le quota journalier et
   *   entre dans le plafond mensuel comme une relance, et les recettes
   *   rendues entrent au réservoir — rien de payé n'est jeté ;
   * - **D4** : les ingrédients entendus sont traités comme **déclarés** au
   *   sens du 2026-10-19 (D5) — jamais annoncés comme manquants, la
   *   couverture restant calculée sur le seul stock ;
   * - **D6** : l'audio traverse cette méthode et disparaît. Rien n'en est
   *   écrit : `RecognitionLog.rawResult` ne reçoit que la réponse du modèle.
   *
   * Contrairement à `list`, un placard vide n'est pas une erreur : la parole
   * porte déjà ses ingrédients, le stock ne sert qu'à compléter.
   */
  async listFromVoice(audio: Buffer, mimeType: string): Promise<VoiceSuggestionBatchDto> {
    assertProviderEnabled(this.provider, 'suggestions');
    // Règle partagée avec l'écran (`voiceAudioRejection`) : même refus, même
    // phrase, une seule implémentation.
    const rejection = voiceAudioRejection(audio.byteLength, mimeType);
    if (rejection) throw new ApiError(400, 'validation_failed', rejection);

    // Vérifié avant d'envoyer quoi que ce soit : un quota atteint ne doit pas
    // faire monter un enregistrement vers le modèle. Pas de repli au
    // réservoir non plus — une phrase n'a pas d'orientation de rechange, et
    // servir des recettes sans rapport avec ce qui vient d'être dit serait
    // plus déroutant qu'un refus clair.
    const breach = await this.quotaBreach();
    if (breach) throw ApiError.rateLimited(this.quotaMessage(breach, false));

    const categories = await loadCategoryRows(this.prisma);
    const snapshot = await this.coverage.snapshot(new Date(), categories);
    const seeds = pickSeedIngredients(await loadSeedCandidates(this.prisma, snapshot, categories), new Date());

    const started = Date.now();
    let output: VoiceSuggestionOutput;
    try {
      const settings = await this.settings.get();
      // Même repli que le scan : le quota se compte par modèle, donc basculer
      // rouvre un réservoir intact. Une seule reprise, jamais une cascade.
      ({ result: output } = await withQuotaFallback(settings.suggestionModel, settings.fallbackModel, (model) =>
        this.provider.suggestFromVoice({
          seeds: seeds.map((s) => s.name),
          count: SUGGESTION_BATCH_SIZE + SUGGESTION_REQUEST_BUFFER,
          audio,
          mimeType,
          model,
          webSearch: settings.suggestionWebSearch,
        }),
      ));
    } catch (error) {
      if (error instanceof SuggestionProviderError) await this.logAttempts(error.attempts, false);
      else await this.logFailure(error, Date.now() - started);
      throw ApiError.providerUnavailable(error instanceof ProviderError ? error.message : 'Fournisseur de suggestions injoignable');
    }
    await this.logAttempts(output.attempts, true);

    // Avant tout verdict sur la lecture : l'appel est payé, ses recettes
    // entrent au réservoir même si la phrase n'a pas été comprise (D5).
    const identities = new Set(output.recipes.map((recipe) => suggestionIdentity(recipe)));
    await this.pool.ingest(output.recipes, output.model);

    if (output.heard.ingredients.length === 0 && output.heard.orientation === null) {
      // D9 : un refus se dit. Le modèle a répondu, mais n'a rien tiré de
      // l'enregistrement — ce n'est ni une panne ni un quota.
      throw ApiError.businessRule(
        'Votre demande n’a pas été comprise : aucun ingrédient ni aucune envie n’a été reconnu dans l’enregistrement. Réessayez en parlant plus près du micro.',
      );
    }

    // Relu au réservoir, jamais servi depuis la réponse brute : une recette
    // web dont la page n'a pas pu être lue a été jetée à l'ingestion (D4 du
    // 2026-10-15) et ne doit à aucun moment atteindre l'écran.
    const entries = (await Promise.all([...identities].map((identity) => this.pool.findByIdentity(identity)))).filter(
      (entry): entry is PoolRecipe => entry !== null,
    );
    // Les ingrédients entendus deviennent les « dictés » du 2026-10-19 : le
    // mécanisme de D5 est réutilisé tel quel, jamais réécrit.
    const dictated = normalizeIngredientTerms(output.heard.ingredients.join(', '));
    const batch = await this.render(entries, snapshot, false, null, identities, SUGGESTION_PAGE_SIZE, dictated);
    return { ...batch, heard: output.heard };
  }

  /**
   * Couverture, ordre (D7) et borne de la page rendue, dans cet ordre
   * d'opérations — qui est tout le sujet (revue finale du 2026-10-15) :
   *
   * 1. `rankingWindow` présélectionne sur la part de l'ordre indépendante du
   *    stock, pour que l'étape suivante ne travaille jamais sur tout le
   *    réservoir ;
   * 2. `toSuggestionDtos` calcule le rapprochement et la couverture **de cette
   *    fenêtre seule** — le tri en a besoin, il ne peut donc pas venir avant ;
   * 3. `comparePoolEntries`, la règle pure partagée, ordonne ; jamais réécrite
   *    ici ;
   * 4. la page est bornée après le tri, donc aux meilleures.
   *
   * `pageSize` vient de la requête (« Charger plus », 2026-10-19), borné par
   * `SUGGESTION_PAGE_MAX` au schéma partagé. Il traverse les deux étapes 1 et
   * 4 : borner la page sans élargir la fenêtre rendrait la page demandée
   * impossible à remplir au-delà de la fenêtre par défaut.
   */
  private async render(
    entries: readonly PoolRecipe[],
    snapshot: StockSnapshot,
    fromCache: boolean,
    notice: string | null,
    fresh: ReadonlySet<string>,
    pageSize: number,
    dictated: readonly string[],
  ): Promise<SuggestionBatchDto> {
    // Compté avant la fenêtre de classement et la page : c'est le réservoir
    // réel pour cette orientation, pas ce qu'on en montre.
    const poolCount = entries.length;
    const poolTotal = await this.pool.count();
    // Les recettes rapportées à l'instant entrent dans la fenêtre sans
    // condition : les faire passer par `rankingWindow` les exposerait à être
    // coupées par les anciennes, ce qui annulerait la relance.
    const window =
      fresh.size === 0
        ? rankingWindow(entries, pageSize)
        : [...entries.filter((e) => fresh.has(e.identity)), ...rankingWindow(entries.filter((e) => !fresh.has(e.identity)), pageSize)];
    const items = await this.toSuggestionDtos(window, snapshot, dictated);
    const firstSeenById = new Map(window.map((entry) => [entry.identity, entry.firstSeenAt]));
    const key = (dto: SuggestionDto): Parameters<typeof comparePoolEntries>[0] => ({
      verified: dto.verified,
      coverage: dto.coverage,
      firstSeenAt: firstSeenById.get(dto.id) ?? '',
      title: dto.title,
      identity: dto.id,
      fresh: fresh.has(dto.id),
    });
    items.sort((a, b) => comparePoolEntries(key(a), key(b)));

    return {
      fromCache,
      items: items.slice(0, pageSize),
      notice,
      poolCount,
      poolTotal,
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
      this.pool.read(orientationFilter(query)),
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
   * Quand cette orientation a-t-elle été posée au modèle, si c'était il y a
   * moins de `SAME_ORIENTATION_TTL_MS` (D11) ? `null` sinon. Lu sur la
   * `SuggestionBatch` de même signature, dont l'`upsert` rafraîchit déjà
   * `createdAt` : ni colonne ni migration pour une question à laquelle la
   * table répondait déjà. La date est rendue, et pas seulement un booléen,
   * pour que le message d'écran puisse dire jusqu'à quand le verrou tient.
   */
  private async lastAskedAt(signature: string): Promise<Date | null> {
    const row = await this.prisma.suggestionBatch.findUnique({ where: { signature }, select: { createdAt: true } });
    if (!row) return null;
    return Date.now() - row.createdAt.getTime() < SAME_ORIENTATION_TTL_MS ? row.createdAt : null;
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
  private quotaMessage(breach: { kind: 'daily' | 'monthly' }, hasPoolEntries: boolean, droppedIngredients = false): string {
    // Les ingrédients dictés tombent avec l'orientation : la phrase le dit,
    // faute de quoi l'écran afficherait des recettes sans merguez sous une
    // demande de merguez, sans que rien ne l'explique (tour 1).
    const dropped = droppedIngredients ? ' Les ingrédients demandés ne sont pas pris en compte dans cette liste.' : '';
    if (breach.kind === 'daily') {
      const dailyQuota = this.config.RECIPE_SUGGESTION_DAILY_QUOTA;
      return hasPoolEntries
        ? `Quota journalier de suggestions atteint (${dailyQuota} par jour) ; les recettes déjà connues sont affichées, toutes orientations confondues.${dropped}`
        : `Quota journalier de suggestions atteint (${dailyQuota} par jour) ; réessayez demain, ou augmentez-le dans la configuration du serveur.`;
    }
    return hasPoolEntries
      ? `Plafond de dépense mensuel atteint ; les recettes déjà connues sont affichées, toutes orientations confondues.${dropped}`
      : 'Plafond de dépense mensuel atteint ; réessayez le mois prochain, ou augmentez-le dans la configuration du serveur.';
  }

  /**
   * Appelle le modèle et marque l'orientation comme demandée dans
   * `SuggestionBatch` (D2 amendée par D11). Personne ne relit cette ligne pour
   * servir une réponse (D8) : elle ne dit plus que « cette question a été
   * posée, à telle date, pour tel coût » — d'où la disparition de sa colonne
   * `payload` (migration 0010). Le journal brut par appel, c'est
   * `RecognitionLog.rawResult` qui le tient ; les recettes, c'est le
   * réservoir. Les recettes rendues partent ensuite à l'ingestion.
   */
  private async fetchAndStore(
    signature: string,
    seeds: readonly { productId: string; name: string }[],
    query: SuggestionQuery,
    knownTitles: readonly string[],
  ): Promise<{ recipes: ModelRecipe[]; model: string }> {
    const request: SuggestionRequest = {
      seeds: seeds.map((s) => s.name),
      region: query.region,
      maxMinutes: query.maxMinutes,
      difficulty: query.difficulty,
      dishType: query.dishType,
      count: SUGGESTION_BATCH_SIZE + SUGGESTION_REQUEST_BUFFER,
      knownTitles,
      // Imposés au modèle (D1), en plus des graines tirées du stock (D4) : le
      // prompt distingue les deux, l'un s'ajoute à l'autre.
      ingredients: query.ingredients,
    };

    const started = Date.now();
    let output: SuggestionOutput;
    try {
      // Modèle relu à chaque fournée : un changement dans les réglages vaut
      // immédiatement, sans redémarrage du conteneur.
      const settings = await this.settings.get();
      ({ result: output } = await withQuotaFallback(settings.suggestionModel, settings.fallbackModel, (model) =>
        this.provider.suggest({ ...request, model, webSearch: settings.suggestionWebSearch }),
      ));
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

    // Tout ce que le modèle a rendu, et pas seulement de quoi remplir un
    // écran : seize recettes sont demandées et facturées, les seize entrent au
    // réservoir. Le `rebalance` qui en jetait quatre datait du temps où la
    // fournée ÉTAIT l'écran ; l'ordre d'affichage vient désormais de
    // `comparePoolEntries` à la lecture, et « pas d'âge max, tu logges tout »
    // interdit de jeter du contenu payé (revue finale du 2026-10-15).
    const recipes = output.recipes;
    const costCents = totalCostCents(output.attempts);
    await this.prisma.suggestionBatch.upsert({
      where: { signature },
      create: { signature, model: output.model, costCents },
      update: { model: output.model, costCents, createdAt: new Date() },
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
  private async toSuggestionDtos(entries: readonly PoolRecipe[], snapshot: StockSnapshot, dictated: readonly string[]): Promise<SuggestionDto[]> {
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
      /**
       * D5 — un ingrédient que l'on vient de taper n'est jamais annoncé comme
       * manquant : « il vous manque : merguez » juste après l'avoir déclaré
       * serait absurde. Il est retiré des manquants ici, et marqué `declared`
       * plus bas pour que le tiroir cesse de l'afficher « Manquant » (tour de
       * correction 1).
       *
       * Ce n'est PAS un bug que le taux de couverture n'en tienne pas compte :
       * la règle partagée ne connaît que le stock et n'est pas touchée. Une
       * recette peut donc afficher « 3 sur 4 » sans lister le moindre manquant
       * — c'est voulu. Un chiffre prudent, calculé sur ce que le placard
       * contient réellement, vaut mieux qu'un chiffre gonflé par une
       * déclaration invérifiable.
       */
      const missingLabels = coverage.missingIds.map((id) => labelById.get(id) ?? id).filter((label) => !labelMatchesTerms(label, dictated));

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
          // Déclaré à l'instant par djkix (D5) : `state` continue de dire ce
          // que le stock sait, l'écran dit ce qu'il a sous la main.
          declared: labelMatchesTerms(ingredient.label, dictated),
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
   * Conservation d'une suggestion (EF-25, EF-26, D9, D10) : « l'application
   * n'envoie jamais djkix vers le site » — et depuis le réservoir, elle ne
   * rappelle plus le site elle-même. La recette est cherchée **par son
   * identité au réservoir** (`SuggestionPoolRecipe.identity`, unique), jamais
   * dans une fournée : l'écran sert du réservoir depuis la tâche 4, la
   * dernière `SuggestionBatch` ne contient donc plus forcément ce qu'il
   * affiche. `batchId` reste accepté dans l'entrée, et ignoré.
   *
   * Le contenu de la page a été recopié une fois pour toutes à l'ingestion
   * (D10) : la conservation d'une recette web ne fait aucune requête réseau,
   * et aucun appel au modèle quand la page portait `schema.org/Recipe`.
   *
   * Idempotente par `clientOpId` (section 8, migration 0006) sur
   * `Recipe.clientOpId` : vérifié ici en tout premier, avant toute dépense —
   * un rejeu ne doit payer pour rien (revue de tâche 9, round 2).
   * `RecipesService.createFromSuggestion` garde son propre contrôle juste
   * avant l'écriture, pour la course concurrente que cette vérification
   * préalable laisse passer ; ce n'est qu'un filet, pas le chemin normal.
   */
  async keep(input: KeepSuggestionInput, user: RequestUser): Promise<RecipeDto> {
    if (input.clientOpId) {
      const existing = await this.recipes.findByClientOpId(input.clientOpId);
      if (existing) return existing;
    }

    const entry = await this.pool.findByIdentity(input.suggestionId);
    if (!entry) throw ApiError.notFound('Suggestion introuvable');
    const suggestion = entry.recipe;

    const createInput = await this.buildCreateInput(entry);
    const source = suggestion.provenance === 'web' ? 'IMPORTED' : 'GENERATED';
    const sourceUrl = suggestion.provenance === 'web' ? suggestion.sourceUrl : null;
    return this.recipes.createFromSuggestion(createInput, source, sourceUrl, input.clientOpId ?? null, user.id);
  }

  /**
   * Matière de la recette à créer, prise dans la ligne du réservoir [B6, D10].
   *
   * - `ai` : la composition est déjà au bon format, aucun appel — ses étapes
   *   SONT la recette.
   * - `web` : réécriture par le modèle, **toujours**, à partir du contenu déjà
   *   recopié en base — les données structurées quand la page en portait
   *   (meilleure matière), le texte nettoyé sinon.
   *
   * Le lecteur de page n'est appelé nulle part ici : la page a été lue une
   * seule fois, à l'ingestion au réservoir, et le site n'est plus jamais
   * contacté (D10) — c'est cela que D10 exige, pas l'économie d'un appel.
   *
   * La réécriture n'a volontairement pas été court-circuitée quand la page
   * portait `schema.org/Recipe` (tour de correction 1 du 2026-10-15) :
   * `PageRecipe.ingredients` est un `string[]` (« 2 cuillères de sucre »),
   * sans `quantity` ni `unit` séparés. Or le rapprochement au stock, la
   * couverture et le « 3 ingrédients sur 4 » — la raison d'être de
   * l'application — travaillent sur ces deux champs. Échanger la qualité du
   * rapprochement contre une économie d'appel sur un geste rare et délibéré
   * (on conserve une recette une fois, pas à chaque affichage) serait un
   * mauvais marché.
   */
  private async buildCreateInput(entry: PoolRecipe): Promise<CreateRecipeInput> {
    const suggestion = entry.recipe;
    let title = suggestion.title;
    let steps: string[];
    let rawIngredients: { label: string; quantity: number | null; unit: Unit | null }[];

    if (suggestion.provenance === 'ai') {
      steps = suggestion.steps;
      rawIngredients = suggestion.ingredients;
    } else {
      const structured = entry.pageRecipe;
      const pageText = entry.pageText;
      // Une ligne web sans contenu recopié ne peut pas exister : l'ingestion
      // rejette une recette web dont la page n'a pas été lue (D4). Refusé tout
      // de même, plutôt que de créer une recette vide.
      if (!structured && !pageText) throw ApiError.providerUnavailable('Le contenu de la page n’a pas été conservé ; aucune recette n’a été créée');

      assertProviderEnabled(this.rewriter, 'suggestions');
      // La réécriture est un appel au même modèle que la recherche de fournée
      // (revue de tâche 9) : comptée dans le même quota journalier et le même
      // plafond mensuel, vérifié avant de dépenser quoi que ce soit.
      // Pas de fournée de repli ici : une réécriture n'en sert jamais une, le
      // message ne doit donc jamais prétendre en afficher une.
      const breach = await this.quotaBreach();
      if (breach) throw ApiError.rateLimited(this.quotaMessage(breach, false));

      // Matière prise au réservoir, jamais au site : données structurées quand
      // la page en portait, texte nettoyé sinon — exactement les deux formes
      // que `RecipeRewriteInput` distingue déjà.
      const rewriteInput: RecipeRewriteInput = structured
        ? { title: suggestion.title, origin: suggestion.origin, ingredients: structured.ingredients, steps: structured.steps, pageText: null }
        : { title: suggestion.title, origin: suggestion.origin, ingredients: [], steps: [], pageText };

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
      // La région de la suggestion devient la cuisine de la recette conservée
      // (choix de djkix, 2026-10-19). Jusqu'ici une recette conservée
      // n'arrivait avec aucune cuisine : le sélecteur « Cuisine » de « Mes
      // recettes », qui liste les lignes de `Cuisine`, ne pouvait donc
      // correspondre à aucune d'elles — un filtre qui ne filtrait rien. Les
      // deux écrans partagent désormais le même vocabulaire à sept valeurs.
      cuisineId: await this.regionCuisineId(suggestion.region),
      ingredients,
      // `difficulty` délibérément omis : `RecipesService.create` la calcule via
      // `computeDifficulty`, jamais recopiée ici (B15, règle métier partagée).
    };
    const parsed = createRecipeSchema.safeParse(draft);
    if (!parsed.success) throw ApiError.providerInvalidResponse('Réponse de réécriture non exploitable pour créer la recette', parsed.error.issues);
    return parsed.data;
  }

  /**
   * Ligne `Cuisine` portant le libellé de la région, créée à la première
   * recette conservée de cette région.
   *
   * On réutilise la table existante plutôt que d'ajouter une colonne à
   * `Recipe` : pas de migration, et le sélecteur de « Mes recettes » se
   * remplit tout seul puisqu'il liste déjà ces lignes. Le prix assumé est que
   * « Européenne » (une région) y côtoiera une « Italienne » saisie à la main
   * (une cuisine), deux notions que le modèle distingue par ailleurs.
   *
   * `region` est conservée en plus du nom : c'est elle qui relie la ligne au
   * vocabulaire partagé, le libellé n'étant que son affichage.
   */
  private async regionCuisineId(region: SuggestionRegion): Promise<string> {
    const name = SUGGESTION_REGION_LABELS_FR[region];
    const normalizedName = normalizeProductName(name);
    // `upsert` et non « chercher puis créer » : deux conservations simultanées
    // de la même région courraient sinon vers la même contrainte d'unicité.
    const row = await this.prisma.cuisine.upsert({
      where: { normalizedName },
      create: { name, normalizedName, region },
      update: {},
      select: { id: true },
    });
    return row.id;
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
