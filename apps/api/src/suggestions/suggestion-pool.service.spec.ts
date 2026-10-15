import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { suggestionIdentity, type ModelRecipe } from '@kitchen/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../common/config.module.js';
import { loadConfig } from '../common/config.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { truncateAll } from '../../test/db.js';
import { RecipePageRefusedError, type PageRecipe } from './recipe-page.fetcher.js';
import { RECIPE_PAGE_FETCHER } from './suggestion-provider.js';
import { SuggestionPoolService } from './suggestion-pool.service.js';

type Content = { structured: PageRecipe | null; text: string } | null;
interface FakeFetcher {
  fetchContent: (url: string) => Promise<Content>;
}

function webRecipe(title: string, url: string): ModelRecipe {
  return {
    title,
    origin: 'France',
    region: 'europeenne',
    totalMinutes: 30,
    prepMinutes: 10,
    cookMinutes: 20,
    difficulty: 'EASY',
    dishType: 'MAIN',
    provenance: 'web',
    sourceUrl: url,
    steps: [],
    ingredients: [{ label: 'pommes', quantity: 3, unit: null }],
  };
}

function aiRecipe(title: string): ModelRecipe {
  return { ...webRecipe(title, 'https://x.test/a'), provenance: 'ai', sourceUrl: null, steps: ['cuire'] };
}

const WEB = webRecipe('Tarte aux pommes', 'https://203.0.113.20/tarte');
const PAGE: Content = { structured: { title: 'Tarte', ingredients: ['pommes'], steps: ['cuire'] }, text: 'texte' };

describe('SuggestionPoolService.ingest (EF-26)', () => {
  let ctx: INestApplicationContext | null = null;
  afterEach(async () => {
    if (ctx) await ctx.close();
    ctx = null;
  });

  async function setup(fetcher: FakeFetcher): Promise<{ service: SuggestionPoolService; db: PrismaService }> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      SECRET_KEY: 'test-secret-key-test-secret-key-test-secret-key',
      PUBLIC_URL: 'https://inventaire.test',
      MEDIA_DIR: '/tmp/kitchen-pool-test-media',
      LOG_LEVEL: 'silent',
    });
    @Module({
      imports: [ConfigModule.forRoot(config), PrismaModule],
      providers: [SuggestionPoolService, { provide: RECIPE_PAGE_FETCHER, useValue: fetcher }],
    })
    class TestModule {}
    ctx = await NestFactory.createApplicationContext(TestModule, { logger: false, abortOnError: false });
    const db = ctx.get(PrismaService);
    await truncateAll(db);
    return { service: ctx.get(SuggestionPoolService), db };
  }

  it('retient une recette web vérifiée et recopie ses données structurées', async () => {
    const { service, db } = await setup({ fetchContent: async () => PAGE });
    expect(await service.ingest([WEB], 'gemini-test')).toBe(1);
    const row = await db.suggestionPoolRecipe.findUniqueOrThrow({ where: { identity: suggestionIdentity(WEB) } });
    expect(row.verifiedAt).not.toBeNull();
    expect(row.pageRecipe).toEqual(PAGE?.structured);
    expect(row.model).toBe('gemini-test');
  });

  it('retient une recette web sans données structurées, avec son texte', async () => {
    const { service, db } = await setup({ fetchContent: async () => ({ structured: null, text: 'ingrédients : pommes' }) });
    expect(await service.ingest([WEB], 'm')).toBe(1);
    const row = await db.suggestionPoolRecipe.findFirstOrThrow();
    expect(row.pageRecipe).toBeNull();
    expect(row.pageText).toBe('ingrédients : pommes');
  });

  it('jette une recette web dont la page ne répond pas', async () => {
    const { service, db } = await setup({ fetchContent: async () => null });
    expect(await service.ingest([WEB], 'm')).toBe(0);
    expect(await db.suggestionPoolRecipe.count()).toBe(0);
  });

  it('jette une recette refusée ou en erreur, sans faire échouer les autres', async () => {
    const a = webRecipe('A', 'https://203.0.113.1/a');
    const b = webRecipe('B', 'https://203.0.113.2/b');
    const c = webRecipe('C', 'https://203.0.113.3/c');
    const { service, db } = await setup({
      fetchContent: async (url) => {
        if (url.endsWith('/a')) throw new RecipePageRefusedError('refusée');
        if (url.endsWith('/b')) throw new Error('panne imprévue');
        return PAGE;
      },
    });
    expect(await service.ingest([a, b, c], 'm')).toBe(1);
    const rows = await db.suggestionPoolRecipe.findMany();
    expect(rows.map((r) => r.identity)).toEqual([suggestionIdentity(c)]);
  });

  it('entre une composition du modèle sans contacter le réseau', async () => {
    const { service, db } = await setup({
      fetchContent: async () => {
        throw new Error('ne doit pas être appelé');
      },
    });
    expect(await service.ingest([aiRecipe('Salade')], 'm')).toBe(1);
    const row = await db.suggestionPoolRecipe.findFirstOrThrow();
    expect(row.verifiedAt).toBeNull();
    expect(row.pageRecipe).toBeNull();
    expect(row.pageText).toBeNull();
  });

  it('lit les pages en parallèle', async () => {
    let inFlight = 0;
    let peak = 0;
    const { service } = await setup({
      fetchContent: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight -= 1;
        return PAGE;
      },
    });
    const recipes = Array.from({ length: 6 }, (_, i) => webRecipe(`R${i}`, `https://203.0.113.9/r${i}`));
    expect(await service.ingest(recipes, 'm')).toBe(6);
    expect(peak).toBe(6);
  });

  it('ne crée qu’une ligne pour la même recette vue deux fois et avance lastSeenAt', async () => {
    const { service, db } = await setup({ fetchContent: async () => PAGE });
    await service.ingest([WEB], 'm1');
    await new Promise((r) => setTimeout(r, 10));
    await service.ingest([WEB], 'm2');
    const rows = await db.suggestionPoolRecipe.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastSeenAt.getTime()).toBeGreaterThan(rows[0]!.firstSeenAt.getTime());
    expect(rows[0]!.model).toBe('m2');
  });

  it('ne réécrit pas une page déjà lue (D10)', async () => {
    let content: Content = PAGE;
    const { service, db } = await setup({ fetchContent: async () => content });
    await service.ingest([WEB], 'm');
    content = { structured: null, text: 'autre' };
    await service.ingest([WEB], 'm');
    const row = await db.suggestionPoolRecipe.findFirstOrThrow();
    expect(row.pageRecipe).toEqual(PAGE?.structured);
    expect(row.pageText).toBe('texte');
  });

  it('read traite une ligne non conforme comme absente', async () => {
    const { service, db } = await setup({ fetchContent: async () => PAGE });
    await service.ingest([WEB, aiRecipe('Salade')], 'm');
    await db.suggestionPoolRecipe.updateMany({ where: { provenance: 'ai' }, data: { payload: { cassé: true } } });
    const read = await service.read();
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ identity: suggestionIdentity(WEB), verified: true, pageText: 'texte' });
  });
});
