/**
 * Rattrapage des repères nutritionnels en ligne de commande (EF-30).
 *
 *   docker compose exec app node tools/nutriscore-rattrapage.js
 *   docker compose exec app node tools/nutriscore-rattrapage.js --tout
 *
 * Même boucle que le bouton de Réglages › Inventaire : ce fichier n'est qu'une
 * enveloppe autour de `apps/api/src/products/nutrition-backfill.ts`, pour que
 * les deux chemins ne puissent pas diverger. Sans option, seuls les produits
 * sans aucun repère sont interrogés ; `--tout` reprend aussi ceux déjà
 * renseignés, pour suivre une mise à jour d'Open Food Facts.
 */
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { rattraper, type Db } from '../apps/api/src/products/nutrition-backfill.js';

/** Corps de la commande, séparé du câblage Prisma pour être joué en test. */
export async function run(prisma: Db, argv: string[], out: (line: string) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
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
