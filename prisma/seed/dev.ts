/**
 * Jeu de données de développement (section 19) : 3 emplacements imbriqués,
 * 40 produits dont 10 asiatiques, jusqu'à 60 lots avec des dates étalées de
 * part et d'autre d'aujourd'hui (un produit, la moutarde, est volontairement
 * laissé sans stock pour illustrer un ingrédient manquant), huit recettes
 * couvrant les quatre difficultés et cinq cuisines, et leur historique de
 * réalisations, toujours relatifs à la date d'exécution (tâche 13).
 *
 *   DATABASE_URL=… npm run seed:dev -w @kitchen/api
 *
 * Compte créé : admin@example.org / inventaire-dev-2026 (si aucun utilisateur).
 */
import { hash, Algorithm } from '@node-rs/argon2';
import { PrismaClient, type Diet, type Difficulty, type DishType, type Unit } from '@prisma/client';
import { normalizeProductName } from '@kitchen/shared';

const prisma = new PrismaClient();

const ASIAN: Array<[string, string | null, string | null, string, Unit]> = [
  ['Ramen Shin', '신라면', 'Nongshim', 'Épicerie sèche', 'PACK'],
  ['Nouilles udon', 'うどん', null, 'Épicerie sèche', 'PACK'],
  ['Sauce soja', '醤油', 'Kikkoman', 'Sauces et condiments', 'LITER'],
  ['Gochujang', '고추장', 'CJ Haechandle', 'Sauces et condiments', 'PIECE'],
  ['Lait de coco', 'กะทิ', 'Aroy-D', 'Conserves', 'MILLILITER'],
  ['Pâte de curry vert', 'พริกแกงเขียวหวาน', 'Mae Ploy', 'Sauces et condiments', 'PIECE'],
  ['Vermicelles de riz', 'Bún', null, 'Épicerie sèche', 'PACK'],
  ['Algues nori', '海苔', null, 'Épicerie sèche', 'SACHET'],
  ['Sauce huître', '蚝油', 'Lee Kum Kee', 'Sauces et condiments', 'MILLILITER'],
  ['Kimchi', '김치', null, 'Légumes frais', 'PIECE'],
];

const OTHERS: Array<[string, string | null, string, Unit]> = [
  ['Riz basmati', 'Taureau Ailé', 'Épicerie sèche', 'KILOGRAM'],
  ['Pâtes penne', 'Barilla', 'Épicerie sèche', 'PACK'],
  ['Farine T55', null, 'Épicerie sèche', 'KILOGRAM'],
  ['Sucre en poudre', null, 'Épicerie sèche', 'KILOGRAM'],
  ['Lentilles vertes', null, 'Épicerie sèche', 'PACK'],
  ['Tomates pelées', 'Mutti', 'Conserves', 'BOX'],
  ['Thon au naturel', 'Petit Navire', 'Conserves', 'BOX'],
  ['Pois chiches', null, 'Conserves', 'BOX'],
  ['Huile d’olive', 'Puget', 'Sauces et condiments', 'LITER'],
  ['Moutarde', 'Maille', 'Sauces et condiments', 'PIECE'],
  ['Lait demi-écrémé', 'Lactel', 'Produits laitiers', 'LITER'],
  ['Yaourt nature', 'Danone', 'Produits laitiers', 'PIECE'],
  ['Beurre doux', 'Président', 'Produits laitiers', 'PIECE'],
  ['Comté', null, 'Produits laitiers', 'GRAM'],
  ['Œufs', null, 'Œufs', 'PIECE'],
  ['Poulet fermier', null, 'Viande fraîche', 'KILOGRAM'],
  ['Jambon blanc', 'Herta', 'Viande fraîche', 'PIECE'],
  ['Saumon fumé', null, 'Poisson frais', 'PIECE'],
  ['Petits pois surgelés', 'Picard', 'Surgelés', 'PACK'],
  ['Pizza surgelée', 'Buitoni', 'Surgelés', 'PIECE'],
  ['Pommes', null, 'Fruits frais', 'PIECE'],
  ['Bananes', null, 'Fruits frais', 'PIECE'],
  ['Carottes', null, 'Légumes frais', 'KILOGRAM'],
  ['Oignons', null, 'Légumes frais', 'KILOGRAM'],
  ['Pain de mie', 'Harrys', 'Pain et viennoiserie', 'PACK'],
  ['Café moulu', 'Carte Noire', 'Boissons', 'PACK'],
  ['Jus d’orange', 'Tropicana', 'Boissons', 'LITER'],
  ['Cumin', 'Ducros', 'Épices et aromates', 'PIECE'],
  ['Paprika', null, 'Épices et aromates', 'PIECE'],
  ['Reste de ratatouille', null, 'Restes et préparations maison', 'PIECE'],
];

const OFFSETS = [-12, -3, -1, 0, 2, 5, 9, 20, 45, 120, 400, null];
/**
 * Une DLC dépassée écarte un lot des suggestions de recettes (section 15) : si c'est le
 * seul lot d'un produit, ce produit reste en permanence hors recette dans le jeu de dev,
 * ce qui a caché un vrai bogue de cuisson (celle-ci décrémentait ces lots périmés avant
 * les lots encore bons). Le premier lot de chaque produit (ci-dessous, `i < products.length`)
 * ne pioche donc jamais un offset négatif ; les éventuels lots suivants du même produit, qui
 * ne sont alors plus les seuls, peuvent de nouveau piocher dans `OFFSETS` au complet.
 */
const FIRST_LOT_OFFSETS = OFFSETS.filter((offset) => offset === null || offset >= 0);

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

async function main(): Promise<void> {
  if ((await prisma.user.count()) === 0) {
    await prisma.user.create({
      data: {
        email: 'admin@example.org',
        name: 'Admin dev',
        role: 'ADMIN',
        passwordHash: await hash('inventaire-dev-2026', { algorithm: Algorithm.Argon2id }),
      },
    });
  }
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });

  const cuisine = await prisma.location.upsert({ where: { path: '/cuisine' }, create: { name: 'Cuisine', path: '/cuisine', depth: 0, kind: 'pièce', temperature: 'ambient' }, update: {} });
  const placard = await prisma.location.upsert({ where: { path: '/cuisine/placard' }, create: { name: 'Placard', parentId: cuisine.id, path: '/cuisine/placard', depth: 1, kind: 'meuble', temperature: 'ambient' }, update: {} });
  const etagere = await prisma.location.upsert({ where: { path: '/cuisine/placard/etagere-du-haut' }, create: { name: 'Étagère du haut', parentId: placard.id, path: '/cuisine/placard/etagere-du-haut', depth: 2, kind: 'étagère', temperature: 'ambient' }, update: {} });
  const frigo = await prisma.location.upsert({ where: { path: '/cuisine/refrigerateur' }, create: { name: 'Réfrigérateur', parentId: cuisine.id, path: '/cuisine/refrigerateur', depth: 1, kind: 'meuble', temperature: 'chilled' }, update: {} });
  const congel = await prisma.location.upsert({ where: { path: '/cuisine/congelateur' }, create: { name: 'Congélateur', parentId: cuisine.id, path: '/cuisine/congelateur', depth: 1, kind: 'meuble', temperature: 'frozen' }, update: {} });

  const categories = new Map((await prisma.category.findMany()).map((c) => [c.name, c]));
  const products: Array<{ id: string; unit: Unit; category: string }> = [];
  const productIdByName = new Map<string, string>();
  for (const [name, originalName, brand, category, unit] of ASIAN) {
    const p = await prisma.product.upsert({ where: { id: `seed-${slug(name)}` }, create: { id: `seed-${slug(name)}`, name, originalName, brand, categoryId: categories.get(category)?.id, defaultUnit: unit }, update: {} });
    products.push({ id: p.id, unit, category });
    productIdByName.set(name, p.id);
  }
  for (const [name, brand, category, unit] of OTHERS) {
    const p = await prisma.product.upsert({ where: { id: `seed-${slug(name)}` }, create: { id: `seed-${slug(name)}`, name, brand, categoryId: categories.get(category)?.id, defaultUnit: unit }, update: {} });
    products.push({ id: p.id, unit, category });
    productIdByName.set(name, p.id);
  }

  // La moutarde reste volontairement sans lot : ingrédient essentiel manquant
  // de la recette « Croque-monsieur » (tâche 13), pour que le groupe « incomplète »
  // et les étiquettes d'ingrédient manquant soient visibles dans le jeu de dev.
  const OUT_OF_STOCK_PRODUCT_IDS = new Set<string>([productIdByName.get('Moutarde')!]);

  await prisma.stockMovement.deleteMany({ where: { stockItem: { id: { startsWith: 'seed-lot-' } } } });
  await prisma.stockItem.deleteMany({ where: { id: { startsWith: 'seed-lot-' } } });
  let stockCount = 0;
  for (let i = 0; i < 60; i++) {
    const product = products[i % products.length]!;
    if (OUT_OF_STOCK_PRODUCT_IDS.has(product.id)) continue;
    const offsetPool = i < products.length ? FIRST_LOT_OFFSETS : OFFSETS;
    const offset = offsetPool[i % offsetPool.length];
    const locationByCategory: Record<string, string> = { Surgelés: congel.id, 'Produits laitiers': frigo.id, 'Viande fraîche': frigo.id, 'Poisson frais': frigo.id, 'Légumes frais': frigo.id, 'Restes et préparations maison': frigo.id };
    const locationId = locationByCategory[product.category] ?? (i % 3 === 0 ? etagere.id : placard.id);
    const quantity = ['GRAM', 'KILOGRAM', 'MILLILITER', 'LITER'].includes(product.unit) ? [0.5, 1, 1.5, 2][i % 4]! : [1, 1, 2, 3][i % 4]!;
    const expiryDate = offset === null ? null : daysFromNow(offset);
    const dateType = expiryDate ? (['Épicerie sèche', 'Conserves', 'Sauces et condiments', 'Épices et aromates', 'Boissons'].includes(product.category) ? 'BEST_BEFORE' : 'USE_BY') : null;
    const item = await prisma.stockItem.create({
      data: { id: `seed-lot-${i}`, productId: product.id, locationId, quantity, unit: product.unit, expiryDate, dateType, effectiveExpiry: expiryDate, dateEstimated: false },
    });
    await prisma.stockMovement.create({ data: { stockItemId: item.id, type: 'INBOUND', delta: quantity, userId: admin.id, occurredAt: daysFromNow(-(i % 30)) } });
    stockCount++;
  }

  const camille = await prisma.user.upsert({
    where: { email: 'camille@example.org' },
    create: {
      email: 'camille@example.org',
      name: 'Camille',
      role: 'MEMBER',
      passwordHash: await hash('inventaire-dev-2026', { algorithm: Algorithm.Argon2id }),
    },
    update: {},
  });

  const recipeCount = await seedRecipes(productIdByName, categories, admin.id, camille.id);

  console.log(`Jeu de données : ${products.length} produits, ${stockCount} lots, 5 emplacements, ${recipeCount} recettes.`);
}

/** Recette de développement (tâche 13) : rattachée aux produits déjà semés plus haut. */
interface SeedIngredient {
  label: string;
  productName?: string;
  categoryName?: string;
  quantity?: number;
  unit?: Unit;
  essential?: boolean;
  substitutable?: boolean;
}
interface SeedRating {
  userId: 'admin' | 'camille';
  stars: number;
}
interface SeedLog {
  offsetDays: number;
  servingsCooked: number;
  ratings?: SeedRating[];
}
interface SeedRecipe {
  slug: string;
  title: string;
  cuisineName: string;
  difficulty: Difficulty;
  dishType: DishType;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  activeTime: number;
  restMinutes?: number;
  diets?: Diet[];
  steps: string[];
  ingredients: SeedIngredient[];
  logs?: SeedLog[];
}

const CUISINE_NAMES = ['Japonaise', 'Coréenne', 'Thaïlandaise', 'Italienne', 'Française'];

const RECIPES: SeedRecipe[] = [
  {
    slug: 'riz-saute-legumes',
    title: 'Riz sauté aux légumes',
    cuisineName: 'Japonaise',
    difficulty: 'VERY_EASY',
    dishType: 'MAIN',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 15,
    activeTime: 20,
    diets: ['VEGETARIAN'],
    steps: [
      'Émincer les oignons et les carottes.',
      'Faire revenir les légumes quelques minutes à la poêle.',
      'Ajouter le riz cuit et la sauce soja, puis sauter 5 minutes à feu vif.',
    ],
    ingredients: [
      { label: 'Riz basmati', productName: 'Riz basmati', quantity: 300, unit: 'GRAM', essential: true },
      { label: 'Carottes', productName: 'Carottes', quantity: 0.15, unit: 'KILOGRAM' },
      { label: 'Oignons', productName: 'Oignons', quantity: 0.08, unit: 'KILOGRAM' },
      { label: 'Sauce soja', productName: 'Sauce soja', quantity: 15, unit: 'MILLILITER', essential: true },
    ],
  },
  {
    slug: 'ramen-miso-maison',
    title: 'Ramen miso maison',
    cuisineName: 'Japonaise',
    difficulty: 'INTERMEDIATE',
    dishType: 'MAIN',
    servings: 2,
    prepMinutes: 20,
    cookMinutes: 25,
    activeTime: 40,
    steps: [
      'Préparer le bouillon et y délayer la sauce soja.',
      'Cuire les nouilles udon séparément.',
      'Garnir d’algues nori et d’un filet de sauce huître.',
      'Dresser les bols : bouillon, nouilles, algues.',
    ],
    ingredients: [
      { label: 'Nouilles udon', productName: 'Nouilles udon', quantity: 2, unit: 'PACK', essential: true },
      { label: 'Sauce soja', productName: 'Sauce soja', quantity: 20, unit: 'MILLILITER', essential: true },
      { label: 'Sauce huître', productName: 'Sauce huître', quantity: 10, unit: 'MILLILITER' },
      { label: 'Algues nori', productName: 'Algues nori', quantity: 1, unit: 'SACHET', essential: true },
    ],
    logs: [
      { offsetDays: -1, servingsCooked: 2, ratings: [{ userId: 'admin', stars: 5 }] },
      { offsetDays: -10, servingsCooked: 2, ratings: [{ userId: 'camille', stars: 4 }] },
    ],
  },
  {
    slug: 'bibimbap-simplifie',
    title: 'Bibimbap simplifié',
    cuisineName: 'Coréenne',
    difficulty: 'HARD',
    dishType: 'MAIN',
    servings: 2,
    prepMinutes: 30,
    cookMinutes: 20,
    activeTime: 45,
    steps: [
      'Cuire le riz basmati.',
      'Faire sauter les légumes de saison séparément, chacun à sa cuisson.',
      'Dresser le riz, les légumes et le kimchi, napper de gochujang.',
    ],
    ingredients: [
      { label: 'Riz basmati', productName: 'Riz basmati', quantity: 250, unit: 'GRAM', essential: true },
      { label: 'Gochujang', productName: 'Gochujang', quantity: 1, unit: 'PIECE', essential: true },
      { label: 'Kimchi', productName: 'Kimchi', quantity: 1, unit: 'PIECE', essential: true },
      { label: 'Légumes de saison', categoryName: 'Légumes frais', essential: true },
    ],
    logs: [{ offsetDays: -70, servingsCooked: 2, ratings: [{ userId: 'admin', stars: 3 }] }],
  },
  {
    slug: 'curry-vert-thai-pois-chiches',
    title: 'Curry vert thaï aux pois chiches',
    cuisineName: 'Thaïlandaise',
    difficulty: 'INTERMEDIATE',
    dishType: 'MAIN',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 25,
    activeTime: 35,
    diets: ['VEGETARIAN', 'VEGAN'],
    steps: [
      'Faire revenir la pâte de curry vert dans un peu d’huile.',
      'Ajouter les pois chiches égouttés.',
      'Mouiller avec le lait de coco (ou une autre crème végétale) et laisser mijoter 20 minutes.',
    ],
    ingredients: [
      { label: 'Pâte de curry vert', productName: 'Pâte de curry vert', quantity: 1, unit: 'PIECE', essential: true },
      { label: 'Lait de coco', productName: 'Lait de coco', quantity: 400, unit: 'MILLILITER', substitutable: true },
      { label: 'Pois chiches', productName: 'Pois chiches', quantity: 1, unit: 'BOX', essential: true },
    ],
    logs: [
      { offsetDays: -10, servingsCooked: 4, ratings: [{ userId: 'camille', stars: 4 }] },
      { offsetDays: -1, servingsCooked: 3 },
    ],
  },
  {
    slug: 'pates-tomates-thon',
    title: 'Pâtes aux tomates et au thon',
    cuisineName: 'Italienne',
    difficulty: 'EASY',
    dishType: 'MAIN',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 15,
    activeTime: 20,
    steps: [
      'Cuire les pâtes ou nouilles selon le paquet.',
      'Faire revenir les tomates pelées et le thon émietté.',
      'Mélanger avec un filet d’huile d’olive.',
    ],
    ingredients: [
      { label: 'Pâtes ou nouilles', categoryName: 'Épicerie sèche', essential: true },
      { label: 'Tomates pelées', productName: 'Tomates pelées', quantity: 1, unit: 'BOX', essential: true },
      { label: 'Thon au naturel', productName: 'Thon au naturel', quantity: 1, unit: 'BOX', essential: true },
      { label: 'Huile d’olive', productName: 'Huile d’olive', quantity: 10, unit: 'MILLILITER' },
    ],
  },
  {
    slug: 'croque-monsieur',
    title: 'Croque-monsieur',
    cuisineName: 'Française',
    difficulty: 'VERY_EASY',
    dishType: 'MAIN',
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    activeTime: 15,
    steps: [
      'Tartiner le pain de mie de moutarde.',
      'Garnir de jambon blanc et de comté.',
      'Passer au four ou à la poêle jusqu’à ce que le fromage fonde.',
    ],
    // Recette délibérément incomplète (tâche 13) : la moutarde n'a aucun lot
    // en stock, ce qui exclut la recette malgré le reste des ingrédients.
    ingredients: [
      { label: 'Pain de mie', productName: 'Pain de mie', quantity: 1, unit: 'PACK', essential: true },
      { label: 'Jambon blanc', productName: 'Jambon blanc', quantity: 2, unit: 'PIECE', essential: true },
      { label: 'Comté', productName: 'Comté', quantity: 80, unit: 'GRAM', essential: true },
      { label: 'Moutarde', productName: 'Moutarde', quantity: 1, unit: 'PIECE', essential: true },
    ],
  },
  {
    slug: 'saumon-fume-carottes',
    title: 'Saumon fumé et carottes râpées',
    cuisineName: 'Française',
    difficulty: 'EASY',
    dishType: 'STARTER',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 0,
    activeTime: 15,
    steps: [
      'Râper les carottes et émincer un oignon.',
      'Assaisonner et dresser avec les tranches de saumon fumé.',
    ],
    ingredients: [
      { label: 'Saumon fumé', productName: 'Saumon fumé', quantity: 1, unit: 'PIECE', essential: true },
      { label: 'Carottes', productName: 'Carottes', quantity: 0.3, unit: 'KILOGRAM', essential: true },
      { label: 'Oignons', productName: 'Oignons', quantity: 0.1, unit: 'KILOGRAM' },
    ],
    logs: [{ offsetDays: -10, servingsCooked: 4, ratings: [{ userId: 'camille', stars: 2 }] }],
  },
  {
    slug: 'salade-pois-chiches',
    title: 'Salade de pois chiches à l’huile d’olive',
    cuisineName: 'Italienne',
    difficulty: 'EASY',
    dishType: 'STARTER',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 0,
    activeTime: 10,
    diets: ['VEGETARIAN', 'VEGAN'],
    steps: [
      'Égoutter les pois chiches.',
      'Émincer un oignon et assaisonner avec l’huile d’olive et le cumin.',
      'Mélanger et servir frais.',
    ],
    ingredients: [
      { label: 'Pois chiches', productName: 'Pois chiches', quantity: 1, unit: 'BOX', essential: true },
      { label: 'Huile d’olive', productName: 'Huile d’olive', quantity: 15, unit: 'MILLILITER', essential: true },
      { label: 'Oignons', productName: 'Oignons', quantity: 0.05, unit: 'KILOGRAM' },
      { label: 'Cumin', productName: 'Cumin', quantity: 1, unit: 'PIECE' },
    ],
  },
];

/** Sème les huit recettes de développement et leur historique (tâche 13), ré-exécutable sans effet de bord. */
async function seedRecipes(
  productIdByName: ReadonlyMap<string, string>,
  categories: ReadonlyMap<string, { id: string }>,
  adminId: string,
  camilleId: string,
): Promise<number> {
  const cuisineIdByName = new Map<string, string>();
  for (const name of CUISINE_NAMES) {
    const c = await prisma.cuisine.upsert({
      where: { name },
      create: { name, normalizedName: normalizeProductName(name) },
      update: {},
    });
    cuisineIdByName.set(name, c.id);
  }

  // Ré-exécutable : les réalisations sont supprimées puis recréées (les notes
  // suivent par la cascade déclarée sur RecipeRating), puis les recettes.
  await prisma.recipeLog.deleteMany({ where: { recipeId: { startsWith: 'seed-recipe-' } } });
  await prisma.recipe.deleteMany({ where: { id: { startsWith: 'seed-recipe-' } } });

  const userIdByTag: Record<'admin' | 'camille', string> = { admin: adminId, camille: camilleId };

  for (const recipe of RECIPES) {
    const recipeId = `seed-recipe-${recipe.slug}`;
    const created = await prisma.recipe.create({
      data: {
        id: recipeId,
        title: recipe.title,
        difficulty: recipe.difficulty,
        difficultyOverride: true,
        cuisineId: cuisineIdByName.get(recipe.cuisineName)!,
        dishType: recipe.dishType,
        prepMinutes: recipe.prepMinutes,
        cookMinutes: recipe.cookMinutes,
        activeTime: recipe.activeTime,
        restMinutes: recipe.restMinutes ?? null,
        servings: recipe.servings,
        steps: recipe.steps,
        diets: recipe.diets ?? [],
        createdById: adminId,
        ingredients: {
          create: recipe.ingredients.map((ingredient) => ({
            label: ingredient.label,
            productId: ingredient.productName ? productIdByName.get(ingredient.productName) : undefined,
            categoryId: ingredient.categoryName ? categories.get(ingredient.categoryName)?.id : undefined,
            quantity: ingredient.quantity ?? null,
            unit: ingredient.unit ?? null,
            essential: ingredient.essential ?? false,
            substitutable: ingredient.substitutable ?? false,
          })),
        },
      },
    });

    for (const [logIndex, log] of (recipe.logs ?? []).entries()) {
      const createdLog = await prisma.recipeLog.create({
        data: {
          id: `seed-recipe-log-${recipe.slug}-${logIndex}`,
          recipeId: created.id,
          userId: adminId,
          cookedAt: daysFromNow(log.offsetDays),
          servingsCooked: log.servingsCooked,
          stockApplied: false,
        },
      });
      for (const [ratingIndex, rating] of (log.ratings ?? []).entries()) {
        await prisma.recipeRating.create({
          data: {
            id: `seed-recipe-rating-${recipe.slug}-${logIndex}-${ratingIndex}`,
            recipeLogId: createdLog.id,
            userId: userIdByTag[rating.userId],
            stars: rating.stars,
          },
        });
      }
    }
  }

  return RECIPES.length;
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

main()
  .catch((error: unknown) => {
     
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
