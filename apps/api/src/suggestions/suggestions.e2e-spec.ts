import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DynamicModule, Global, Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  DISH_TYPES,
  normalizeIngredientTerms,
  SUGGESTION_REGION_LABELS_FR,
  suggestionIdentity,
  VOICE_MAX_BYTES,
  VOICE_MIN_BYTES,
  type ModelRecipe,
  type SuggestionQuery,
} from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import { LoggerModule } from 'nestjs-pino';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../common/config.module.js';
import { loadConfig, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { GeminiModule } from '../gemini/gemini.module.js';
import { GeminiService } from '../gemini/gemini.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import type { RequestUser } from '../auth/request-user.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { createProduct, createStock } from '../../test/recipes.test-helpers.js';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { truncateAll } from '../../test/db.js';
import type { PageRecipe } from './recipe-page.fetcher.js';
import { PRICES_USD_PER_MTOK } from '../recognition/providers/gemini.provider.js';
import { buildSuggestionPrompt } from './prompt.js';
import { SuggestionsModule } from './suggestions.module.js';
import { SuggestionsService } from './suggestions.service.js';

const ADMIN = { email: 'proprietaire@example.org', name: 'djkix' };

/** Composition déposée au réservoir par les scénarios de demande parlée (2026-10-21). */
const COMPOSITION_VOCALE: ModelRecipe = {
  title: 'Déjà connue',
  origin: 'Composition',
  region: 'mediterraneenne',
  totalMinutes: 25,
  prepMinutes: 10,
  cookMinutes: 15,
  difficulty: 'EASY',
  dishType: 'MAIN',
  provenance: 'ai',
  sourceUrl: null,
  steps: ['Mélanger.'],
  ingredients: [{ label: 'Pâtes', quantity: 300, unit: 'GRAM' }],
};

/**
 * Contexte Nest minimal (sans HTTP) pour tester `SuggestionsService` seule, sans
 * repasser par tout `AppModule` à chaque cas. Les routes HTTP (`SuggestionsController`,
 * tâche 7) sont testées plus bas avec `createTestApp`.
 */
@Global()
@Module({})
class SuggestionsTestModule {
  static forRoot(config: AppConfig, httpClient: HttpClient): DynamicModule {
    return {
      module: SuggestionsTestModule,
      imports: [ConfigModule.forRoot(config), LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }), PrismaModule, SettingsModule, GeminiModule, RecipesModule, SuggestionsModule],
      providers: [{ provide: HTTP_CLIENT, useValue: httpClient }],
      exports: [HTTP_CLIENT],
    };
  }
}

function buildConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    SECRET_KEY: 'test-secret-key-test-secret-key-test-secret-key',
    PUBLIC_URL: 'https://inventaire.test',
    MEDIA_DIR: '/tmp/kitchen-suggestions-test-media',
    LOG_LEVEL: 'silent',
    VISION_PROVIDER: 'gemini',
    VISION_API_KEY: 'test-key',
    // Liste des modèles indisponible dans ces tests : le repli sert, et les
    // coûts attendus sont ceux de Flash-Lite.
    VISION_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_RPM: '1000',
    GEMINI_RPD: '1000',
    ...overrides,
  });
}

async function fixtureText(file: string): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../../test/fixtures', file), 'utf8');
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Hôte IP littéral (RFC 5737) : atteint sans résolution DNS, pour qu'aucun test ne dépende du réseau (section 19). */
const WEB_RECIPE_HOST = '203.0.113.20';
const UNREACHABLE_HOST = '203.0.113.21';

/** Même forme que `geminiFixture`, avec un `usageMetadata` choisi pour gonfler le coût (plafond mensuel). */
async function costlyFixture(file: string, candidatesTokenCount: number): Promise<Response> {
  const content = await fixtureText(file);
  return json({
    candidates: [{ content: { role: 'model', parts: [{ text: content }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 500, candidatesTokenCount },
    modelVersion: 'gemini-3.5-flash-lite',
  });
}

describe('SuggestionsService (EF-26)', () => {
  let ctx: INestApplicationContext | null = null;
  let http: FakeHttp;

  beforeEach(() => {
    http = new FakeHttp();
  });

  afterEach(async () => {
    if (ctx) await ctx.close();
    ctx = null;
  });

  async function createService(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<{ service: SuggestionsService; db: PrismaService }> {
    const config = buildConfig(overrides);
    ctx = await NestFactory.createApplicationContext(SuggestionsTestModule.forRoot(config, http.client), { logger: false, abortOnError: false });
    const db = ctx.get(PrismaService);
    await truncateAll(db);
    // Pause et compteurs ont été relus avant la remise à zéro de la base.
    ctx.get(GeminiService).forget();
    return { service: ctx.get(SuggestionsService), db };
  }

  /**
   * `keep` écrit `createdById` (tâche 9) : contrairement à `list`, qui ne
   * persiste rien au nom de l'utilisateur, il faut ici un `User` réel en base
   * pour que la contrainte de clé étrangère soit respectée.
   */
  async function seedUser(db: PrismaService): Promise<RequestUser> {
    const user = await db.user.create({ data: { email: 'proprietaire.keep@example.org', name: 'djkix', passwordHash: 'x', role: 'ADMIN' } });
    return { id: user.id, email: user.email, name: user.name, role: 'ADMIN', via: 'session', sessionId: 's1' };
  }

  /**
   * `temperature` par défaut à `'chilled'` (plutôt que `null`) : la plupart des
   * tests ne s'en soucient pas, mais la tâche 2 (photo et emplacement,
   * EF-23) vérifie une pastille colorée sans que chaque appelant existant
   * n'ait à le préciser.
   */
  async function seedLocation(db: PrismaService, temperature: string | null = 'chilled'): Promise<string> {
    const location = await db.location.create({ data: { name: 'Test', path: '/test', depth: 0, temperature } });
    return location.id;
  }

  async function seedProduct(
    db: PrismaService,
    locationId: string,
    opts: { name: string; categoryId?: string | null; quantity: number; unit?: string; imagePath?: string | null },
  ): Promise<string> {
    const unit = opts.unit ?? 'GRAM';
    const product = await db.product.create({
      data: { name: opts.name, categoryId: opts.categoryId ?? null, defaultUnit: unit as never, imagePath: opts.imagePath ?? null },
    });
    await db.stockItem.create({ data: { productId: product.id, locationId, quantity: opts.quantity, unit: unit as never } });
    return product.id;
  }

  /**
   * Dépose directement des recettes au réservoir (tâche 6) : la conservation
   * y lit par identité, plus dans une fournée. Le contenu de page est déjà
   * recopié (D10) — c'est précisément ce qui permet à `keep` de ne jamais
   * rappeler le site.
   */
  async function seedPool(db: PrismaService, entries: { recipe: ModelRecipe; pageRecipe?: PageRecipe | null; pageText?: string | null }[]): Promise<void> {
    for (const { recipe, pageRecipe = null, pageText = null } of entries) {
      await db.suggestionPoolRecipe.create({
        data: {
          identity: suggestionIdentity(recipe),
          payload: recipe as unknown as Prisma.InputJsonValue,
          provenance: recipe.provenance,
          dishType: recipe.dishType,
          sourceUrl: recipe.sourceUrl,
          verifiedAt: pageRecipe || pageText ? new Date() : null,
          pageRecipe: pageRecipe ? (pageRecipe as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          pageText,
          model: 'test-model',
        },
      });
    }
  }

  const QUERY: SuggestionQuery = { refresh: false };

  it('compose la requête depuis le stock, sans les épices ni le sel (B5)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    // Catégorie réellement semée par défaut (`DEFAULT_CATEGORIES`, `packages/shared`),
    // pas une catégorie inventée pour le test (revue de tâche 6 : l'ancienne version
    // créait des catégories nommées littéralement `epices`/`sel-et-poivre`, qui ne
    // prouvaient rien sur le comportement réel en production).
    const epices = await db.category.create({ data: { name: 'Épices et aromates' } });
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Paprika fumé', categoryId: epices.id, quantity: 1, unit: 'SACHET' });
    // Sel et poivre n'ont aucune catégorie dédiée dans `DEFAULT_CATEGORIES` : exclus
    // par le nom du produit, sans catégorie du tout ici.
    await seedProduct(db, locationId, { name: 'Sel fin', quantity: 1, unit: 'PACK' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    await service.list(QUERY);

    const body = JSON.parse(String(http.calls[0]?.init?.body));
    const prompt = body.contents[0].parts[0].text as string;
    expect(prompt).toContain('Tomate');
    expect(prompt).not.toContain('Paprika');
    expect(prompt).not.toContain('Sel fin');
  });

  it('refuse d’appeler le modèle quand le stock ne donne aucun ingrédient (vigilance 3)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    // Exclu par le nom du produit (sel/poivre, B5) : aucune catégorie nécessaire.
    await seedProduct(db, locationId, { name: 'Poivre', quantity: 1, unit: 'SACHET' });

    await expect(service.list(QUERY)).rejects.toMatchObject({ status: 409, code: 'insufficient_stock' });
    try {
      await service.list(QUERY);
    } catch (error) {
      expect(String((error as Error).message)).toMatch(/ingrédient/);
    }
    expect(http.calls).toHaveLength(0);
  });

  it('rapproche « crème » de « Crème fraîche épaisse 30% » et le marque probable (B11)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Crème fraîche épaisse 30%', quantity: 500, unit: 'MILLILITER' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const result = await service.list(QUERY);

    const ingredient = result.items[0]?.ingredients[0];
    expect(ingredient?.match).toBe('probable');
    expect(ingredient?.productName).toBe('Crème fraîche épaisse 30%');
  });

  it('donne la photo et l’emplacement du produit rapproché à chaque ingrédient (EF-23)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db); // doit porter temperature: 'chilled'
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE', imagePath: 'scans/tomate.jpg' });
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

    const result = await service.list(QUERY);
    const tomate = result.items.flatMap((i) => i.ingredients).find((i) => i.productName === 'Tomate');
    expect(tomate?.productImagePath).toBe('scans/tomate.jpg');
    expect(tomate?.locationName).toBeTruthy();
    expect(tomate?.locationTemperature).toBe('chilled');
  });

  it('laisse photo et emplacement à null pour un ingrédient hors stock', async () => {
    // Cas le plus fréquent d'une suggestion : l'ingrédient n'est pas au placard.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

    const result = await service.list(QUERY);
    const absent = result.items.flatMap((i) => i.ingredients).find((i) => i.productId === null);
    expect(absent?.productImagePath).toBeNull();
    expect(absent?.locationName).toBeNull();
    expect(absent?.locationTemperature).toBeNull();
  });

  it('classe chaque recette et sait cibler un type de plat (2026-10-08)', async () => {
    // Le type vient du modèle, sur la taxonomie déjà utilisée par « Mes recettes » :
    // une suggestion conservée garde son classement sans conversion.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

    const base = await service.list(QUERY);
    expect(base.items.every((item) => DISH_TYPES.includes(item.dishType))).toBe(true);
    expect(String(http.calls[0]?.init?.body)).not.toContain('Ne propose que des recettes de type');

    // Relance ciblée : le type part au modèle, qui ne doit plus rendre que celui-là.
    await service.list({ ...QUERY, dishType: 'DESSERT' });
    expect(String(http.calls[1]?.init?.body)).toContain('Ne propose que des recettes de type « Dessert »');
  });

  it('appelle le modèle le plus récent de la liste en direct de Google, jamais Pro (2026-10-22)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    const gen = ['generateContent'];
    http.on('/v1beta/models?', () =>
      json({
        models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-9-pro', 'gemini-9-flash-preview-01-2027'].map((m) => ({ name: `models/${m}`, supportedGenerationMethods: gen })),
      }),
    );
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

    await service.list(QUERY);
    expect(http.calls[0]?.url).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('fait entrer les recherches web dans le plafond mensuel (2026-10-07)', async () => {
    // Le plafond ne comptait que les jetons. Les recherches, facturées par
    // requête et bien plus cher, en sortaient entièrement : il annonçait une
    // protection qu'il n'assurait pas dès que la recherche était active.
    const { service, db } = await createService({ VISION_MONTHLY_CAP_CENTS: '10' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    // Quelques jetons seulement, mais cinq recherches : 5 × 35 $/1000 = 17,5
    // centimes, au-delà du plafond de 10 centimes à elles seules.
    http.on('generateContent', async () =>
      json({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: await fixtureText('suggestions/gemini-batch-creme.json') }] },
            finishReason: 'STOP',
            groundingMetadata: { webSearchQueries: ['a', 'b', 'c', 'd', 'e'] },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      }),
    );

    const first = await service.list({ refresh: false, maxMinutes: 30 });
    expect(first.fromCache).toBe(false);
    const log = await db.recognitionLog.findFirstOrThrow({ where: { purpose: 'RECIPE_SUGGESTION' } });
    // 17,5 centimes de recherche, plus un demi-millième de centime de jetons :
    // les recherches dominent largement le coût d'une fournée.
    expect(log.costCents?.toNumber()).toBeCloseTo(17.5, 2);

    const second = await service.list({ refresh: false, maxMinutes: 60 });
    expect(second.fromCache).toBe(true);
    expect(second.notice).toMatch(/plafond/i);
    expect(http.calls).toHaveLength(1);
  });

  it('n’arme l’outil de recherche web que si l’administrateur l’active', async () => {
    // La recherche est facturée par requête, hors du plafond mensuel de
    // l'application, et une clé sans facturation la refuse. Elle est donc
    // éteinte par défaut depuis le 2026-10-19 : c'est l'activation qui est un
    // geste délibéré, plus la désactivation.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));

    await service.list(QUERY);
    expect(String(http.calls[0]?.init?.body)).not.toContain('google_search');

    await db.setting.upsert({
      where: { key: 'suggestionWebSearch' },
      create: { key: 'suggestionWebSearch', value: true },
      update: { value: true },
    });
    await service.list({ ...QUERY, refresh: true });
    const body = String(http.calls[1]?.init?.body);
    expect(body).toContain('google_search');
    // Le prompt doit changer avec l'outil : sans recherche, un modèle invente
    // volontiers une URL plausible pour « faire vrai ». Ici l'outil est armé,
    // cette consigne ne doit donc PAS y être.
    expect(body).not.toContain('aucun outil de recherche');
  });

  it('compte un rapprochement probable comme disponible dans la couverture', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Crème fraîche épaisse 30%', quantity: 500, unit: 'MILLILITER' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const result = await service.list(QUERY);

    expect(result.items[0]?.ingredients[0]?.state).toBe('available');
    expect(result.items[0]?.group).toBe('ready');
  });

  it('sert depuis le réservoir sans appeler Gemini ni entamer le quota (vigilance 4, 2026-10-15)', async () => {
    // Cœur de la demande du 2026-10-15 : avant le réservoir, consommer un
    // article du stock changeait la pioche de départ, donc la signature de la
    // fournée, donc déclenchait un second appel payant pour des recettes
    // souvent proches des précédentes. Le compte est fait sur les appels
    // réellement passés à la doublure du fournisseur, jamais sur `fromCache` :
    // un drapeau qu'on pose soi-même ne prouve rien.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Courgette', quantity: 3, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Oignon', quantity: 4, unit: 'PIECE' });

    // Huit compositions : au-dessus de `SUGGESTION_POOL_FLOOR` (6), donc le
    // réservoir se suffit dès la seconde visite. Aucune n'est de provenance
    // `web` : rien à vérifier, donc aucune requête de page dans ce décompte.
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-reservoir.json'));
    const first = await service.list(QUERY);
    expect(first.items.length).toBeGreaterThanOrEqual(6);

    // Le lot de courgettes est consommé jusqu'au bout : la pioche de départ
    // change, et avec elle l'ancienne signature de fournée.
    await db.stockItem.deleteMany({ where: { product: { name: 'Courgette' } } });

    const second = await service.list(QUERY);

    expect(http.calls.filter((c) => c.url.includes('generateContent'))).toHaveLength(1);
    expect(second.items.length).toBeGreaterThanOrEqual(6);
    expect(second.fromCache).toBe(true);
    // Le quota journalier se compte sur ce registre : il ne doit pas bouger.
    expect(await db.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION' } })).toBe(1);
    expect(await db.suggestionBatch.count()).toBe(1);
  });

  it('ne redemande pas la même orientation dans les 24 heures, même sous le plancher (D11)', async () => {
    // Un palier étroit laisse le réservoir sous `SUGGESTION_POOL_FLOOR` à
    // chaque visite : sans ce garde, chaque ouverture de l'écran repayait un
    // appel, et le plafond mensuel — partagé avec le scan photo — y passait.
    // La signature de fournée ne porte plus les graines (D11) : elle ne dépend
    // donc plus du stock, ce que la consommation ci-dessous vérifie.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Courgette', quantity: 3, unit: 'PIECE' });

    // La fixture rend une recette de 25 minutes : sous « ≤ 15 min » le
    // réservoir ne rend jamais rien, donc reste toujours sous le plancher.
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    await service.list({ refresh: false, maxMinutes: 15 });

    await db.stockItem.deleteMany({ where: { product: { name: 'Courgette' } } });
    const second = await service.list({ refresh: false, maxMinutes: 15 });

    expect(http.calls.filter((c) => c.url.includes('generateContent'))).toHaveLength(1);
    expect(await db.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION' } })).toBe(1);
    expect(second.fromCache).toBe(true);
    // Le prix du verrou, visible dans le test lui-même : l'écran est vide. Il
    // ne doit donc pas l'être en silence — la notice dit la cause, l'échéance,
    // et les deux sorties (changer d'orientation, relancer soi-même).
    expect(second.items).toHaveLength(0);
    expect(second.notice).toMatch(/déjà été cherchée récemment/);
    expect(second.notice).toMatch(/relancez la recherche vous-même/);
  });

  /** Composition `ai` minimale : aucune page à lire, donc aucun réseau à doubler. */
  function composition(index: number): ModelRecipe {
    return {
      title: `Composition ${index}`,
      origin: 'Composée par l’IA',
      region: 'europeenne',
      totalMinutes: 20,
      prepMinutes: 10,
      cookMinutes: 10,
      difficulty: 'EASY',
      dishType: 'MAIN',
      provenance: 'ai',
      sourceUrl: null,
      steps: ['Mélanger', 'Servir'],
      ingredients: [{ label: `Ingrédient ${index}`, quantity: 1, unit: 'PIECE' }],
    };
  }

  it('ne rend jamais plus d’une page de recettes, si gros soit le réservoir', async () => {
    // Le plafond de douze venait de la fournée, que D8 a supprimée. Sans
    // borne, une visite rendait tout le réservoir — et payait un
    // rapprochement `pg_trgm` par libellé d'ingrédient de chacune de ces
    // recettes, sur un mini-PC, pour un téléphone (revue finale du
    // 2026-10-15). La borne est posée APRÈS le tri : les meilleures en tête.
    const { service, db } = await createService();
    await seedPool(
      db,
      Array.from({ length: 40 }, (_, index) => ({ recipe: composition(index) })),
    );

    const result = await service.list(QUERY);

    expect(await db.suggestionPoolRecipe.count()).toBe(40);
    expect(result.items).toHaveLength(12);
    // Le réservoir suffit largement : rien n'a été demandé au modèle.
    expect(http.calls).toHaveLength(0);
  });

  /**
   * djkix, 2026-10-19 : « je veux les conserver afin de les consulter
   * ultérieurement ». Le réservoir les gardait déjà ; l'écran n'en montrait
   * que douze et rien ne permettait de voir les autres.
   */
  describe('page demandée par le client (2026-10-19)', () => {
    it('rend la page demandée, fenêtre de classement comprise', async () => {
      // Soixante recettes, page de quarante-huit : la fenêtre de présélection
      // valait trois fois la page PAR DÉFAUT (36) et coupait donc avant la
      // page demandée — les recettes au-delà n'étaient ni classées ni rendues.
      const { service, db } = await createService();
      await seedPool(
        db,
        Array.from({ length: 60 }, (_, index) => ({ recipe: composition(index) })),
      );

      const result = await service.list({ refresh: false, limit: 48 });

      expect(result.items).toHaveLength(48);
      expect(new Set(result.items.map((item) => item.id)).size).toBe(48);
      expect(result.poolCount).toBe(60);
    });

    it('ne déclenche aucun appel au modèle, si grande soit la page', async () => {
      // Le déclenchement tient au plancher de six et à la relance explicite,
      // jamais à ce que l'écran affiche. Compté sur les appels réellement
      // passés à la doublure, pas sur `fromCache`.
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(
        db,
        Array.from({ length: 20 }, (_, index) => ({ recipe: composition(index) })),
      );

      const result = await service.list({ refresh: false, limit: 48 });

      expect(http.calls).toHaveLength(0);
      expect(result.items).toHaveLength(20);
    });

    /**
     * Réservoir de recettes web vérifiées : l'ordre de D7 les place devant
     * toute composition, quelle que soit sa couverture. Une arrivante
     * composée n'est donc en tête que par le champ `fresh` de D12 — c'est
     * cela que la page, plus grande, ne doit pas défaire.
     */
    function verifiee(index: number): ModelRecipe {
      return {
        title: `Recette vérifiée ${index}`,
        origin: 'exemple.test',
        region: 'europeenne',
        totalMinutes: 20,
        prepMinutes: 10,
        cookMinutes: 10,
        difficulty: 'EASY',
        dishType: 'MAIN',
        provenance: 'web',
        sourceUrl: `https://${WEB_RECIPE_HOST}/recette-${index}`,
        steps: [],
        ingredients: [{ label: 'Tomate', quantity: 2, unit: 'PIECE' }],
      };
    }

    it('garde en tête les recettes de la relance, même sur une grande page', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(
        db,
        Array.from({ length: 40 }, (_, index) => ({ recipe: verifiee(index), pageText: 'texte de la page' })),
      );
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));

      const relance = await service.list({ refresh: true, limit: 24 });

      expect(relance.items).toHaveLength(24);
      expect(relance.items[0]?.title).toBe('Recette orientation B');
    });

    it('charger plus après une relance ne reperd pas les nouvelles, ni ne repaie', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(
        db,
        Array.from({ length: 20 }, (_, index) => ({ recipe: verifiee(index), pageText: 'texte de la page' })),
      );
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));

      await service.list({ refresh: true });
      const plus = await service.list({ refresh: false, limit: 24 });

      // La page suivante relit le réservoir : l'arrivante n'est plus épinglée
      // en tête (D12 ne vaut que pour la réponse de la relance), mais elle est
      // servie avec le reste — et rien n'est repayé.
      expect(plus.items).toHaveLength(21);
      expect(plus.items.map((item) => item.title)).toContain('Recette orientation B');
      expect(http.calls.filter((call) => call.url.includes('generateContent'))).toHaveLength(1);
    });
  });

  it('sert le réservoir même quand le stock ne donne aucune graine', async () => {
    // « Stock insuffisant pour suggérer » était levé AVANT toute lecture du
    // réservoir : un placard momentanément vide masquait des dizaines de
    // recettes gardées pour toujours, alors que le lot promet exactement
    // l'inverse. Leur couverture nulle est justement l'information utile.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    // Exclu des graines par son nom (sel/poivre, B5) : le stock ne compose rien.
    await seedProduct(db, locationId, { name: 'Poivre', quantity: 1, unit: 'SACHET' });
    await seedPool(
      db,
      Array.from({ length: 3 }, (_, index) => ({ recipe: composition(index) })),
    );

    const result = await service.list(QUERY);

    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.coverage === 0)).toBe(true);
    // Sous le plancher de six, mais sans graine il n'y a rien à demander.
    expect(http.calls).toHaveLength(0);
  });

  it('fait entrer au réservoir tout ce que le modèle a rendu, pas seulement de quoi remplir l’écran', async () => {
    // Seize recettes sont demandées et facturées ; `rebalance` en gardait
    // douze et les quatre autres étaient perdues. « Pas d'âge max, tu logges
    // tout » : rien de payé et de valide ne doit être jeté.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    const rendues = Array.from({ length: 16 }, (_, index) => composition(index));
    http.on('generateContent', () =>
      json({
        candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ recipes: rendues }) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      }),
    );

    const result = await service.list(QUERY);

    expect(await db.suggestionPoolRecipe.count()).toBe(16);
    // L'écran, lui, reste borné à une page.
    expect(result.items).toHaveLength(12);
  });

  it('ne montre jamais une recette web dont la page n’existe pas, même fraîchement rendue', async () => {
    // La réponse du modèle n'est jamais rendue telle quelle : elle passe par
    // l'ingestion, qui jette une recette web injoignable (D4), puis par une
    // relecture du réservoir. Sans cette relecture, l'hallucination atteindrait
    // l'écran au moins une fois, à la fournée où elle est apparue.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    const inventee: ModelRecipe = {
      title: 'Recette inventée de toutes pièces',
      origin: 'Site imaginaire',
      region: 'europeenne',
      totalMinutes: 20,
      prepMinutes: 10, cookMinutes: 8,
      difficulty: 'EASY', dishType: 'MAIN',
      provenance: 'web',
      sourceUrl: `https://${UNREACHABLE_HOST}/recette-qui-n-existe-pas`,
      steps: [],
      ingredients: [{ label: 'Tomate', quantity: 2, unit: 'PIECE' }],
    };
    http.on('generateContent', () => json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ recipes: [inventee] }) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }));
    http.fail(UNREACHABLE_HOST);

    const result = await service.list(QUERY);

    expect(result.items).toHaveLength(0);
    expect(await db.suggestionPoolRecipe.count()).toBe(0);
    // L'orientation, elle, garde trace d'avoir été demandée (D2 amendée par D11).
    expect(await db.suggestionBatch.count()).toBe(1);
  });

  it('ne repropose pas une recette déjà conservée dans « Mes recettes » (D7)', async () => {
    const { service, db } = await createService();
    const keeper = await seedUser(db);
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-reservoir.json'));
    const first = await service.list(QUERY);
    const garde = first.items[0]!;

    await service.keep({ suggestionId: garde.id, clientOpId: 'op-keep-reservoir-01' }, keeper);
    const second = await service.list(QUERY);

    expect(second.items.map((i) => i.title)).not.toContain(garde.title);
    expect(second.items).toHaveLength(first.items.length - 1);
  });

  it('relance une recherche quand l’orientation change (B9)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-a.json'));
    const first = await service.list(QUERY);
    http.reset();
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));
    const second = await service.list({ refresh: false, region: 'asiatique' });

    expect(first.items[0]?.title).toBe('Recette orientation A');
    expect(second.items[0]?.title).toBe('Recette orientation B');
    expect(second.fromCache).toBe(false);
  });

  it('relance une recherche quand refresh est demandé', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    await service.list(QUERY);
    const second = await service.list({ refresh: true });

    expect(second.fromCache).toBe(false);
    expect(http.calls).toHaveLength(2);
  });

  /**
   * Demande de djkix du 2026-10-19 : « si je ne trouve pas de recette qui me
   * plaît, permet de faire un nouvel appel ». L'appel partait déjà, mais
   * `comparePoolEntries` plaçait les arrivantes derrière les anciennes mieux
   * couvertes : l'écran ne bougeait pas d'un pouce.
   */
  describe('relance explicite (2026-10-19)', () => {
    /** Vérifiée et parfaitement couverte : sans le correctif, elle tient la tête de liste pour toujours. */
    const VEDETTE: ModelRecipe = {
      title: 'Ancienne vedette du réservoir',
      origin: 'Cuisine Test',
      region: 'asiatique',
      totalMinutes: 20,
      prepMinutes: 10, cookMinutes: 10,
      difficulty: 'EASY', dishType: 'MAIN',
      provenance: 'web',
      sourceUrl: `https://${WEB_RECIPE_HOST}/vedette`,
      steps: [],
      ingredients: [{ label: 'Tomate', quantity: 2, unit: 'PIECE' }],
    };

    it('affiche en tête les recettes que la relance vient de rapporter', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(db, [{ recipe: VEDETTE, pageText: 'texte de la page' }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));

      const relance = await service.list({ refresh: true });

      // La nouveauté est une composition non vérifiée : l'ordre normal la
      // placerait derrière la vedette vérifiée, quoi qu'elle vaille.
      expect(relance.items[0]?.title).toBe('Recette orientation B');
      expect(relance.items.map((i) => i.title)).toContain(VEDETTE.title);
    });

    it('reprend l’ordre normal au geste suivant, sans rien mémoriser', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(db, [{ recipe: VEDETTE, pageText: 'texte de la page' }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));

      await service.list({ refresh: true });
      const suivant = await service.list({ refresh: false });

      expect(suivant.fromCache).toBe(true);
      expect(suivant.items[0]?.title).toBe(VEDETTE.title);
      // Aucun second appel : la relance est un geste, pas un état.
      expect(http.calls).toHaveLength(1);
    });

    it('cite au modèle les titres déjà connus pour cette orientation', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(db, [{ recipe: VEDETTE, pageText: 'texte de la page' }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));

      await service.list({ refresh: true });

      const prompt = JSON.parse(String(http.calls[0]?.init?.body)).contents[0].parts[0].text as string;
      expect(prompt).toContain('Ne propose aucune de ces recettes');
      expect(prompt).toContain(VEDETTE.title);
    });

    it('ne cite que les titres de l’orientation demandée', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      // La vedette est asiatique : une recherche européenne ne doit pas la citer.
      await seedPool(db, [{ recipe: VEDETTE, pageText: 'texte de la page' }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-reservoir.json'));

      await service.list({ refresh: true, region: 'europeenne' });

      const prompt = JSON.parse(String(http.calls[0]?.init?.body)).contents[0].parts[0].text as string;
      expect(prompt).not.toContain(VEDETTE.title);
    });
  });

  it('garde chaque orientation au réservoir et ne redemande que celle qui manque', async () => {
    // Le réservoir est lu filtré sur l'orientation (D6) : une cuisine déjà
    // servie n'est plus redemandée, une cuisine inconnue l'est.
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', (url, init) => {
      const body = JSON.parse(String(init?.body));
      const text = body.contents[0].parts[0].text as string;
      // Distingué sur la ligne d'orientation, pas sur le mot seul : le prompt
      // énumère par ailleurs toutes les régions possibles dans sa consigne de
      // format, si bien qu'un `includes('asiatique')` nu renvoyait la fixture
      // asiatique à toutes les orientations.
      const file = text.includes('vers la cuisine Asiatique') ? 'suggestions/gemini-batch-orientation-b.json' : 'suggestions/gemini-batch-reservoir.json';
      return geminiFixture(file);
    });

    const first = await service.list({ refresh: false, region: 'europeenne' });
    await service.list({ refresh: false, region: 'asiatique' });
    const third = await service.list({ refresh: false, region: 'europeenne' });

    expect(first.fromCache).toBe(false);
    expect(third.fromCache).toBe(true);
    // Comparé en ensemble : deux entrées de même couverture et de même instant
    // de découverte ne sont pas départagées par `comparePoolEntries`, leur rang
    // relatif n'est donc pas une promesse de l'application.
    expect(third.items.map((i) => i.title).sort()).toEqual(first.items.map((i) => i.title).sort());
    // Deux appels : un par orientation, jamais un troisième pour la première.
    expect(http.calls).toHaveLength(2);
  });

  it('refuse l’appel au-delà du quota journalier, en servant le réservoir', async () => {
    const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '1' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const first = await service.list({ refresh: false, maxMinutes: 30 });
    const second = await service.list({ refresh: false, maxMinutes: 60 });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.notice).toMatch(/quota/i);
    expect(http.calls).toHaveLength(1);
  });

  it('Gemini en pause : sert le réservoir avec l’heure de reprise, sans appeler (2026-10-22)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    let call = 0;
    http.on('generateContent', () => {
      call += 1;
      return call === 1
        ? geminiFixture('suggestions/gemini-batch-creme.json')
        : json({ error: { code: 429, details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }, { retryDelay: '40s' }] } }, 429);
    });
    await service.list({ refresh: false, maxMinutes: 30 });
    const paused = await service.list({ refresh: false, maxMinutes: 60 });
    const again = await service.list({ refresh: false, maxMinutes: 15 });

    expect(paused.fromCache).toBe(true);
    expect(paused.notice).toMatch(/^Gemini est en pause \(quota dépassé chez Google\) : reprise à \d\d:\d\d\. Les recettes déjà connues/);
    expect(again.notice).toMatch(/en pause/);
    expect(http.calls).toHaveLength(2);
  });

  it('refuse l’appel au-delà du plafond mensuel, en servant le réservoir', async () => {
    const { service, db } = await createService({ VISION_MONTHLY_CAP_CENTS: '1' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    // 30 000 jetons de sortie en gemini-3.5-flash-lite (0,4 $/Mtok) dépassent le
    // centime du plafond ; 5 000 suffisaient avec l'ancien modèle, vingt fois plus cher.
    http.on('generateContent', () => costlyFixture('suggestions/gemini-batch-creme.json', 30_000));
    const first = await service.list({ refresh: false, maxMinutes: 30 });
    const second = await service.list({ refresh: false, maxMinutes: 60 });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.notice).toMatch(/plafond/i);
    expect(http.calls).toHaveLength(1);
  });

  it('refuse l’appel au-delà du quota journalier sans rien promettre quand le réservoir est vide (round 1, EF-26)', async () => {
    // Quota dépassé dès le premier appel : le réservoir n'a jamais été amorcé,
    // le repli ne peut donc rien servir. Le message d'erreur ne doit jamais
    // prétendre afficher des recettes dans ce cas.
    const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '0' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    await expect(service.list(QUERY)).rejects.toMatchObject({ status: 429 });
    try {
      await service.list(QUERY);
      expect.unreachable('devait rejeter');
    } catch (error) {
      const message = String((error as Error).message);
      expect(message).toMatch(/quota/i);
      expect(message).not.toMatch(/fournée/i);
    }
    expect(http.calls).toHaveLength(0);
  });

  it('journalise l’appel avec purpose RECIPE_SUGGESTION', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    await service.list(QUERY);

    const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ provider: 'gemini', succeeded: true });
  });

  it('rend des identifiants de suggestion stables d’une fournée à l’autre', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    // Deux orientations : deux fournées distinctes en base, mêmes recettes
    // rendues. Les deux paliers de durée laissent passer la recette de la
    // fixture (25 minutes) : le filtre d'orientation du réservoir ne doit pas
    // vider la seconde lecture, ce n'est pas ce que ce cas vérifie.
    const first = await service.list({ refresh: false, maxMinutes: 30 });
    const second = await service.list({ refresh: false, maxMinutes: 60 });

    // Deux orientations, donc deux lignes de journal : la réponse ne porte plus
    // d'identifiant de lot, c'est la table qui dit que les deux appels ont eu lieu.
    expect(await db.suggestionBatch.count()).toBe(2);
    expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
    // Un identifiant de contenu, pas un rang.
    expect(first.items[0]?.id).not.toBe('0');
  });

  it('journalise une ligne par appel quand la fournée n’aboutit qu’à la reprise (Important 2)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    // Premier appel illisible, reprise conforme : deux appels réellement facturés.
    let call = 0;
    http.on('generateContent', () => {
      call += 1;
      return call === 1
        ? costlyFixture('suggestions/gemini-batch-invalide.json', 300)
        : costlyFixture('suggestions/gemini-batch-creme.json', 700);
    });
    await service.list(QUERY);

    expect(http.calls).toHaveLength(2);
    const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.succeeded)).toEqual([false, true]);

    // gemini-3.5-flash-lite : 0,1 $/Mtok en entrée, 0,4 $/Mtok en sortie, 500 jetons d'entrée par appel.
    const cost = (out: number) => Math.round(((500 * 0.1 + out * 0.4) / 1_000_000) * 100 * 10_000) / 10_000;
    const expected = cost(300) + cost(700);
    const logged = logs.reduce((sum, l) => sum + (l.costCents?.toNumber() ?? 0), 0);
    expect(logged).toBeCloseTo(expected, 6);

    // Le coût porté par la fournée est celui des deux appels, pas du seul dernier.
    const batch = await db.suggestionBatch.findFirstOrThrow();
    expect(batch.costCents?.toNumber()).toBeCloseTo(expected, 6);
  });

  it('journalise les tentatives déjà facturées même quand la reprise échoue aussi', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => costlyFixture('suggestions/gemini-batch-invalide.json', 300));
    await expect(service.list(QUERY)).rejects.toMatchObject({ status: 502 });

    const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => !l.succeeded && (l.costCents?.toNumber() ?? 0) > 0)).toBe(true);
  });

  it('marque une recette dont aucun ingrédient n’est rapproché comme exclue, jamais prête (revue de tâche 6)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    // Stock sans aucun rapport avec les ingrédients de la fixture : suffit pour
    // franchir la vigilance 3, mais aucun ingrédient de la recette n'y trouvera
    // de candidat.
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-absent.json'));
    const result = await service.list(QUERY);

    const item = result.items[0]!;
    expect(item.group).toBe('excluded');
    expect(item.coverage).toBe(0);
    expect(item.missingLabels.sort()).toEqual(['Essence de phénix', 'Poudre de dragée licorne'].sort());
    expect(item.ingredients.every((i) => i.state === 'missing')).toBe(true);
  });

  it('range une recette à qui il manque un ingrédient sur cinq dans le groupe presque', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Pâtes', quantity: 500, unit: 'GRAM' });
    await seedProduct(db, locationId, { name: 'Riz', quantity: 500, unit: 'GRAM' });
    await seedProduct(db, locationId, { name: "Huile d'olive", quantity: 1, unit: 'LITER' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-presque.json'));
    const result = await service.list(QUERY);

    const item = result.items[0]!;
    expect(item.group).toBe('almost');
    expect(item.coverage).toBeCloseTo(0.8);
    expect(item.missingLabels).toEqual(['Introuvable XYZ']);
  });

  describe('conservation d’une suggestion (EF-25, EF-26, tâche 9)', () => {
    const WEB_RECIPE: ModelRecipe = {
      title: 'Tarte aux pommes',
      origin: 'Cuisine Test',
      region: 'europeenne',
      totalMinutes: 30,
      // Volontairement haut (bucket de temps actif > 25 min) : « recalcule la
      // difficulté... (B15) » vérifie que la recette conservée reste
      // INTERMEDIATE, pas plus — un prepMinutes trop bas ferait tomber le
      // score sous le seuil et casserait ce garde-fou en silence.
      prepMinutes: 28, cookMinutes: 2,
      difficulty: 'HARD', dishType: 'MAIN',
      provenance: 'web',
      sourceUrl: `https://${WEB_RECIPE_HOST}/tarte-aux-pommes`,
      steps: [],
      ingredients: [{ label: 'Pommes', quantity: 4, unit: 'PIECE' }],
    };

    const AI_RECIPE: ModelRecipe = {
      title: 'Riz sauté maison',
      origin: 'Composition',
      region: 'asiatique',
      totalMinutes: 20,
      prepMinutes: 5, cookMinutes: 10,
      difficulty: 'EASY', dishType: 'MAIN',
      provenance: 'ai',
      sourceUrl: null,
      steps: ['Cuire le riz.', 'Faire revenir les légumes.', 'Mélanger le tout.'],
      ingredients: [
        { label: 'Riz', quantity: 200, unit: 'GRAM' },
        { label: 'Épice mystère introuvable', quantity: null, unit: null },
      ],
    };

    /** Identité de contenu, jamais un rang : la même règle partagée que celle rendue par `list`. */
    const WEB_ID = suggestionIdentity(WEB_RECIPE);
    const AI_ID = suggestionIdentity(AI_RECIPE);

    /** Texte nettoyé de la page, recopié une fois pour toutes à l'ingestion (D10) : seule matière d'une page sans `schema.org/Recipe`. */
    const PAGE_TEXT = 'Tarte aux pommes : une pâte, quatre pommes, du sucre. Étaler, garnir, cuire trente minutes.';

    /** `schema.org/Recipe` lu sur la page et recopié à l'ingestion (D10). */
    const PAGE_RECIPE: PageRecipe = {
      title: 'Tarte aux pommes de la ferme',
      ingredients: ['1 pâte brisée', '4 pommes', '2 cuillères de sucre'],
      steps: ['Étaler la pâte.', 'Garnir de pommes.', 'Cuire trente minutes.'],
    };

    it('conserve une recette web structurée sans aucune requête réseau, avec réécriture (vigilance 5)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageRecipe: PAGE_RECIPE, pageText: PAGE_TEXT }]);
      // Route déclarée pour le site : si la conservation le rappelait, l'appel
      // serait compté ici au lieu d'échouer faute de fixture.
      http.on(WEB_RECIPE_HOST, () => htmlResponse('<html></html>'));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const recipe = await service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-structure-01' }, keeper);

      // Le site n'est jamais contacté (D10) : c'est tout ce que D10 exige.
      expect(http.calls.filter((c) => c.url.includes(WEB_RECIPE_HOST))).toHaveLength(0);
      // La réécriture, elle, a bien lieu — même quand la page était structurée
      // (tour de correction 1) : seule elle rend des ingrédients avec quantité
      // et unité, dont vivent le rapprochement au stock et la couverture.
      const rewriteCalls = http.calls.filter((c) => c.url.includes('generateContent'));
      expect(rewriteCalls).toHaveLength(1);
      // Et la matière envoyée est celle du réservoir, pas le texte brut.
      const body = String(rewriteCalls[0]?.init?.body);
      expect(body).toContain('1 pâte brisée');
      expect(body).not.toContain(PAGE_TEXT);

      expect(recipe.source).toBe('IMPORTED');
      expect(recipe.sourceUrl).toBe(WEB_RECIPE.sourceUrl);
      expect(recipe.title).toBe('Tarte aux pommes (réécrite)');
      // Ce que la construction directe ne savait pas rendre : des ingrédients
      // chiffrés, rapprochables du stock.
      expect(recipe.ingredients.some((i) => i.quantity !== null && i.unit !== null)).toBe(true);
    });

    it('réécrit depuis le texte gardé sans rappeler le site quand la page n’était pas structurée (vigilance 5)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageRecipe: null, pageText: PAGE_TEXT }]);
      // Route déclarée pour le site : si la conservation le rappelait, l'appel
      // serait compté ici au lieu d'échouer faute de fixture.
      http.on(WEB_RECIPE_HOST, () => htmlResponse('<html></html>'));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const recipe = await service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-texte-0001' }, keeper);

      expect(http.calls.filter((c) => c.url.includes(WEB_RECIPE_HOST))).toHaveLength(0);
      const rewriteCalls = http.calls.filter((c) => c.url.includes('generateContent'));
      expect(rewriteCalls).toHaveLength(1);
      // La matière envoyée au modèle est bien le texte du réservoir.
      expect(String(rewriteCalls[0]?.init?.body)).toContain('Étaler, garnir, cuire trente minutes.');
      expect(recipe.source).toBe('IMPORTED');
      expect(recipe.title).toBe('Tarte aux pommes (réécrite)');
      expect(recipe.steps.length).toBeGreaterThan(0);
    });

    it('refuse une ligne web dont aucun contenu de page n’a été gardé, sans créer de recette', async () => {
      // L'ingestion ne produit pas une telle ligne (une recette web dont la
      // page n'a pas été lue est jetée, D4) : le refus est un filet, pas un
      // chemin — mais il vaut mieux qu'une recette vide, et sans lui ce code
      // partirait réécrire du vide.
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageRecipe: null, pageText: null }]);

      await expect(service.keep({ suggestionId: WEB_ID }, keeper)).rejects.toMatchObject({ status: 502, message: 'Le contenu de la page n’a pas été conservé ; aucune recette n’a été créée' });
      expect(http.calls).toHaveLength(0);
      expect(await db.recipe.count()).toBe(0);
    });

    it('journalise la réécriture dans le même registre que les fournées, avec son coût (Important 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      await service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-ledger-00001' }, keeper);

      const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' }, orderBy: { createdAt: 'asc' } });
      const rewriteLog = logs.find((l) => l.succeeded && l.provider === 'gemini');
      expect(rewriteLog).toBeDefined();
      expect(rewriteLog?.costCents?.toNumber()).not.toBeNull();
      expect(rewriteLog?.costCents?.toNumber()).toBeGreaterThan(0);
    });

    it('garde provider_unavailable pour un échec de transport ou de statut du réécriveur (round 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }]);
      http.on('generateContent', () => json({ error: 'en panne' }, 500));

      await expect(service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-transport-01' }, keeper)).rejects.toMatchObject({
        status: 502,
        code: 'provider_unavailable',
      });
    });

    it('donne provider_invalid_response quand Gemini répond mais hors schéma (round 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-invalide.json'));

      await expect(service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-invalide-01' }, keeper)).rejects.toMatchObject({
        status: 502,
        code: 'provider_invalid_response',
      });
    });

    it('un rejeu conserve sans aucun appel réseau ni nouvelle ligne de registre (round 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const first = await service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-rejeu-00001' }, keeper);
      http.reset();

      const second = await service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-rejeu-00001' }, keeper);

      expect(second.id).toBe(first.id);
      expect(http.calls).toHaveLength(0);
      const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' } });
      expect(logs).toHaveLength(1);
      expect(await db.recipe.count()).toBe(1);
    });

    it('refuse la réécriture au-delà du quota journalier, sans créer de recette', async () => {
      const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '0' });
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }]);

      await expect(service.keep({ batchId: '', suggestionId: WEB_ID }, keeper)).rejects.toMatchObject({ status: 429 });
      expect(http.calls).toHaveLength(0);
      expect(await db.recipe.count()).toBe(0);
    });

    it('conserve une composition sans appeler le réseau, source GENERATED', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }, { recipe: AI_RECIPE }]);

      const recipe = await service.keep({ batchId: '', suggestionId: AI_ID, clientOpId: 'op-keep-ai-0000001' }, keeper);

      expect(recipe.source).toBe('GENERATED');
      expect(recipe.sourceUrl).toBeNull();
      expect(recipe.title).toBe('Riz sauté maison');
      // Le classement du modèle suit la recette : « Mes recettes » filtre sur le
      // même vocabulaire, rien à reclasser à la main (2026-10-08).
      expect(recipe.dishType).toBe(AI_RECIPE.dishType);
      expect(recipe.prepMinutes).toBe(AI_RECIPE.prepMinutes);
      expect(recipe.cookMinutes).toBe(AI_RECIPE.cookMinutes);
      expect(http.calls).toHaveLength(0);
    });

    // 2026-10-19 : une recette conservée n'avait aucune cuisine, donc le
    // sélecteur « Cuisine » de « Mes recettes » — qui liste les lignes de
    // `Cuisine` — ne pouvait correspondre à aucune d'elles.
    it('rattache la recette conservée à la cuisine de sa région, et n’en crée qu’une', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: AI_RECIPE }]);

      const recipe = await service.keep({ batchId: '', suggestionId: AI_ID, clientOpId: 'op-keep-cuisine-001' }, keeper);

      expect(recipe.cuisineName).toBe(SUGGESTION_REGION_LABELS_FR[AI_RECIPE.region]);
      const rows = await db.cuisine.findMany({ where: { region: AI_RECIPE.region } });
      expect(rows).toHaveLength(1);

      // Une seconde conservation de la même région réutilise la ligne.
      await seedPool(db, [{ recipe: { ...AI_RECIPE, title: 'Autre riz sauté' } }]);
      await service.keep(
        { batchId: '', suggestionId: suggestionIdentity({ ...AI_RECIPE, title: 'Autre riz sauté' }), clientOpId: 'op-keep-cuisine-002' },
        keeper,
      );
      expect(await db.cuisine.count({ where: { region: AI_RECIPE.region } })).toBe(1);
    });

    it('reporte la durée totale sur prepMinutes quand la suggestion n’a ni préparation ni cuisson détaillée (constat final 3)', async () => {
      // Avant la ventilation prep/cuisson, `prepMinutes` recevait
      // `suggestion.totalMinutes` ; le cas `null`/`null` n'existait pas. Sans
      // repli, une telle suggestion perdrait toute durée en arrivant dans
      // « Mes recettes » alors que `totalMinutes` reste obligatoire au schéma.
      const SANS_DUREE_DETAILLEE: ModelRecipe = {
        ...AI_RECIPE,
        title: 'Riz sauté sans détail',
        totalMinutes: 35,
        prepMinutes: null,
        cookMinutes: null,
      };
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: SANS_DUREE_DETAILLEE }]);

      const recipe = await service.keep({ batchId: '', suggestionId: suggestionIdentity(SANS_DUREE_DETAILLEE), clientOpId: 'op-keep-sans-duree-01' }, keeper);

      expect(recipe.prepMinutes).toBe(35);
      expect(recipe.cookMinutes).toBeNull();
      expect(recipe.totalMinutes).toBe(35);
    });

    it('recalcule la difficulté avec le barème du foyer à la conservation (B15)', async () => {
      // la suggestion annonçait HARD, les étapes conservées donnent INTERMEDIATE
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: WEB_RECIPE, pageText: PAGE_TEXT }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const recipe = await service.keep({ batchId: '', suggestionId: WEB_ID, clientOpId: 'op-keep-diff-0000001' }, keeper);

      expect(recipe.difficulty).toBe('INTERMEDIATE');
      expect(recipe.difficultyOverride).toBe(false);
    });

    it('rattache les ingrédients aux produits rapprochés, laisse les autres en texte libre', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Riz', quantity: 500, unit: 'GRAM' });
      await seedPool(db, [{ recipe: AI_RECIPE }]);

      const recipe = await service.keep({ batchId: '', suggestionId: AI_ID, clientOpId: 'op-keep-match-0000001' }, keeper);

      const riz = recipe.ingredients.find((i) => i.label === 'Riz');
      const mystere = recipe.ingredients.find((i) => i.label === 'Épice mystère introuvable');
      expect(riz?.productId).not.toBeNull();
      expect(riz?.productName).toBe('Riz');
      expect(mystere?.productId).toBeNull();
    });

    it('désigne la suggestion par son identité au réservoir, jamais par un rang ni par une fournée (D9)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      // Une orientation a déjà été demandée ; seule la composition est au
      // réservoir. C'est le réservoir qui fait foi — la ligne de fournée ne
      // porte plus aucune recette depuis la migration 0010.
      await db.suggestionBatch.create({ data: { signature: 'test-keep-fournee', model: 'test-model', costCents: null } });
      await seedPool(db, [{ recipe: AI_RECIPE }]);

      await expect(service.keep({ batchId: '', suggestionId: '0' }, keeper)).rejects.toMatchObject({ status: 404 });
      // Rendue par le modèle, absente du réservoir : introuvable.
      await expect(service.keep({ batchId: '', suggestionId: WEB_ID }, keeper)).rejects.toMatchObject({ status: 404 });

      const kept = await service.keep({ batchId: '', suggestionId: AI_ID, clientOpId: 'op-keep-identite-001' }, keeper);
      expect(kept.title).toBe('Riz sauté maison');
    });

    it('conserve sans fournée du tout : le réservoir suffit (D9)', async () => {
      // Le chemin normal depuis la tâche 4 : l'écran sert du réservoir, et la
      // dernière `SuggestionBatch` ne contient plus ce qu'il affiche — ou
      // n'existe pas.
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: AI_RECIPE }]);
      expect(await db.suggestionBatch.count()).toBe(0);

      const kept = await service.keep({ suggestionId: AI_ID, clientOpId: 'op-keep-sans-fournee' }, keeper);
      expect(kept.title).toBe('Riz sauté maison');
    });

    it('est idempotente : deux conservations du même clientOpId ne créent qu’une recette', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      await seedPool(db, [{ recipe: AI_RECIPE }]);

      const first = await service.keep({ batchId: '', suggestionId: AI_ID, clientOpId: 'op-keep-idempotent-01' }, keeper);
      const second = await service.keep({ batchId: '', suggestionId: AI_ID, clientOpId: 'op-keep-idempotent-01' }, keeper);

      expect(second.id).toBe(first.id);
      expect(await db.recipe.count()).toBe(1);
    });

    it('conserve l’identité que la fournée a publiée, même quand deux compositions partagent le même titre (EF-26)', async () => {
      // L'identité publiée et l'identité cherchée doivent être la même.
      // `list` publie `suggestionIdentity` nu ; tant que `keep` cherchait par
      // `suggestionIdentities`, qui suffixe les doublons (`-2`), une seconde
      // composition de même titre n'était jamais conservable — et c'était la
      // première qui était conservée à sa place, en silence. Au réservoir,
      // deux recettes de même identité sont une seule ligne par construction.
      const RIZ_PREMIERE: ModelRecipe = {
        title: 'Riz sauté',
        origin: 'Composition',
        region: 'asiatique',
        totalMinutes: 15,
        prepMinutes: 5, cookMinutes: 8,
        difficulty: 'EASY', dishType: 'MAIN',
        provenance: 'ai',
        sourceUrl: null,
        steps: ['Cuire le riz nature.'],
        ingredients: [{ label: 'Riz', quantity: 200, unit: 'GRAM' }],
      };
      const RIZ_SECONDE: ModelRecipe = {
        ...RIZ_PREMIERE,
        totalMinutes: 25,
        steps: ["Faire revenir le riz à l'huile d'olive avec les légumes."],
        ingredients: [
          { label: 'Riz', quantity: 200, unit: 'GRAM' },
          { label: "Huile d'olive", quantity: 1, unit: 'MILLILITER' },
        ],
      };

      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Riz', quantity: 500, unit: 'GRAM' });
      http.on('generateContent', () =>
        json({
          candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ recipes: [RIZ_PREMIERE, RIZ_SECONDE] }) }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
        }),
      );

      const batch = await service.list(QUERY);

      expect(batch.items).toHaveLength(1);
      // Identité nue, jamais suffixée : c'est elle que la conservation cherche.
      expect(batch.items[0]?.id).toBe(suggestionIdentity(RIZ_PREMIERE));

      const kept = await service.keep({ suggestionId: batch.items[0]!.id, clientOpId: 'op-keep-riz-doublon-01' }, keeper);
      // La première composition survit : la seconde (25 min, huile d'olive) est écartée.
      expect(kept.steps).toEqual(['Cuire le riz nature.']);
    });
  });

  /**
   * Suggestions à partir d'ingrédients dictés (spécification du 2026-10-19,
   * EF-25, EF-26) : « j'ai des pommes de terre et un reste de merguez ». Le
   * champ est du texte libre — un reste ne se scanne pas — et ce qui est tapé
   * est imposé : chaque recette doit l'utiliser (D1).
   */
  describe('ingrédients dictés (2026-10-19)', () => {
    /** Composition qui n'utilise aucun des ingrédients dictés : elle ne doit jamais remonter. */
    const SANS_MERGUEZ: ModelRecipe = {
      title: 'Soupe de courgettes au curry',
      origin: 'Composition',
      region: 'europeenne',
      totalMinutes: 25,
      prepMinutes: 10,
      cookMinutes: 15,
      difficulty: 'EASY',
      dishType: 'MAIN',
      provenance: 'ai',
      sourceUrl: null,
      steps: ['Cuire les courgettes 15 minutes à feu moyen.'],
      ingredients: [{ label: 'Courgettes', quantity: 3, unit: 'PIECE' }],
    };
    const AVEC_MERGUEZ: ModelRecipe = {
      ...SANS_MERGUEZ,
      title: 'Poêlée de merguez et pommes de terre',
      ingredients: [
        { label: 'Pommes de terre nouvelles', quantity: 500, unit: 'GRAM' },
        { label: 'Merguez', quantity: 4, unit: 'PIECE' },
        { label: 'Persil plat', quantity: null, unit: null },
      ],
    };

    /** Même forme que celle rendue par le schéma partagé : saisie brute + termes normalisés et triés. */
    function dictated(raw: string): { raw: string; terms: string[] } {
      return { raw, terms: normalizeIngredientTerms(raw) };
    }

    /**
     * N'utilise qu'UN des deux termes dictés (tour de correction 1) : sans
     * elle, muter `every` en `some` dans `recipeUsesAllTerms` ne faisait tomber
     * aucun test — le jeu ne contenait que du tout ou rien, et c'est pourtant
     * la régression la plus plausible de D1.
     */
    const UN_SEUL_TERME: ModelRecipe = {
      ...SANS_MERGUEZ,
      title: 'Pommes de terre sautées au thym',
      ingredients: [
        { label: 'Pommes de terre', quantity: 600, unit: 'GRAM' },
        { label: 'Thym', quantity: null, unit: null },
      ],
    };

    async function seedStock(db: PrismaService): Promise<void> {
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedProduct(db, locationId, { name: 'Oignon', quantity: 4, unit: 'PIECE' });
    }

    it('lit le réservoir d’abord : une seconde demande identique n’appelle pas le modèle (D2)', async () => {
      // Le compte porte sur les appels réellement passés à la doublure, jamais
      // sur `fromCache` : un drapeau qu'on pose soi-même ne prouve rien.
      const { service, db } = await createService();
      await seedStock(db);
      // Déjà au réservoir, et hors sujet : elle ne doit apparaître dans aucune
      // des deux réponses, pas même dans celle servie sans appel.
      await seedPool(db, [{ recipe: SANS_MERGUEZ }]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-merguez.json'));

      const query: SuggestionQuery = { refresh: false, ingredients: dictated('merguez, pommes de terre') };
      const first = await service.list(query);
      expect(first.items.length).toBeGreaterThanOrEqual(6);
      expect(first.fromCache).toBe(false);

      const second = await service.list(query);
      expect(http.calls.filter((c) => c.url.includes('generateContent'))).toHaveLength(1);
      expect(second.fromCache).toBe(true);
      expect(second.items.length).toBeGreaterThanOrEqual(6);
      expect(second.items.map((item) => item.title)).not.toContain(SANS_MERGUEZ.title);
      expect(await db.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION' } })).toBe(1);
    });

    it('ne rend que les recettes qui utilisent TOUS les ingrédients dictés (D1, D8)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      await seedPool(db, [{ recipe: AVEC_MERGUEZ }, { recipe: SANS_MERGUEZ }, { recipe: UN_SEUL_TERME }]);
      // Le réservoir filtré ne rend qu'une recette, donc sous le plancher : un
      // appel part, et ne rapporte rien ici. Ce qui est affiché vient du
      // réservoir filtré, et de lui seul.
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-vide.json'));

      const result = await service.list({ refresh: false, ingredients: dictated('merguez, pommes de terre') });
      // Ni la recette qui n'en utilise aucun, ni celle qui n'en utilise qu'un.
      expect(result.items.map((item) => item.title)).toEqual(['Poêlée de merguez et pommes de terre']);
    });

    it('donne à chaque combinaison son propre verrou de 24 heures (D3)', async () => {
      // Sans les ingrédients dans la signature, « courgette, feta » hériterait
      // du verrou posé par « merguez, pommes de terre » et se verrait refuser
      // son appel — un écran vide pour une question jamais posée.
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-vide.json'));

      await service.list({ refresh: false, ingredients: dictated('merguez, pommes de terre') });
      expect(http.calls.filter((c) => c.url.includes('generateContent'))).toHaveLength(1);

      await service.list({ refresh: false, ingredients: dictated('courgette, feta') });
      expect(http.calls.filter((c) => c.url.includes('generateContent'))).toHaveLength(2);

      // La même demande, elle, reste verrouillée : rien de neuf à demander.
      const encore = await service.list({ refresh: false, ingredients: dictated('merguez, pommes de terre') });
      expect(http.calls.filter((c) => c.url.includes('generateContent'))).toHaveLength(2);
      expect(encore.notice).toMatch(/déjà été cherchée récemment/);
    });

    it('impose les ingrédients dictés au modèle sans cacher le stock (D1, D4)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-merguez.json'));

      await service.list({ refresh: false, ingredients: dictated('merguez, pommes de terre') });
      const prompt = JSON.parse(String(http.calls[0]?.init?.body)).contents[0].parts[0].text as string;

      expect(prompt).toContain('Ingrédients imposés : merguez, pommes de terre');
      // La consigne générale ne doit plus dire « utilisant si possible ces
      // ingrédients » à une ligne de « doit les utiliser TOUS » : deux phrases
      // contradictoires sur un référent devenu ambigu (tour 1).
      expect(prompt).not.toContain('si possible');
      expect(prompt).toMatch(/doit les utiliser TOUS/);
      // Le stock reste envoyé, mais clairement du côté du « disponible ».
      expect(prompt).toContain('Tomate');
      expect(prompt).toMatch(/seulement disponibles/);
      // Les consignes existantes tiennent toujours.
      expect(prompt).toMatch(/nettement différentes les unes des autres/);
    });

    it('envoie au modèle la saisie telle qu’elle a été tapée, accents compris (tour 1)', () => {
      // La normalisation sert la signature et le rapprochement au réservoir,
      // jamais le transport : « crème fraîche » doit arriver accentué.
      const prompt = buildSuggestionPrompt({ seeds: ['Tomate'], count: 12, ingredients: dictated('Crème fraîche, Merguez') });
      expect(prompt).toContain('Crème fraîche, Merguez');
      expect(prompt).not.toContain('creme fraiche');
    });

    it('dit que le repli de quota a perdu les ingrédients demandés (tour 1)', async () => {
      // Repli : le réservoir entier, sans filtre d'orientation NI d'ingrédients.
      // Sans cette phrase, djkix reçoit des recettes qui n'ont rien à voir
      // avec ce qu'il vient de taper, et seul le quota lui est expliqué.
      const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '0' });
      await seedStock(db);
      await seedPool(db, [{ recipe: SANS_MERGUEZ }]);

      const result = await service.list({ refresh: false, ingredients: dictated('merguez, pommes de terre') });
      expect(result.notice).toMatch(/[Qq]uota journalier/);
      expect(result.notice).toMatch(/ingrédients/i);
      expect(result.items).toHaveLength(1);
    });

    it('n’annonce jamais comme manquant un ingrédient que l’on vient de déclarer (D5)', async () => {
      const { service, db } = await createService();
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
      await seedPool(db, [
        {
          recipe: {
            ...AVEC_MERGUEZ,
            ingredients: [
              { label: 'Merguez', quantity: 4, unit: 'PIECE' },
              { label: 'Tomate', quantity: 2, unit: 'PIECE' },
              { label: 'Persil plat', quantity: null, unit: null },
            ],
          },
        },
      ]);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-vide.json'));

      const result = await service.list({ refresh: false, ingredients: dictated('merguez') });
      const item = result.items[0];
      expect(item?.missingLabels).toEqual(['Persil plat']);
      // Et pas seulement dans la liste des manquants : l'ingrédient lui-même
      // est marqué comme déclaré, pour que le tiroir cesse d'afficher
      // « Merguez — Manquant » juste après qu'on l'ait tapé (tour 1).
      expect(item?.ingredients.find((i) => i.label === 'Merguez')?.declared).toBe(true);
      expect(item?.ingredients.find((i) => i.label === 'Persil plat')?.declared).toBe(false);
      // Le taux reste calculé sur le stock réel : une déclaration à l'écran ne
      // remplit pas le placard. Un chiffre prudent, pas un chiffre inventé.
      expect(item?.coverage).toBeLessThan(1);
    });
  });

  /**
   * Demande parlée (spécification du 2026-10-21). Aucun de ces cas n'envoie
   * d'audio réel : ce qui est en jeu ici n'est pas le son mais le croisement
   * avec le stock, le quota, le journal et les bornes.
   */
  describe('listFromVoice (demande parlée, 2026-10-21)', () => {
    const AUDIO = Buffer.alloc(VOICE_MIN_BYTES + 1, 7);
    const MIME = 'audio/webm';

    async function seedStock(db: PrismaService): Promise<void> {
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Pâtes', quantity: 500, unit: 'GRAM' });
      await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    }

    it('rend les recettes et ce que le modèle a entendu (D2, D4)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      const result = await service.listFromVoice(AUDIO, MIME);
      expect(result.heard.ingredients).toEqual(['poulet', 'sauce tomate']);
      expect(result.heard.orientation).toBe('plat italien');
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.fromCache).toBe(false);
    });

    it('croise la parole avec le stock réel : l’audio part, le stock aussi', async () => {
      // C'est la seule chose que l'application Gemini ne sait pas faire, et
      // toute la valeur de la fonctionnalité.
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      await service.listFromVoice(AUDIO, MIME);
      const parts = JSON.parse(String(http.calls[0]?.init?.body)).contents[0].parts;
      expect(parts[0].inlineData.mimeType).toBe(MIME);
      expect(parts[1].text).toContain('Tomate');
    });

    it('ne dit jamais manquant un ingrédient entendu, et garde la couverture sur le stock (D4, D5 du 2026-10-19)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      const result = await service.listFromVoice(AUDIO, MIME);
      const item = result.items[0];
      expect(item?.missingLabels).not.toContain('Blanc de poulet');
      expect(item?.missingLabels).not.toContain('Sauce tomate');
      expect(item?.ingredients.find((i) => i.label === 'Blanc de poulet')?.declared).toBe(true);
      expect(item?.ingredients.find((i) => i.label === 'Pâtes')?.declared).toBe(false);
      // La règle de couverture partagée n'est pas touchée : elle ne connaît
      // que le stock, et une déclaration ne remplit pas le placard.
      expect(item?.coverage).toBeLessThan(1);
    });

    it('fait entrer les recettes au réservoir : rien de payé n’est jeté (D5)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      const result = await service.listFromVoice(AUDIO, MIME);
      const rows = await db.suggestionPoolRecipe.findMany();
      expect(rows).toHaveLength(3);
      // Le réservoir est commun aux deux chemins : ce sont bien les lignes du
      // réservoir qui sont rendues à l'écran, et elles y restent ensuite.
      expect(rows.map((row) => row.identity).sort()).toEqual(result.items.map((item) => item.id).sort());
      expect(rows.map((row) => (row.payload as { title: string }).title)).toContain('Poulet à la tomate 1');
    });

    it('appelle toujours le modèle, même quand le réservoir déborde (D5)', async () => {
      // Une phrase est unique : il n'y a rien à retrouver au réservoir.
      const { service, db } = await createService();
      await seedStock(db);
      await seedPool(
        db,
        Array.from({ length: 10 }, (_, i) => ({
          recipe: { ...COMPOSITION_VOCALE, title: `Déjà connue ${i}` },
        })),
      );
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      await service.listFromVoice(AUDIO, MIME);
      expect(http.calls).toHaveLength(1);
    });

    it('consomme un appel du quota journalier, et le refuse une fois atteint (D5)', async () => {
      const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '1' });
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      await service.listFromVoice(AUDIO, MIME);
      expect(await db.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION' } })).toBe(1);

      await expect(service.listFromVoice(AUDIO, MIME)).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
      // Refusé AVANT de dépenser : un quota atteint ne doit pas envoyer l'audio.
      expect(http.calls).toHaveLength(1);
    });

    it('entre dans le plafond mensuel partagé avec le scan photo (D5)', async () => {
      const { service, db } = await createService({ VISION_MONTHLY_CAP_CENTS: '1' });
      await seedStock(db);
      // Une dépense déjà inscrite au titre du scan photo suffit à fermer la porte.
      await db.recognitionLog.create({
        data: { provider: 'gemini', purpose: 'VISION', succeeded: true, costCents: new Prisma.Decimal(5), latencyMs: 10, rawResult: {} },
      });
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      await expect(service.listFromVoice(AUDIO, MIME)).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
      expect(http.calls).toHaveLength(0);
    });

    it('journalise l’appel sans qu’un seul octet d’audio n’y arrive (D6)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      await service.listFromVoice(AUDIO, MIME);
      const log = await db.recognitionLog.findFirstOrThrow({ where: { purpose: 'RECIPE_SUGGESTION' } });
      const serialized = JSON.stringify(log.rawResult);
      expect(serialized).not.toContain(AUDIO.toString('base64'));
      // Pas davantage un fragment : vingt caractères de base64 ne se croisent pas par hasard.
      expect(serialized).not.toContain(AUDIO.toString('base64').slice(0, 20));
      expect(log.costCents).not.toBeNull();
    });

    it('ne laisse pas d’audio dans le journal quand l’appel échoue (D6)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => json({ error: 'boum' }, 500));

      await expect(service.listFromVoice(AUDIO, MIME)).rejects.toMatchObject({ status: 502 });
      const logs = await db.recognitionLog.findMany();
      for (const log of logs) {
        expect(JSON.stringify(log.rawResult)).not.toContain(AUDIO.toString('base64').slice(0, 20));
      }
    });

    it('facture l’appel au tarif audio (D7)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      await service.listFromVoice(AUDIO, MIME);
      const log = await db.recognitionLog.findFirstOrThrow({ where: { purpose: 'RECIPE_SUGGESTION' } });
      // La fixture rend 900 jetons d'entrée et 70 de sortie sans ventilation
      // par modalité : tout l'entrant passe au tarif audio (repli de D7).
      const price = PRICES_USD_PER_MTOK['gemini-3.5-flash-lite']!;
      const attendu = Math.round(((900 * price.audio + 70 * price.output) / 1_000_000) * 100 * 10_000) / 10_000;
      expect(log.costCents?.toNumber()).toBeCloseTo(attendu, 6);
    });

    it('inscrit le coût d’une réponse 200 refusée par le modèle (tour de correction 1)', async () => {
      // Payée par Google, donc comptée dans le plafond mensuel : une ligne de
      // journal à `costCents: null` l'en aurait sortie en silence.
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () =>
        json({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 0 } }),
      );

      await expect(service.listFromVoice(AUDIO, MIME)).rejects.toMatchObject({ status: 502 });
      const log = await db.recognitionLog.findFirstOrThrow({ where: { purpose: 'RECIPE_SUGGESTION' } });
      expect(log.succeeded).toBe(false);
      expect(log.costCents?.toNumber()).toBeGreaterThan(0);
    });

    it('refuse un enregistrement hors bornes sans rien dépenser (D8)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      // Vide, trop gros, mauvais format : trois refus, aucun appel.
      await expect(service.listFromVoice(Buffer.alloc(10), MIME)).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
      await expect(service.listFromVoice(Buffer.alloc(VOICE_MAX_BYTES + 1), MIME)).rejects.toMatchObject({ status: 400 });
      await expect(service.listFromVoice(AUDIO, 'video/mp4')).rejects.toMatchObject({ status: 400 });
      expect(http.calls).toHaveLength(0);
    });

    it('dit en français que le modèle n’a rien compris, sans jeter ce qui est payé (D9)', async () => {
      const { service, db } = await createService();
      await seedStock(db);
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-muet.json'));

      await expect(service.listFromVoice(AUDIO, MIME)).rejects.toMatchObject({ status: 422, code: 'business_rule' });
      try {
        await service.listFromVoice(AUDIO, MIME);
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/compris/i);
      }
      // L'appel est payé : les recettes rendues entrent quand même au réservoir (D5).
      expect(await db.suggestionPoolRecipe.count()).toBeGreaterThan(0);
      // Et il est journalisé, donc décompté du quota.
      expect(await db.recognitionLog.count({ where: { purpose: 'RECIPE_SUGGESTION' } })).toBe(2);
    });

    it('refuse quand aucun fournisseur n’est configuré, sans toucher au stock', async () => {
      const { service, db } = await createService({ VISION_PROVIDER: 'none', VISION_API_KEY: '' });
      await seedStock(db);
      await expect(service.listFromVoice(AUDIO, MIME)).rejects.toMatchObject({ status: 422, code: 'provider_disabled' });
      expect(http.calls).toHaveLength(0);
    });

    it('fonctionne sur un placard vide : la parole se suffit à elle-même', async () => {
      // Contrairement à la recherche écrite, qui tire son point de départ du
      // stock et refuse en 409 quand il est vide, une demande parlée porte
      // déjà ses ingrédients.
      const { service } = await createService();
      http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));

      const result = await service.listFromVoice(AUDIO, MIME);
      expect(result.items.length).toBeGreaterThan(0);
    });
  });

});

describe('GET /suggestions (EF-26, tâche 7)', () => {
  let t: TestApp;
  let agent: TestAgent;
  let http: FakeHttp;

  beforeAll(async () => {
    http = new FakeHttp();
    t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'AIza-test' }, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  it('exige une session', async () => {
    const res = await t.api.get('/api/v1/suggestions').expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('valide l’orientation par le schéma partagé', async () => {
    const res = await agent.get('/api/v1/suggestions').query({ region: 'martienne' }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rend une fournée avec son horodatage', async () => {
    const productId = await createProduct(agent, { name: 'Tomate' });
    const placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
    await createStock(agent, { productId, locationId: placardId, quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const res = await agent.get('/api/v1/suggestions').expect(200);

    // Plus d'identifiant de lot dans la réponse (lot du 2026-10-15) : l'écran
    // est servi par le réservoir, et la conservation désigne la recette par son
    // identité de contenu.
    expect(res.body.batchId).toBeUndefined();
        expect(res.body.items.length).toBeGreaterThan(0);
  });
});

describe('GET /suggestions, fournisseur désactivé (EF-26, tâche 7)', () => {
  it('dit en français que le fournisseur n’est pas configuré', async () => {
    const t = await createTestApp({ VISION_PROVIDER: 'none' });
    try {
      await t.reset();
      const agent = t.agent();
      await t.signIn(agent, ADMIN);

      const res = await agent.get('/api/v1/suggestions').expect(422);
      expect(res.body.error.code).toBe('provider_disabled');
      expect(res.body.error.message).toBe('Fournisseur de suggestions désactivé : renseignez VISION_PROVIDER et VISION_API_KEY');
    } finally {
      await t.close();
    }
  });
});

describe('POST /suggestions/keep (EF-25, EF-26, tâche 9)', () => {
  let t: TestApp;
  let agent: TestAgent;
  let http: FakeHttp;

  beforeAll(async () => {
    http = new FakeHttp();
    t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'AIza-test' }, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  /** Même dépôt au réservoir que plus haut, vu depuis le fil : la conservation n'y lit plus aucune fournée (D9). */
  async function seedPoolHttp(recipe: ModelRecipe): Promise<string> {
    const identity = suggestionIdentity(recipe);
    await t.prisma.suggestionPoolRecipe.create({
      data: {
        identity,
        payload: recipe as unknown as Prisma.InputJsonValue,
        provenance: recipe.provenance,
        dishType: recipe.dishType,
        sourceUrl: recipe.sourceUrl,
        verifiedAt: null,
        pageRecipe: Prisma.DbNull,
        pageText: null,
        model: 'test-model',
      },
    });
    return identity;
  }

  const COMPOSITION: ModelRecipe = {
    title: 'Riz sauté express',
    origin: 'Composition',
    region: 'asiatique',
    totalMinutes: 15,
    prepMinutes: 5, cookMinutes: 8,
    difficulty: 'EASY', dishType: 'MAIN',
    provenance: 'ai',
    sourceUrl: null,
    steps: ['Cuire le riz.', 'Mélanger le tout.'],
    ingredients: [{ label: 'Riz', quantity: 200, unit: 'GRAM' }],
  };

  it('conserve une composition sans réseau et rend la recette créée (201)', async () => {
    const suggestionId = await seedPoolHttp(COMPOSITION);

    const res = await agent.post('/api/v1/suggestions/keep').send({ batchId: 'fournee-quelconque', suggestionId }).expect(201);
    expect(res.body.source).toBe('GENERATED');
    expect(res.body.title).toBe('Riz sauté express');
  });

  /**
   * Le `batchId` relâché, vu depuis le fil : l'écran servi par le réservoir
   * n'a pas toujours de fournée à citer et envoie une chaîne vide. Tant que
   * le schéma partagé exigeait un `idSchema` (`min(1)`), la conservation
   * mourait en 400 au contrôleur, avant même d'atteindre le service — plus
   * rien ne se conservait dans « Mes recettes ».
   */
  it('accepte un batchId vide, et même absent : il n’est plus qu’un reliquat ignoré', async () => {
    const vide = await seedPoolHttp(COMPOSITION);
    const res = await agent.post('/api/v1/suggestions/keep').send({ batchId: '', suggestionId: vide, clientOpId: 'op-wire-vide-00001' }).expect(201);
    expect(res.body.title).toBe('Riz sauté express');

    const absent = await seedPoolHttp({ ...COMPOSITION, title: 'Riz sauté sans fournée' });
    const res2 = await agent.post('/api/v1/suggestions/keep').send({ suggestionId: absent, clientOpId: 'op-wire-absent-0001' }).expect(201);
    expect(res2.body.title).toBe('Riz sauté sans fournée');
  });

  it('rend 404 quand l’identité n’est pas au réservoir', async () => {
    const res = await agent.post('/api/v1/suggestions/keep').send({ batchId: '', suggestionId: 'deadbeef' }).expect(404);
    expect(res.body.error.message).toBe('Suggestion introuvable');
  });
});

/**
 * Demande parlée vue depuis le fil (spécification du 2026-10-21). L'audio
 * téléversé n'est pas de la parole : aucun test n'en envoie, et aucun n'en a
 * besoin — ce qui est vérifié ici, c'est la route, ses refus et sa réponse.
 */
describe('POST /suggestions/voice (EF-25, EF-26, 2026-10-21)', () => {
  let t: TestApp;
  let agent: TestAgent;
  let http: FakeHttp;
  const AUDIO = Buffer.alloc(VOICE_MIN_BYTES + 1, 7);

  beforeAll(async () => {
    http = new FakeHttp();
    t = await createTestApp({ VISION_PROVIDER: 'gemini', VISION_API_KEY: 'AIza-test' }, http.client);
  });
  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await t.signIn(agent, ADMIN);
  });
  afterAll(() => t.close());

  it('exige une session', async () => {
    const res = await t.api.post('/api/v1/suggestions/voice').attach('audio', AUDIO, { filename: 'demande.webm', contentType: 'audio/webm' }).expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rend les recettes et la lecture du modèle', async () => {
    http.on('generateContent', () => geminiFixture('suggestions/gemini-voice-batch.json'));
    const res = await agent.post('/api/v1/suggestions/voice').attach('audio', AUDIO, { filename: 'demande.webm', contentType: 'audio/webm' }).expect(200);
    expect(res.body.heard.ingredients).toEqual(['poulet', 'sauce tomate']);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('refuse une requête sans enregistrement, en français', async () => {
    const res = await agent.post('/api/v1/suggestions/voice').expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.message).toMatch(/enregistrement/i);
    expect(http.calls).toHaveLength(0);
  });

  it('refuse un format que le modèle ne sait pas lire (D8)', async () => {
    const res = await agent
      .post('/api/v1/suggestions/voice')
      .attach('audio', AUDIO, { filename: 'demande.mp4', contentType: 'video/mp4' })
      .expect(400);
    expect(res.body.error.message).toMatch(/format/i);
    expect(http.calls).toHaveLength(0);
  });

  it('refuse un enregistrement vide (D9)', async () => {
    const res = await agent
      .post('/api/v1/suggestions/voice')
      .attach('audio', Buffer.alloc(10), { filename: 'vide.webm', contentType: 'audio/webm' })
      .expect(400);
    expect(res.body.error.message).toMatch(/vide/i);
    expect(http.calls).toHaveLength(0);
  });
});
