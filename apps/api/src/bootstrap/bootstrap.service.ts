import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_CATEGORIES, DEFAULT_CUISINES } from '@kitchen/shared';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Section 22 : données créées d'office à l'installation, de façon idempotente
 * (par nom), pour qu'un premier scan fonctionne sans configuration préalable.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedReferenceData();
    } catch (error) {
      // Base injoignable au démarrage : /health le dira, l'application ne boucle pas (section 17).
      this.logger.error({ err: error }, 'Données initiales non créées, base indisponible');
    }
  }

  async seedReferenceData(): Promise<void> {
    for (const category of DEFAULT_CATEGORIES) {
      await this.prisma.category.upsert({
        where: { name: category.name },
        create: { name: category.name, icon: category.icon, shelfLifeDays: category.shelfLifeDays, afterOpeningDays: category.afterOpeningDays },
        // Les durées restent modifiables par l'utilisateur : on ne les écrase pas.
        update: {},
      });
    }
    for (const name of DEFAULT_CUISINES) {
      // normalizedName suit la même fonction que la recherche (migration 0002) :
      // minuscules et sans accent, pour dédoublonner les saisies (A22).
      const [{ normalized }] = await this.prisma.$queryRaw<Array<{ normalized: string }>>`
        SELECT unaccent_lite(${name}) AS normalized`;
      await this.prisma.cuisine.upsert({
        where: { name },
        create: { name, normalizedName: normalized },
        update: {},
      });
    }
  }
}
