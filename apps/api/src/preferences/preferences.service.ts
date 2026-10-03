import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** Clé de préférence pour les filtres et le tri de la liste des recettes (section 12). */
export const RECIPE_FILTERS_KEY = 'recipeFilters';

/** Préférences libres par utilisateur, clé/valeur JSON (section 22). */
@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, key: string): Promise<unknown> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } });
    return row?.value ?? {};
  }

  async set(userId: string, key: string, value: Prisma.InputJsonValue): Promise<unknown> {
    const row = await this.prisma.userPreference.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
    });
    return row.value;
  }
}
