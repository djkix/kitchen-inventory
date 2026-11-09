/**
 * Rattrapage des recettes du réservoir (D6 de
 * `docs/specs/2026-11-09-mes-recettes-etoile-ou-realisee.md`).
 *
 *   docker compose exec app node tools/recettes-rattrapage.js
 *
 * Depuis le 2026-11-09, chaque composition qui entre au réservoir devient aussi
 * une recette, pour alimenter la base. Les lignes antérieures — trois cent
 * quarante-neuf au moment de la livraison — n'en ont pas : cette commande les
 * reprend, une fois. Idempotente : la rejouer ne crée rien de plus.
 *
 * Elle ne remplit pas « Mes recettes », qui ne liste que l'étoilé ou le
 * réalisé. Elle remplit la base.
 *
 * Contrairement aux autres outils, elle démarre le contexte Nest : la création
 * d'une recette depuis une suggestion rapproche chaque libellé du catalogue
 * `Product` et traverse trois services. Les réimplémenter ici les ferait
 * diverger, ce que `nutriscore-rattrapage` évite par le même raisonnement.
 */
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module.js';
import { SuggestionsService } from '../apps/api/src/suggestions/suggestions.service.js';

export async function run(out: (line: string) => void): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const suggestions = app.get(SuggestionsService);
    out('Rattrapage des recettes du réservoir…');
    const bilan = await suggestions.catalogueAll((fait, total) => {
      if (fait % 25 === 0 || fait === total) out(`  ${fait} / ${total}`);
    });
    out(`créées : ${bilan.crees}`);
    out(`déjà présentes : ${bilan.deja}`);
    out(`ignorées (recette web, ou échec journalisé) : ${bilan.ignores}`);
  } finally {
    await app.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run((line) => console.log(line)).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
