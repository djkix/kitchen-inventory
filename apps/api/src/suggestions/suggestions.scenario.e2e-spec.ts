import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type TestAgent from 'supertest/lib/agent.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../test/app.factory.js';
import { createProduct, createStock } from '../../test/recipes.test-helpers.js';
import { FakeHttp, geminiFixture } from '../../test/fake-http.js';

const ADMIN = { email: 'franck@example.org', name: 'Franck', password: 'un-mot-de-passe-long' };

/** Hôte IP littéral (RFC 5737) : atteint sans résolution DNS, pour qu'aucun test ne dépende du réseau (section 19). */
const WEB_RECIPE_HOST = '203.0.113.20';

async function fixtureHtml(file: string): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../../test/fixtures/suggestions', file), 'utf8');
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/**
 * Scénario de réussite figé des suggestions (B16, EF-26). Stock, orientation, quota
 * et fournée du modèle entièrement figés ; résultat écrit d'avance, recette par
 * recette. Ce test échoue si la sélection des ingrédients de départ, le
 * rapprochement au stock, le calcul de couverture ou la difficulté recalculée à la
 * conservation changent sans décision explicite.
 *
 * Stock : spaghettis 500 g · sauce tomate 400 g · parmesan 200 g · huile d'olive
 * 500 ml · sel (1 paquet) · paprika 1 sachet (catégorie « Épices et aromates ») ·
 * riz 1 kg. Le sel est exclu de la sélection de départ par son nom, le paprika par
 * sa catégorie (B5) — les deux restent par ailleurs des produits du stock, et
 * peuvent donc être rapprochés comme n'importe quel autre s'ils sont cités par une
 * recette (recette 11). Le seuil d'alerte de péremption (7 jours), le quota
 * journalier de suggestions (10) et le plafond de dépense mensuel (0, désactivé)
 * sont fixés explicitement : aucun lot de stock ne porte de DLC ici et aucun coût
 * n'est en jeu, mais une valeur par défaut qui changerait un jour ne doit pas
 * faire dériver ce scénario en silence.
 *
 * Fournée Gemini figée (`gemini-batch-scenario-pates.json`) : douze recettes, huit
 * web puis quatre composées — exactement les quotas visés (`SUGGESTION_WEB_TARGET`,
 * `SUGGESTION_AI_TARGET`), sans troncature ni complément à calculer. Toutes les
 * quantités d'ingrédients sont `null` : seule la présence ou l'absence d'un
 * rapprochement au stock détermine la couverture, jamais une conversion d'unité.
 *
 * - Recette 1 « Spaghetti à la tomate » (web) : spaghettis, sauce tomate, parmesan,
 *   tous rapprochés sûr → couverture 1, prête.
 * - Recette 2 « Riz au parmesan râpé » (web) : riz (sûr), « parmesan râpé »
 *   (probable, trigramme) → couverture 1, prête.
 * - Recette 3 « Pâtes à l'huile et au basilic » (web) : 2 sûrs, « Basilic frais »
 *   absent → couverture 2/3 ≈ 0,67, presque.
 * - Recette 4 « Gratin à la crème de parmesan » (web) : « crème » absent (aucun
 *   produit de ce nom en stock), parmesan sûr → couverture 1/2 = 0,5, exclue (sous
 *   le seuil de 0,6).
 * - Recette 5 « Riz pilaf nature » (web) : riz sûr, « Spaghettis complets au blé »
 *   probable (score pg_trgm = 11/27 ≈ 0,4074, juste au-dessus du seuil 0,40),
 *   « Spaghettis complets de riz complet » absent (score = 11/28 ≈ 0,3929, juste
 *   en dessous) — ces deux derniers encadrent `MATCH_SIMILARITY_FLOOR` à dessein
 *   (voir le commentaire du test correspondant pour l'arithmétique, vérifiée par
 *   `show_trgm`) → couverture 2/3 ≈ 0,67, presque.
 * - Recette 6 « Tomates farcies au riz et à la viande » (web) : 2 sûrs, « Viande
 *   hachée » absente → couverture 2/3 ≈ 0,67, presque.
 * - Recette 7 « Salade exotique mangue avocat » (web) : mangue et avocat, tous deux
 *   absents → couverture 0, exclue.
 * - Recette 8 « Huile d'olive aromatisée » (web) : huile d'olive seule, sûre →
 *   couverture 1, prête.
 * - Recette 9 « Riz sauté maison » (ai) : riz et sauce tomate, sûrs → couverture 1,
 *   prête.
 * - Recette 10 « Pâtes au parmesan et au beurre » (ai) : 2 sûrs, « Beurre » absent
 *   → couverture 2/3 ≈ 0,67, presque.
 * - Recette 11 « Riz épicé à l'huile et au paprika » (ai) : riz, huile, paprika —
 *   tous sûrs (le paprika, écarté de la sélection de départ, reste un produit du
 *   stock comme un autre pour le rapprochement) → couverture 1, prête.
 * - Recette 12 « Dessert improvisé au chocolat » (ai) : chocolat seul, absent →
 *   couverture 0, exclue.
 *
 * Conserver la première recette (web, « Spaghetti à la tomate ») déclenche la
 * lecture de sa page puis sa réécriture par Gemini (fixtures déjà utilisées par
 * `suggestions.e2e-spec.ts` : `page-schema-simple.html`, `gemini-rewrite-tarte.json`,
 * huit étapes, aucune technique détectée) : la recette créée est `IMPORTED`, avec
 * une difficulté `INTERMEDIATE` recalculée au barème du foyer — jamais le `HARD`
 * annoncé par la fournée.
 */
describe('scénario de réussite figé des suggestions', () => {
  let t: TestApp;
  let agent: TestAgent;
  let http: FakeHttp;

  beforeAll(async () => {
    http = new FakeHttp();
    t = await createTestApp(
      {
        VISION_PROVIDER: 'gemini',
        VISION_API_KEY: 'AIza-test',
        // Quota et plafond fixés explicitement : une valeur par défaut qui
        // changerait un jour ne doit pas faire dériver ce scénario en silence.
        RECIPE_SUGGESTION_DAILY_QUOTA: '10',
        VISION_MONTHLY_CAP_CENTS: '0',
      },
      http.client,
    );
  });
  afterAll(() => t.close());

  /** Sème exactement le stock décrit dans l'en-tête. */
  async function seedScenario(): Promise<void> {
    const placardId = (await t.prisma.location.findUniqueOrThrow({ where: { path: '/cuisine/placard' } })).id;
    const epices = await t.prisma.category.findFirstOrThrow({ where: { name: 'Épices et aromates' } });

    await agent.patch('/api/v1/settings').send({ expiryAlertDays: 7 }).expect(200);

    const spaghettis = await createProduct(agent, { name: 'Spaghettis', defaultUnit: 'GRAM' });
    const sauceTomate = await createProduct(agent, { name: 'Sauce tomate', defaultUnit: 'GRAM' });
    const parmesan = await createProduct(agent, { name: 'Parmesan', defaultUnit: 'GRAM' });
    const huile = await createProduct(agent, { name: "Huile d'olive", defaultUnit: 'MILLILITER' });
    // Sel et paprika : écartés de la sélection de départ (B5), l'un par son nom,
    // l'autre par sa catégorie — jamais par une absence du stock.
    const sel = await createProduct(agent, { name: 'Sel', defaultUnit: 'PACK' });
    const paprika = await createProduct(agent, { name: 'Paprika', defaultUnit: 'SACHET', categoryId: epices.id });
    const riz = await createProduct(agent, { name: 'Riz', defaultUnit: 'GRAM' });

    await createStock(agent, { productId: spaghettis, locationId: placardId, quantity: 500, unit: 'GRAM' });
    await createStock(agent, { productId: sauceTomate, locationId: placardId, quantity: 400, unit: 'GRAM' });
    await createStock(agent, { productId: parmesan, locationId: placardId, quantity: 200, unit: 'GRAM' });
    await createStock(agent, { productId: huile, locationId: placardId, quantity: 500, unit: 'MILLILITER' });
    await createStock(agent, { productId: sel, locationId: placardId, quantity: 1, unit: 'PACK' });
    await createStock(agent, { productId: paprika, locationId: placardId, quantity: 1, unit: 'SACHET' });
    await createStock(agent, { productId: riz, locationId: placardId, quantity: 1000, unit: 'GRAM' });
  }

  /**
   * Un seul point d'entrée `generateContent`, distingué par le contenu du
   * prompt (même procédé que `suggestions.e2e-spec.ts`, test « orientation ») :
   * la recherche de fournée porte « Ingrédients disponibles dans le foyer »,
   * la réécriture d'une recette conservée porte « Titre de la recette proposé ».
   */
  function wireModel(): void {
    http.on('generateContent', (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const text = body.contents[0].parts[0].text as string;
      if (text.includes('Titre de la recette proposé')) return geminiFixture('suggestions/gemini-rewrite-tarte.json');
      return geminiFixture('suggestions/gemini-batch-scenario-pates.json');
    });
    http.on(WEB_RECIPE_HOST, async () => htmlResponse(await fixtureHtml('page-schema-simple.html')));
  }

  beforeEach(async () => {
    await t.reset();
    http.reset();
    agent = t.agent();
    await agent.post('/api/v1/auth/setup').send(ADMIN).expect(201);
    await seedScenario();
    wireModel();
  });

  it('sélectionne les cinq produits structurants, sans le sel ni le paprika', async () => {
    await agent.get('/api/v1/suggestions').expect(200);

    const call = http.calls.find((c) => c.url.includes('generateContent'));
    const body = JSON.parse(String(call?.init?.body));
    const prompt = body.contents[0].parts[0].text as string;

    expect(prompt).toContain("Ingrédients disponibles dans le foyer : Huile d'olive, Parmesan, Riz, Sauce tomate, Spaghettis.");
    expect(prompt).not.toMatch(/\bSel\b/);
    expect(prompt).not.toMatch(/\bPaprika\b/);
  });

  it('rend la fournée attendue, recette par recette', async () => {
    const res = await agent.get('/api/v1/suggestions').expect(200);

    const expected = [
      { title: 'Spaghetti à la tomate', group: 'ready', coverage: 1, missingLabels: [] },
      { title: 'Riz au parmesan râpé', group: 'ready', coverage: 1, missingLabels: [] },
      { title: "Pâtes à l'huile et au basilic", group: 'almost', coverage: 0.67, missingLabels: ['Basilic frais'] },
      { title: 'Gratin à la crème de parmesan', group: 'excluded', coverage: 0.5, missingLabels: ['crème'] },
      { title: 'Riz pilaf nature', group: 'almost', coverage: 0.67, missingLabels: ['Spaghettis complets de riz complet'] },
      { title: 'Tomates farcies au riz et à la viande', group: 'almost', coverage: 0.67, missingLabels: ['Viande hachée'] },
      { title: 'Salade exotique mangue avocat', group: 'excluded', coverage: 0, missingLabels: ['Mangue', 'Avocat'] },
      { title: "Huile d'olive aromatisée", group: 'ready', coverage: 1, missingLabels: [] },
      { title: 'Riz sauté maison', group: 'ready', coverage: 1, missingLabels: [] },
      { title: 'Pâtes au parmesan et au beurre', group: 'almost', coverage: 0.67, missingLabels: ['Beurre'] },
      { title: 'Riz épicé à l\'huile et au paprika', group: 'ready', coverage: 1, missingLabels: [] },
      { title: 'Dessert improvisé au chocolat', group: 'excluded', coverage: 0, missingLabels: ['Chocolat'] },
    ];

    expect(
      res.body.items.map((item: Record<string, unknown>) => ({
        title: item.title,
        group: item.group,
        coverage: item.coverage,
        missingLabels: item.missingLabels,
      })),
    ).toEqual(expected);

    // Cinq recettes prêtes, quatre presque, trois exclues (A8) : vérifié aussi en
    // bloc, pour que l'énumération ci-dessus et le compte global ne divergent jamais.
    expect(res.body.items.filter((i: { group: string }) => i.group === 'ready')).toHaveLength(5);
    expect(res.body.items.filter((i: { group: string }) => i.group === 'almost')).toHaveLength(4);
    expect(res.body.items.filter((i: { group: string }) => i.group === 'excluded')).toHaveLength(3);
  });

  it('rapproche « crème » en absent et « parmesan râpé » en probable', async () => {
    const res = await agent.get('/api/v1/suggestions').expect(200);

    const gratin = res.body.items[3];
    expect(gratin.title).toBe('Gratin à la crème de parmesan');
    const creme = gratin.ingredients.find((i: { label: string }) => i.label === 'crème');
    expect(creme?.match).toBe('absent');
    expect(creme?.productId).toBeNull();

    const rizParmesan = res.body.items[1];
    expect(rizParmesan.title).toBe('Riz au parmesan râpé');
    const parmesanRape = rizParmesan.ingredients.find((i: { label: string }) => i.label === 'parmesan râpé');
    expect(parmesanRape?.match).toBe('probable');
    expect(parmesanRape?.productName).toBe('Parmesan');
  });

  /**
   * « parmesan râpé » (ci-dessus) vaut ≈ 0,64 contre « Parmesan » : largement
   * au-dessus du seuil, ce qui prouve qu'un seuil existe mais pas où il est
   * exactement. Les deux libellés ci-dessous encadrent `MATCH_SIMILARITY_FLOOR`
   * (0,40) lui-même, à dessein : il suffirait de le relever de 0,0074 ou de
   * l'abaisser de 0,0071 pour inverser le verdict de l'un des deux.
   *
   * pg_trgm découpe une chaîne en mots (séparés par les espaces), complète
   * chaque mot de deux blancs en tête et un en fin, en tire les trigrammes
   * (fenêtre glissante de 3 caractères, jamais à cheval sur un espace), puis
   * prend l'union de ces trigrammes pour toute la chaîne — jamais une seule
   * fenêtre glissante sur la chaîne entière. Les deux libellés ci-dessous
   * commencent par le mot « Spaghettis » (nom exact du produit en stock) :
   * ses 11 trigrammes se retrouvent donc tels quels dans l'union du libellé,
   * et comme le produit n'apporte rien d'autre, `word_similarity` se réduit
   * à 11 / (nombre de trigrammes distincts du libellé entier) :
   *   - trigrammes(« spaghettis ») = {"  s"," sp","spa","pag","agh","ghe",
   *     "het","ett","tti","tis","is "} → 11.
   *   - « Spaghettis complets au blé » : mots « complets » (9 trigrammes),
   *     « au » (3), « blé » (4), aucun ne partage de trigramme avec un autre
   *     mot → union = 11 + 9 + 3 + 4 = 27.
   *     score = 11 / 27 ≈ 0,4074 → au-dessus du seuil → probable. (Vérifié
   *     avec `word_similarity` directement sur la base de test : 0,4074074.)
   *   - « Spaghettis complets de riz complet » : mots « complets » (9),
   *     « de » (3), « riz » (4), « complet » (8, sans le « s » final). Les deux
   *     derniers mots partagent la même racine : « complet » = {"  c"," co",
   *     "com","omp","mpl","ple","let","et "}, dont les 7 premiers sont déjà
   *     dans « complets » — seul "et " est nouveau ("ets" et "ts " restent
   *     propres à « complets »). Leur union ne vaut donc que 7 + 2 + 1 = 10,
   *     pas 9 + 8 = 17 : union totale = 11 + 10 + 3 + 4 = 28.
   *     score = 11 / 28 ≈ 0,3929 → en dessous du seuil → absent. (Vérifié de
   *     même : 0,39285713.)
   * Les deux marges valent donc 0,0074 au-dessus (0,4074 − 0,40) et 0,0071 en
   * dessous (0,40 − 0,3929) : relever ou abaisser le seuil d'autant inverserait
   * le verdict de l'un des deux — contrairement à « parmesan râpé », loin du
   * seuil, ce couple épingle la valeur 0,40 elle-même, pas seulement son
   * existence.
   */
  it('encadre le seuil de similarité : juste au-dessus résout probable, juste en dessous résout absent', async () => {
    const res = await agent.get('/api/v1/suggestions').expect(200);

    const rizPilaf = res.body.items[4];
    expect(rizPilaf.title).toBe('Riz pilaf nature');

    const justeAuDessus = rizPilaf.ingredients.find((i: { label: string }) => i.label === 'Spaghettis complets au blé');
    expect(justeAuDessus?.match).toBe('probable');
    expect(justeAuDessus?.productName).toBe('Spaghettis');

    const justeEnDessous = rizPilaf.ingredients.find((i: { label: string }) => i.label === 'Spaghettis complets de riz complet');
    expect(justeEnDessous?.match).toBe('absent');
    expect(justeEnDessous?.productId).toBeNull();
  });

  it('conserve la première recette en Recipe IMPORTED, difficulté recalculée au barème du foyer', async () => {
    const list = await agent.get('/api/v1/suggestions').expect(200);
    const batchId = list.body.batchId as string;
    // Identifiant rendu par la fournée, dérivé du contenu de la recette : jamais un rang.
    const suggestionId = list.body.items[0].id as string;

    const res = await agent
      .post('/api/v1/suggestions/keep')
      .send({ batchId, suggestionId, clientOpId: 'op-scenario-pates-00001' })
      .expect(201);

    expect(res.body.source).toBe('IMPORTED');
    expect(res.body.sourceUrl).toBe(`https://${WEB_RECIPE_HOST}/spaghetti-tomate`);
    // Titre et étapes viennent de la réécriture (`gemini-rewrite-tarte.json`), jamais
    // de la fournée de départ : la fournée annonçait « Spaghetti à la tomate ».
    expect(res.body.title).toBe('Tarte aux pommes (réécrite)');
    // La fournée annonçait HARD ; huit étapes sans aucune technique détectée et
    // `computeDifficulty` lit `activeTime ?? prepMinutes` : depuis que la fournée
    // porte des durées séparées, c'est `prepMinutes` (28) qui pilote le palier de
    // temps, non `totalMinutes` (30). Même tranche, même score — mais ce n'est
    // plus la même valeur qui le détermine (bucket étapes 2 + bucket temps 2 + 0 technique = score 4)
    // donnent INTERMEDIATE au barème du foyer (`computeDifficulty`), jamais le HARD
    // annoncé par le modèle.
    expect(res.body.difficulty).toBe('INTERMEDIATE');
    expect(res.body.difficultyOverride).toBe(false);
  });
});
