/**
 * Rattrapage des repères nutritionnels (EF-30). Les produits entrés au
 * catalogue avant cette fonctionnalité n'ont ni Nutri-Score ni niveaux : leur
 * `RecognitionLog` ne les contient pas non plus, puisque la réponse d'Open
 * Food Facts était tronquée aux champs demandés à l'époque. Il faut donc les
 * redemander, une fois.
 *
 *   docker compose exec app node tools/nutriscore-rattrapage.js
 *   docker compose exec app node tools/nutriscore-rattrapage.js --tout
 *
 * Sans option, seuls les produits qui n'ont aucun repère sont interrogés.
 * `--tout` reprend aussi ceux déjà renseignés, pour suivre une mise à jour
 * d'Open Food Facts. La commande est relançable : elle ne fait qu'écrire ce
 * qu'OFF renvoie, et un produit inconnu là-bas est simplement laissé en place.
 */
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { OFF_NUTRITION_FIELDS, parseNutrientLevels, parseNutriscoreGrade } from '@kitchen/shared';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Six secondes entre deux requêtes, soit dix par minute. Open Food Facts
 * annonce cent requêtes par minute mais refuse bien avant sur une rafale :
 * une première version à 0,7 s s'est fait couper après une douzaine
 * d'articles. Réglable par `OFF_RATTRAPAGE_DELAY_MS` le jour où leur limite
 * change ; le rattrapage est une opération unique, sa lenteur ne gêne rien.
 */
const DELAY_MS = Number(process.env.OFF_RATTRAPAGE_DELAY_MS) || 6_000;

/** Attente après un 429 quand Open Food Facts n'envoie pas de `Retry-After`. */
const PAUSE_429_MS = 60_000;

/** Nombre d'essais par produit avant d'abandonner la commande. */
const MAX_ATTEMPTS = 3;

/** Refus pour cause de débit : la commande attend plutôt que de perdre l'article. */
class RateLimited extends Error {
  constructor(readonly retryAfterMs: number) {
    super('HTTP 429');
  }
}

const BASE_URL = process.env.OFF_BASE_URL ?? 'https://world.openfoodfacts.org';
const USER_AGENT = process.env.OFF_USER_AGENT ?? 'KitchenInventory/1.0 (self-hosted)';

type Db = Pick<PrismaClient, 'product'>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Rattrapage {
  examined: number;
  updated: number;
  withoutData: number;
  failed: number;
}

/**
 * Interroge Open Food Facts produit par produit. Un échec réseau ne fait pas
 * tomber la commande : il est compté et le reste du catalogue continue.
 */
export async function rattraper(prisma: Db, options: { all: boolean; fetch: Fetch; delayMs?: number; pause429Ms?: number }, out: (line: string) => void): Promise<Rattrapage> {
  const products = await prisma.product.findMany({
    where: {
      barcode: { not: null },
      mergedIntoId: null,
      ...(options.all ? {} : { nutriscoreGrade: null, nutrientLevels: { equals: Prisma.DbNull } }),
    },
    select: { id: true, barcode: true, name: true },
    orderBy: { name: 'asc' },
  });
  out(`${products.length} produit(s) à interroger.`);

  const tally: Rattrapage = { examined: 0, updated: 0, withoutData: 0, failed: 0 };
  for (const [index, product] of products.entries()) {
    if (index > 0) await sleep(options.delayMs ?? DELAY_MS);
    tally.examined++;
    const url = `${BASE_URL}/api/v2/product/${encodeURIComponent(product.barcode ?? '')}?fields=${OFF_NUTRITION_FIELDS.join(',')}`;
    let payload: { status?: number; product?: Record<string, unknown> } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && payload === null; attempt++) {
      try {
        payload = await lire(options.fetch, url);
      } catch (error) {
        if (error instanceof RateLimited) {
          if (attempt === MAX_ATTEMPTS) {
            out('');
            out('Open Food Facts limite les requêtes et ne repart pas. Relancez la commande plus tard :');
            out('elle ne reprendra que les produits encore sans repère, donc elle continuera où elle s’arrête.');
            return tally;
          }
          const pause = options.pause429Ms ?? error.retryAfterMs;
          out(`  … Open Food Facts limite les requêtes, pause de ${Math.round(pause / 1000)} s`);
          await sleep(pause);
          continue;
        }
        tally.failed++;
        out(`  ✗ ${product.name} : ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    if (payload === null) continue;
    const grade = parseNutriscoreGrade(payload.product?.nutriscore_grade);
    const levels = parseNutrientLevels(payload.product?.nutrient_levels);
    if (payload.status !== 1 || (!grade && !levels)) {
      tally.withoutData++;
      continue;
    }
    await prisma.product.update({
      where: { id: product.id },
      data: { nutriscoreGrade: grade, nutrientLevels: levels ?? Prisma.DbNull },
    });
    tally.updated++;
    out(`  ✓ ${product.name} : ${grade ? grade.toUpperCase() : 'sans note'}`);
  }
  return tally;
}

/**
 * Une lecture, un essai. Un 429 est distingué des autres échecs : il ne dit
 * pas que le produit est introuvable, seulement qu'il faut attendre.
 */
async function lire(http: Fetch, url: string): Promise<{ status?: number; product?: Record<string, unknown> }> {
  const response = await http(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (response.status === 429) throw new RateLimited(retryAfterMs(response.headers.get('retry-after')));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as { status?: number; product?: Record<string, unknown> };
}

/** `Retry-After` en secondes ; borné pour qu'une valeur absurde ne fige pas la commande. */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return PAUSE_429_MS;
  return Math.min(seconds * 1000, 300_000);
}

/** Corps de la commande, séparé du câblage Prisma pour être joué en test. */
export async function run(prisma: Db, argv: string[], out: (line: string) => void, fetchImpl: Fetch = fetch): Promise<void> {
  const all = argv.includes('--tout');
  const reste = argv.filter((arg) => arg !== '--tout');
  if (reste.length > 0) throw new Error('Usage : node tools/nutriscore-rattrapage.js [--tout]');

  const tally = await rattraper(prisma, { all, fetch: fetchImpl }, out);
  out('');
  out(`${tally.updated} mis à jour, ${tally.withoutData} sans repère chez Open Food Facts, ${tally.failed} en échec, sur ${tally.examined} interrogé(s).`);
  out('');
}

// Exécution directe seulement : importé par les tests, ce module ne fait rien.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  try {
    await run(prisma, process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
