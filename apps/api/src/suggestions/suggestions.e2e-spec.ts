import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DynamicModule, Global, Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { SuggestionQuery } from '@kitchen/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../common/config.module.js';
import { loadConfig, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipesModule } from '../recipes/recipes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import type { RequestUser } from '../auth/request-user.js';
import { FakeHttp, geminiFixture, json } from '../../test/fake-http.js';
import { truncateAll } from '../../test/db.js';
import { SuggestionsModule } from './suggestions.module.js';
import { SuggestionsService } from './suggestions.service.js';

const USER: RequestUser = { id: 'u1', email: 'franck@example.org', name: 'Franck', role: 'ADMIN', via: 'session', sessionId: 's1' };

/** Contexte Nest minimal (sans HTTP) pour tester `SuggestionsService` seule : le
 * contrôleur n'existe pas encore (tâche 7), donc pas de `createTestApp`/agent ici. */
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

    await expect(service.list(QUERY, USER)).rejects.toMatchObject({ status: 409 });
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
});
