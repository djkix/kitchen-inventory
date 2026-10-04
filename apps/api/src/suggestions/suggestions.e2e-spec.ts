import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DynamicModule, Global, Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { suggestionIdentities, suggestionIdentity, type ModelRecipe, type SuggestionQuery } from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../common/config.module.js';
import { loadConfig, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import type { RequestUser } from '../auth/request-user.js';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { createProduct, createStock } from '../../test/recipes.test-helpers.js';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { truncateAll } from '../../test/db.js';
import { SuggestionsModule } from './suggestions.module.js';
import { SuggestionsService } from './suggestions.service.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

const USER: RequestUser = { id: 'u1', email: 'franck@example.org', name: 'Franck', role: 'ADMIN', via: 'session', sessionId: 's1' };

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
      imports: [ConfigModule.forRoot(config), PrismaModule, SettingsModule, RecipesModule, SuggestionsModule],
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
    ...overrides,
  });
}

async function fixtureText(file: string): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../../test/fixtures', file), 'utf8');
}

async function fixtureHtml(file: string): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../../test/fixtures/suggestions', file), 'utf8');
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
    modelVersion: 'gemini-3.5-pro',
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
    return { service: ctx.get(SuggestionsService), db };
  }

  /**
   * `keep` écrit `createdById` (tâche 9) : contrairement à `list`, qui ne
   * persiste rien au nom de l'utilisateur, il faut ici un `User` réel en base
   * pour que la contrainte de clé étrangère soit respectée.
   */
  async function seedUser(db: PrismaService): Promise<RequestUser> {
    const user = await db.user.create({ data: { email: 'franck.keep@example.org', name: 'Franck', passwordHash: 'x', role: 'ADMIN' } });
    return { id: user.id, email: user.email, name: user.name, role: 'ADMIN', via: 'session', sessionId: 's1' };
  }

  async function seedLocation(db: PrismaService): Promise<string> {
    const location = await db.location.create({ data: { name: 'Test', path: '/test', depth: 0 } });
    return location.id;
  }

  async function seedProduct(
    db: PrismaService,
    locationId: string,
    opts: { name: string; categoryId?: string | null; quantity: number; unit?: string },
  ): Promise<string> {
    const unit = opts.unit ?? 'GRAM';
    const product = await db.product.create({ data: { name: opts.name, categoryId: opts.categoryId ?? null, defaultUnit: unit as never } });
    await db.stockItem.create({ data: { productId: product.id, locationId, quantity: opts.quantity, unit: unit as never } });
    return product.id;
  }

  /** Dépose directement une fournée en base (tâche 9) : la conservation lit un lot déjà rendu, pas besoin de rejouer `list`. */
  async function seedBatch(db: PrismaService, recipes: ModelRecipe[]): Promise<string> {
    const row = await db.suggestionBatch.create({
      data: {
        signature: `test-keep-${Math.random().toString(36).slice(2)}`,
        payload: { recipes } as unknown as Prisma.InputJsonValue,
        model: 'test-model',
        costCents: null,
      },
    });
    return row.id;
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
    await service.list(QUERY, USER);

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

    await expect(service.list(QUERY, USER)).rejects.toMatchObject({ status: 409, code: 'insufficient_stock' });
    try {
      await service.list(QUERY, USER);
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
    const result = await service.list(QUERY, USER);

    const ingredient = result.items[0]?.ingredients[0];
    expect(ingredient?.match).toBe('probable');
    expect(ingredient?.productName).toBe('Crème fraîche épaisse 30%');
  });

  it('compte un rapprochement probable comme disponible dans la couverture', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });
    await seedProduct(db, locationId, { name: 'Crème fraîche épaisse 30%', quantity: 500, unit: 'MILLILITER' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const result = await service.list(QUERY, USER);

    expect(result.items[0]?.ingredients[0]?.state).toBe('available');
    expect(result.items[0]?.group).toBe('ready');
  });

  it('sert la fournée en cache tant que la signature est identique (B12)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const first = await service.list(QUERY, USER);
    const second = await service.list(QUERY, USER);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.batchId).toBe(first.batchId);
    expect(http.calls).toHaveLength(1);
  });

  it('relance une recherche quand l’orientation change (B9)', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-a.json'));
    const first = await service.list(QUERY, USER);
    http.reset();
    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-orientation-b.json'));
    const second = await service.list({ refresh: false, region: 'asiatique' }, USER);

    expect(first.items[0]?.title).toBe('Recette orientation A');
    expect(second.items[0]?.title).toBe('Recette orientation B');
    expect(second.fromCache).toBe(false);
  });

  it('relance une recherche quand refresh est demandé', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    await service.list(QUERY, USER);
    const second = await service.list({ refresh: true }, USER);

    expect(second.fromCache).toBe(false);
    expect(http.calls).toHaveLength(2);
  });

  it('met en cache séparément chaque orientation', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', (url, init) => {
      const body = JSON.parse(String(init?.body));
      const text = body.contents[0].parts[0].text as string;
      const file = text.includes('asiatique') || text.includes('Asiatique') ? 'suggestions/gemini-batch-orientation-b.json' : 'suggestions/gemini-batch-orientation-a.json';
      return geminiFixture(file);
    });

    await service.list({ refresh: false, region: 'europeenne' }, USER);
    await service.list({ refresh: false, region: 'asiatique' }, USER);
    const third = await service.list({ refresh: false, region: 'europeenne' }, USER);

    expect(third.fromCache).toBe(true);
    expect(http.calls).toHaveLength(2);
  });

  it('refuse l’appel au-delà du quota journalier, en servant la dernière fournée', async () => {
    const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '1' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const first = await service.list({ refresh: false, maxMinutes: 15 }, USER);
    const second = await service.list({ refresh: false, maxMinutes: 30 }, USER);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.notice).toMatch(/quota/i);
    expect(http.calls).toHaveLength(1);
  });

  it('refuse l’appel au-delà du plafond mensuel, en servant la dernière fournée', async () => {
    const { service, db } = await createService({ VISION_MONTHLY_CAP_CENTS: '1' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => costlyFixture('suggestions/gemini-batch-creme.json', 5000));
    const first = await service.list({ refresh: false, maxMinutes: 15 }, USER);
    const second = await service.list({ refresh: false, maxMinutes: 30 }, USER);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.notice).toMatch(/plafond/i);
    expect(http.calls).toHaveLength(1);
  });

  it('refuse l’appel au-delà du quota journalier sans promettre de fournée quand aucune n’existe (round 1, EF-26)', async () => {
    // Quota dépassé dès le premier appel : aucune fournée n'a jamais été stockée,
    // `readLatestBatch` ne peut donc rien servir. Le message d'erreur ne doit
    // jamais prétendre afficher « la dernière fournée connue » dans ce cas.
    const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '0' });
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    await expect(service.list(QUERY, USER)).rejects.toMatchObject({ status: 429 });
    try {
      await service.list(QUERY, USER);
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
    await service.list(QUERY, USER);

    const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ provider: 'gemini', succeeded: true });
  });

  it('rend des identifiants de suggestion stables d’une fournée à l’autre', async () => {
    const { service, db } = await createService();
    const locationId = await seedLocation(db);
    await seedProduct(db, locationId, { name: 'Tomate', quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    // Deux orientations : deux fournées distinctes en base, mêmes recettes rendues.
    const first = await service.list({ refresh: false, maxMinutes: 15 }, USER);
    const second = await service.list({ refresh: false, maxMinutes: 30 }, USER);

    expect(first.batchId).not.toBe(second.batchId);
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
    await service.list(QUERY, USER);

    expect(http.calls).toHaveLength(2);
    const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.succeeded)).toEqual([false, true]);

    // gemini-3.5-pro : 2 $/Mtok en entrée, 12 $/Mtok en sortie, 500 jetons d'entrée par appel.
    const cost = (out: number) => Math.round(((500 * 2 + out * 12) / 1_000_000) * 100 * 10_000) / 10_000;
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
    await expect(service.list(QUERY, USER)).rejects.toMatchObject({ status: 502 });

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
    const result = await service.list(QUERY, USER);

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
    const result = await service.list(QUERY, USER);

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
      difficulty: 'HARD',
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
      difficulty: 'EASY',
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

    it('conserve une recette web : page lue, contenu réécrit par Gemini, source IMPORTED', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);
      const html = await fixtureHtml('page-schema-simple.html');
      http.on(WEB_RECIPE_HOST, () => htmlResponse(html));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const recipe = await service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-web-000001' }, keeper);

      expect(recipe.source).toBe('IMPORTED');
      expect(recipe.sourceUrl).toBe(WEB_RECIPE.sourceUrl);
      expect(recipe.title).toBe('Tarte aux pommes (réécrite)');
      expect(recipe.steps.length).toBeGreaterThan(0);
      expect(http.calls.some((c) => c.url.includes('generateContent'))).toBe(true);
    });

    it('journalise la réécriture dans le même registre que les fournées, avec son coût (Important 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);
      const html = await fixtureHtml('page-schema-simple.html');
      http.on(WEB_RECIPE_HOST, () => htmlResponse(html));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      await service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-ledger-00001' }, keeper);

      const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' }, orderBy: { createdAt: 'asc' } });
      const rewriteLog = logs.find((l) => l.succeeded && l.provider === 'gemini');
      expect(rewriteLog).toBeDefined();
      expect(rewriteLog?.costCents?.toNumber()).not.toBeNull();
      expect(rewriteLog?.costCents?.toNumber()).toBeGreaterThan(0);
    });

    it('garde provider_unavailable pour un échec de transport ou de statut du réécriveur (round 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);
      const html = await fixtureHtml('page-schema-simple.html');
      http.on(WEB_RECIPE_HOST, () => htmlResponse(html));
      http.on('generateContent', () => json({ error: 'en panne' }, 500));

      await expect(service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-transport-01' }, keeper)).rejects.toMatchObject({
        status: 502,
        code: 'provider_unavailable',
      });
    });

    it('donne provider_invalid_response quand Gemini répond mais hors schéma (round 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);
      const html = await fixtureHtml('page-schema-simple.html');
      http.on(WEB_RECIPE_HOST, () => htmlResponse(html));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-invalide.json'));

      await expect(service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-invalide-01' }, keeper)).rejects.toMatchObject({
        status: 502,
        code: 'provider_invalid_response',
      });
    });

    it('un rejeu conserve sans aucun appel réseau ni nouvelle ligne de registre (round 2)', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);
      const html = await fixtureHtml('page-schema-simple.html');
      http.on(WEB_RECIPE_HOST, () => htmlResponse(html));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const first = await service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-rejeu-00001' }, keeper);
      http.reset();

      const second = await service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-rejeu-00001' }, keeper);

      expect(second.id).toBe(first.id);
      expect(http.calls).toHaveLength(0);
      const logs = await db.recognitionLog.findMany({ where: { purpose: 'RECIPE_SUGGESTION' } });
      expect(logs).toHaveLength(1);
      expect(await db.recipe.count()).toBe(1);
    });

    it('refuse la réécriture au-delà du quota journalier, sans créer de recette', async () => {
      const { service, db } = await createService({ RECIPE_SUGGESTION_DAILY_QUOTA: '0' });
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);

      await expect(service.keep({ batchId, suggestionId: WEB_ID }, keeper)).rejects.toMatchObject({ status: 429 });
      expect(http.calls).toHaveLength(0);
      expect(await db.recipe.count()).toBe(0);
    });

    it('conserve une composition sans appeler le réseau, source GENERATED', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE, AI_RECIPE]);

      const recipe = await service.keep({ batchId, suggestionId: AI_ID, clientOpId: 'op-keep-ai-0000001' }, keeper);

      expect(recipe.source).toBe('GENERATED');
      expect(recipe.sourceUrl).toBeNull();
      expect(recipe.title).toBe('Riz sauté maison');
      expect(http.calls).toHaveLength(0);
    });

    it('recalcule la difficulté avec le barème du foyer à la conservation (B15)', async () => {
      // la suggestion annonçait HARD, les étapes conservées donnent INTERMEDIATE
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [WEB_RECIPE]);
      const html = await fixtureHtml('page-schema-simple.html');
      http.on(WEB_RECIPE_HOST, () => htmlResponse(html));
      http.on('generateContent', () => geminiFixture('suggestions/gemini-rewrite-tarte.json'));

      const recipe = await service.keep({ batchId, suggestionId: WEB_ID, clientOpId: 'op-keep-diff-0000001' }, keeper);

      expect(recipe.difficulty).toBe('INTERMEDIATE');
      expect(recipe.difficultyOverride).toBe(false);
    });

    it('rattache les ingrédients aux produits rapprochés, laisse les autres en texte libre', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const locationId = await seedLocation(db);
      await seedProduct(db, locationId, { name: 'Riz', quantity: 500, unit: 'GRAM' });
      const batchId = await seedBatch(db, [WEB_RECIPE, AI_RECIPE]);

      const recipe = await service.keep({ batchId, suggestionId: AI_ID, clientOpId: 'op-keep-match-0000001' }, keeper);

      const riz = recipe.ingredients.find((i) => i.label === 'Riz');
      const mystere = recipe.ingredients.find((i) => i.label === 'Épice mystère introuvable');
      expect(riz?.productId).not.toBeNull();
      expect(riz?.productName).toBe('Riz');
      expect(mystere?.productId).toBeNull();
    });

    it('échoue en français quand la page ne répond pas, sans créer de recette', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const unreachable: ModelRecipe = { ...WEB_RECIPE, sourceUrl: `https://${UNREACHABLE_HOST}/injoignable` };
      const batchId = await seedBatch(db, [unreachable]);
      http.fail(UNREACHABLE_HOST);

      await expect(service.keep({ batchId, suggestionId: suggestionIdentity(unreachable) }, keeper)).rejects.toMatchObject({ status: 502 });
      try {
        await service.keep({ batchId, suggestionId: suggestionIdentity(unreachable) }, keeper);
      } catch (error) {
        expect(String((error as Error).message)).toMatch(/page/i);
      }
      expect(await db.recipe.count()).toBe(0);
    });

    it('désigne la suggestion par son contenu, jamais par son rang dans la fournée', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [AI_RECIPE]);

      // Le rang « 0 » ne désigne plus rien : un tiroir resté ouvert sur une
      // fournée précédente ne peut plus conserver la recette d'une autre.
      await expect(service.keep({ batchId, suggestionId: '0' }, keeper)).rejects.toMatchObject({ status: 404 });
      await expect(service.keep({ batchId, suggestionId: WEB_ID }, keeper)).rejects.toMatchObject({ status: 404 });

      const kept = await service.keep({ batchId, suggestionId: AI_ID, clientOpId: 'op-keep-identite-001' }, keeper);
      expect(kept.title).toBe('Riz sauté maison');
    });

    it('est idempotente : deux conservations du même clientOpId ne créent qu’une recette', async () => {
      const { service, db } = await createService();
      const keeper = await seedUser(db);
      const batchId = await seedBatch(db, [AI_RECIPE]);

      const first = await service.keep({ batchId, suggestionId: AI_ID, clientOpId: 'op-keep-idempotent-01' }, keeper);
      const second = await service.keep({ batchId, suggestionId: AI_ID, clientOpId: 'op-keep-idempotent-01' }, keeper);

      expect(second.id).toBe(first.id);
      expect(await db.recipe.count()).toBe(1);
    });

    it('conserve la bonne recette quand deux compositions IA partagent le même titre (EF-26)', async () => {
      // Le modèle compose souvent à partir des mêmes quelques ingrédients du
      // stock : deux « Riz sauté » distinctes dans la même fournée sont
      // plausibles. Leurs étapes et ingrédients diffèrent ici pour que la
      // recette effectivement créée soit identifiable sans ambiguïté.
      const RIZ_PREMIERE: ModelRecipe = {
        title: 'Riz sauté',
        origin: 'Composition',
        region: 'asiatique',
        totalMinutes: 15,
        difficulty: 'EASY',
        provenance: 'ai',
        sourceUrl: null,
        steps: ['Cuire le riz nature.'],
        ingredients: [{ label: 'Riz', quantity: 200, unit: 'GRAM' }],
      };
      const RIZ_SECONDE: ModelRecipe = {
        title: 'Riz sauté',
        origin: 'Composition',
        region: 'asiatique',
        totalMinutes: 25,
        difficulty: 'EASY',
        provenance: 'ai',
        sourceUrl: null,
        steps: ["Faire revenir le riz à l'huile d'olive avec les légumes."],
        ingredients: [
          { label: 'Riz', quantity: 200, unit: 'GRAM' },
          { label: "Huile d'olive", quantity: 1, unit: 'MILLILITER' },
        ],
      };
      const batch = [RIZ_PREMIERE, RIZ_SECONDE];
      const [firstId, secondId] = suggestionIdentities(batch);
      expect(firstId).not.toBe(secondId);

      // Conserver la seconde occurrence : la recette créée doit être la seconde,
      // identifiable à ses étapes et à son huile d'olive, jamais la première.
      const { service: serviceA, db: dbA } = await createService();
      const keeperA = await seedUser(dbA);
      const batchIdA = await seedBatch(dbA, batch);

      const keptSecond = await serviceA.keep({ batchId: batchIdA, suggestionId: secondId!, clientOpId: 'op-keep-riz-doublon-second' }, keeperA);
      expect(keptSecond.steps).toEqual(RIZ_SECONDE.steps);
      expect(keptSecond.ingredients.some((i) => i.label === "Huile d'olive")).toBe(true);

      // Dans une autre fournée identique, conserver la première occurrence : le
      // test ne doit pas pouvoir passer en choisissant toujours la même extrémité.
      const { service: serviceB, db: dbB } = await createService();
      const keeperB = await seedUser(dbB);
      const batchIdB = await seedBatch(dbB, batch);

      const keptFirst = await serviceB.keep({ batchId: batchIdB, suggestionId: firstId!, clientOpId: 'op-keep-riz-doublon-first' }, keeperB);
      expect(keptFirst.steps).toEqual(RIZ_PREMIERE.steps);
      expect(keptFirst.ingredients.some((i) => i.label === "Huile d'olive")).toBe(false);
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
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
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

  it('rend une fournée avec son identifiant et son horodatage', async () => {
    const productId = await createProduct(agent, { name: 'Tomate' });
    const placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
    await createStock(agent, { productId, locationId: placardId, quantity: 5, unit: 'PIECE' });

    http.on('generateContent', () => geminiFixture('suggestions/gemini-batch-creme.json'));
    const res = await agent.get('/api/v1/suggestions').expect(200);

    expect(typeof res.body.batchId).toBe('string');
    expect(res.body.batchId.length).toBeGreaterThan(0);
    expect(() => new Date(res.body.generatedAt).toISOString()).not.toThrow();
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});

describe('GET /suggestions, fournisseur désactivé (EF-26, tâche 7)', () => {
  it('dit en français que le fournisseur n’est pas configuré', async () => {
    const t = await createTestApp({ VISION_PROVIDER: 'none' });
    try {
      await t.reset();
      const agent = t.agent();
      await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);

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
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
  });
  afterAll(() => t.close());

  async function seedBatchHttp(recipes: ModelRecipe[]): Promise<string> {
    const row = await t.prisma.suggestionBatch.create({
      data: { signature: `wire-${Math.random().toString(36).slice(2)}`, payload: { recipes } as unknown as Prisma.InputJsonValue, model: 'test-model', costCents: null },
    });
    return row.id;
  }

  /**
   * Le 422/502 vu depuis le fil (revue de tâche 9) : un refus de sécurité
   * (lien non-https ou adresse privée) et une page qui ne répond pas ne
   * doivent pas se confondre dans la même réponse — vérifié ici sur le
   * contrôleur entier, pas seulement sur l'erreur levée par le service.
   */
  it('refuse 422 quand le lien de la recette vise une adresse privée', async () => {
    const recipe: ModelRecipe = {
        title: 'Recette suspecte',
        origin: 'Cuisine Test',
        region: 'europeenne',
        totalMinutes: 20,
        difficulty: 'EASY',
        provenance: 'web',
        sourceUrl: 'https://192.168.1.50/recette',
        steps: [],
        ingredients: [{ label: 'Mystère', quantity: null, unit: null }],
    };
    const batchId = await seedBatchHttp([recipe]);

    const res = await agent.post('/api/v1/suggestions/keep').send({ batchId, suggestionId: suggestionIdentity(recipe) }).expect(422);
    expect(res.body.error.code).toBe('business_rule');
  });

  it('refuse 502 quand la page de la recette ne répond pas', async () => {
    const recipe: ModelRecipe = {
        title: 'Recette injoignable',
        origin: 'Cuisine Test',
        region: 'europeenne',
        totalMinutes: 20,
        difficulty: 'EASY',
        provenance: 'web',
        sourceUrl: `https://${UNREACHABLE_HOST}/injoignable`,
        steps: [],
        ingredients: [{ label: 'Mystère', quantity: null, unit: null }],
    };
    const batchId = await seedBatchHttp([recipe]);
    http.fail(UNREACHABLE_HOST);

    const res = await agent.post('/api/v1/suggestions/keep').send({ batchId, suggestionId: suggestionIdentity(recipe) }).expect(502);
    expect(res.body.error.code).toBe('provider_unavailable');
  });

  it('conserve une composition sans réseau et rend la recette créée (201)', async () => {
    const recipe: ModelRecipe = {
        title: 'Riz sauté express',
        origin: 'Composition',
        region: 'asiatique',
        totalMinutes: 15,
        difficulty: 'EASY',
        provenance: 'ai',
        sourceUrl: null,
        steps: ['Cuire le riz.', 'Mélanger le tout.'],
        ingredients: [{ label: 'Riz', quantity: 200, unit: 'GRAM' }],
    };
    const batchId = await seedBatchHttp([recipe]);

    const res = await agent.post('/api/v1/suggestions/keep').send({ batchId, suggestionId: suggestionIdentity(recipe) }).expect(201);
    expect(res.body.source).toBe('GENERATED');
    expect(res.body.title).toBe('Riz sauté express');
  });
});
