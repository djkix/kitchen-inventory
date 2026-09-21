/**
 * Jeu de données de développement (section 19) : 3 emplacements imbriqués,
 * 40 produits dont 10 asiatiques, 60 lots avec des dates étalées de part et
 * d'autre d'aujourd'hui, toujours relatives à la date d'exécution.
 *
 *   DATABASE_URL=… npm run seed:dev -w @kitchen/api
 *
 * Compte créé : admin@example.org / inventaire-dev-2026 (si aucun utilisateur).
 */
import { hash, Algorithm } from '@node-rs/argon2';
import { PrismaClient, type Unit } from '@prisma/client';

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
  for (const [name, originalName, brand, category, unit] of ASIAN) {
    const p = await prisma.product.upsert({ where: { id: `seed-${slug(name)}` }, create: { id: `seed-${slug(name)}`, name, originalName, brand, categoryId: categories.get(category)?.id, defaultUnit: unit }, update: {} });
    products.push({ id: p.id, unit, category });
  }
  for (const [name, brand, category, unit] of OTHERS) {
    const p = await prisma.product.upsert({ where: { id: `seed-${slug(name)}` }, create: { id: `seed-${slug(name)}`, name, brand, categoryId: categories.get(category)?.id, defaultUnit: unit }, update: {} });
    products.push({ id: p.id, unit, category });
  }

  await prisma.stockMovement.deleteMany({ where: { stockItem: { id: { startsWith: 'seed-lot-' } } } });
  await prisma.stockItem.deleteMany({ where: { id: { startsWith: 'seed-lot-' } } });
  for (let i = 0; i < 60; i++) {
    const product = products[i % products.length]!;
    const offset = OFFSETS[i % OFFSETS.length];
    const locationByCategory: Record<string, string> = { Surgelés: congel.id, 'Produits laitiers': frigo.id, 'Viande fraîche': frigo.id, 'Poisson frais': frigo.id, 'Légumes frais': frigo.id, 'Restes et préparations maison': frigo.id };
    const locationId = locationByCategory[product.category] ?? (i % 3 === 0 ? etagere.id : placard.id);
    const quantity = ['GRAM', 'KILOGRAM', 'MILLILITER', 'LITER'].includes(product.unit) ? [0.5, 1, 1.5, 2][i % 4]! : [1, 1, 2, 3][i % 4]!;
    const expiryDate = offset === null ? null : daysFromNow(offset);
    const dateType = expiryDate ? (['Épicerie sèche', 'Conserves', 'Sauces et condiments', 'Épices et aromates', 'Boissons'].includes(product.category) ? 'BEST_BEFORE' : 'USE_BY') : null;
    const item = await prisma.stockItem.create({
      data: { id: `seed-lot-${i}`, productId: product.id, locationId, quantity, unit: product.unit, expiryDate, dateType, effectiveExpiry: expiryDate, dateEstimated: false },
    });
    await prisma.stockMovement.create({ data: { stockItemId: item.id, type: 'INBOUND', delta: quantity, userId: admin.id, occurredAt: daysFromNow(-(i % 30)) } });
  }
   
  console.log(`Jeu de données : ${products.length} produits, 60 lots, 5 emplacements.`);
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
