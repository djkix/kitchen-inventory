import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { json } from '../../test/fake-http.js';
import { rattraper } from '../../../../tools/nutriscore-rattrapage.js';

/** Réponse d'Open Food Facts réduite aux deux champs demandés par la commande. */
const offNutrition = (body: unknown) => () => Promise.resolve(json(body));

describe('tools/nutriscore-rattrapage.ts (EF-30)', () => {
  let t: TestApp;
  const lines: string[] = [];
  const out = (line: string) => void lines.push(line);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    lines.length = 0;
  });
  afterAll(() => t.close());

  const seed = async (data: { name: string; barcode: string | null; nutriscoreGrade?: string }) =>
    t.prisma.product.create({ data: { name: data.name, barcode: data.barcode, nutriscoreGrade: data.nutriscoreGrade ?? null } });

  it('renseigne les produits entrés avant la fonctionnalité', async () => {
    const product = await seed({ name: 'Nutella', barcode: '3017620422003' });
    const tally = await rattraper(
      t.prisma,
      { all: false, delayMs: 0, fetch: offNutrition({ status: 1, product: { nutriscore_grade: 'e', nutrient_levels: { salt: 'low', sugars: 'high' } } }) },
      out,
    );
    expect(tally).toMatchObject({ examined: 1, updated: 1, withoutData: 0, failed: 0 });
    const after = await t.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.nutriscoreGrade).toBe('e');
    expect(after.nutrientLevels).toEqual({ salt: 'low', sugars: 'high' });
  });

  it('laisse en place un produit qu’Open Food Facts ne note pas', async () => {
    const product = await seed({ name: 'Shin Ramyun', barcode: '8801043015608' });
    const tally = await rattraper(t.prisma, { all: false, delayMs: 0, fetch: offNutrition({ status: 1, product: { nutriscore_grade: 'unknown' } }) }, out);
    expect(tally).toMatchObject({ examined: 1, updated: 0, withoutData: 1, failed: 0 });
    expect((await t.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).nutriscoreGrade).toBeNull();
  });

  it('ignore les produits sans code-barres et ceux déjà renseignés', async () => {
    await seed({ name: 'Riz en vrac', barcode: null });
    await seed({ name: 'Nutella', barcode: '3017620422003', nutriscoreGrade: 'e' });
    const tally = await rattraper(t.prisma, { all: false, delayMs: 0, fetch: () => Promise.reject(new Error('aucun appel attendu')) }, out);
    expect(tally.examined).toBe(0);
  });

  it('reprend les produits déjà renseignés avec --tout', async () => {
    const product = await seed({ name: 'Nutella', barcode: '3017620422003', nutriscoreGrade: 'e' });
    const tally = await rattraper(t.prisma, { all: true, delayMs: 0, fetch: offNutrition({ status: 1, product: { nutriscore_grade: 'd' } }) }, out);
    expect(tally.updated).toBe(1);
    expect((await t.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).nutriscoreGrade).toBe('d');
  });

  it('compte un échec réseau sans arrêter le catalogue', async () => {
    await seed({ name: 'Aaa', barcode: '3017620422003' });
    await seed({ name: 'Bbb', barcode: '8801043015608' });
    let first = true;
    const tally = await rattraper(
      t.prisma,
      {
        all: false,
        delayMs: 0,
        fetch: () => {
          if (first) {
            first = false;
            return Promise.reject(new Error('ECONNREFUSED'));
          }
          return Promise.resolve(json({ status: 1, product: { nutriscore_grade: 'b' } }));
        },
      },
      out,
    );
    expect(tally).toMatchObject({ examined: 2, updated: 1, failed: 1 });
  });
});
