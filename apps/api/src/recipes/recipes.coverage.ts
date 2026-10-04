import { Injectable } from '@nestjs/common';
import {
  availableInUnit,
  buildStockSnapshot,
  excludedFromRecipes,
  expiryStatus,
  normalizeProductName,
  roundQuantity,
  type SeedCandidate,
  type StockEntry,
  type StockSnapshot,
  type Unit,
} from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { toNumber } from '../common/decimal.js';

/**
 * Un produit ne peut être fusionné dans une cible déjà fusionnée (règle du
 * module produits) : la chaîne `mergedIntoId` n'a donc jamais plus d'un
 * maillon en pratique. On en lit tout de même deux par prudence (le second
 * niveau ne devrait jamais servir) avant de se rabattre sur le dernier produit
 * connu, avec un ensemble visité pour écarter tout cycle.
 */
export const PRODUCT_MERGE_SELECT = {
  id: true,
  categoryId: true,
  defaultUnit: true,
  netContent: true,
  netContentUnit: true,
  mergedIntoId: true,
} as const;

export interface MergeChainProduct {
  id: string;
  categoryId: string | null;
  defaultUnit: Unit;
  netContent: Prisma.Decimal | null;
  netContentUnit: Unit | null;
  mergedIntoId: string | null;
  mergedInto?: MergeChainProduct | null;
}

export interface ResolvedProduct {
  id: string;
  categoryId: string | null;
  defaultUnit: Unit;
  netContent: number | null;
  netContentUnit: Unit | null;
}

/**
 * Suit la chaîne de fusion d'un produit (section 9) jusqu'à la cible finale.
 * Partagée par l'instantané de couverture et la cuisson (tâche « défaut 3 »)
 * pour qu'un produit fusionné ne soit jamais résolu deux fois différemment.
 */
export function resolveTargetProduct(product: MergeChainProduct): ResolvedProduct {
  let current: MergeChainProduct = product;
  const seen = new Set<string>([current.id]);
  while (current.mergedIntoId && current.mergedInto && !seen.has(current.mergedInto.id)) {
    seen.add(current.mergedInto.id);
    current = current.mergedInto;
  }
  return {
    id: current.id,
    categoryId: current.categoryId,
    defaultUnit: current.defaultUnit,
    netContent: toNumber(current.netContent),
    netContentUnit: current.netContentUnit,
  };
}

interface LotContribution {
  unit: Unit;
  quantity: number;
  nearExpiry: boolean;
}

/**
 * Instantané de stock (EF-17, EF-23) : charge les lots une seule fois pour
 * toute la liste des recettes (A19), jamais par recette.
 */
@Injectable()
export class RecipesCoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * `categories`, si fourni, évite une deuxième lecture de la table `Category` quand
   * l'appelant l'a déjà chargée pour son propre usage (ex. `SuggestionsService`, qui
   * en a aussi besoin pour `loadSeedCandidates` — revue de tâche 6 : les deux
   * interrogeaient chacun la table séparément).
   */
  async snapshot(today = new Date(), categories?: readonly CategoryRow[]): Promise<StockSnapshot> {
    const [lots, loadedCategories, alertDays] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: { archivedAt: null, quantity: { gt: 0 } },
        select: {
          quantity: true,
          unit: true,
          effectiveExpiry: true,
          dateType: true,
          dateEstimated: true,
          product: {
            select: {
              ...PRODUCT_MERGE_SELECT,
              mergedInto: { select: { ...PRODUCT_MERGE_SELECT, mergedInto: { select: PRODUCT_MERGE_SELECT } } },
            },
          },
        },
      }),
      categories ? Promise.resolve(categories) : loadCategoryRows(this.prisma),
      this.settings.expiryAlertDays(),
    ]);

    const parentByCategory = new Map<string, string | null>(loadedCategories.map((c) => [c.id, c.parentId]));

    const groups = new Map<string, { product: ResolvedProduct; lots: LotContribution[] }>();
    for (const lot of lots) {
      const status = expiryStatus(
        { effectiveExpiry: lot.effectiveExpiry, dateType: lot.dateType, dateEstimated: lot.dateEstimated },
        today,
        alertDays,
      );
      // Une DLC dépassée écarte le lot du calcul de couverture (section 15).
      if (excludedFromRecipes(status)) continue;
      const nearExpiry = status === 'soon' || status === 'expired_best_before';

      const target = resolveTargetProduct(lot.product);
      const group = groups.get(target.id) ?? { product: target, lots: [] };
      group.lots.push({ unit: lot.unit, quantity: toNumber(lot.quantity) ?? 0, nearExpiry });
      groups.set(target.id, group);
    }

    const entries: StockEntry[] = [];
    for (const { product, lots: contributions } of groups.values()) {
      let total = 0;
      let measuredAny = false;
      let nearExpiry = false;
      const unmeasured: LotContribution[] = [];
      for (const lot of contributions) {
        if (lot.nearExpiry) nearExpiry = true;
        const contribution = availableInUnit(
          {
            productId: product.id,
            categoryId: product.categoryId,
            unit: lot.unit,
            quantity: lot.quantity,
            netContent: product.netContent,
            netContentUnit: product.netContentUnit,
            nearExpiry: lot.nearExpiry,
          },
          product.defaultUnit,
        );
        if (contribution === null) {
          unmeasured.push(lot);
          continue;
        }
        measuredAny = true;
        total += contribution;
      }

      if (measuredAny) {
        entries.push({
          productId: product.id,
          categoryId: product.categoryId,
          unit: product.defaultUnit,
          quantity: roundQuantity(total),
          netContent: product.netContent,
          netContentUnit: product.netContentUnit,
          nearExpiry,
          // Une partie du stock de ce produit n'a pas pu être convertie : le total
          // ci-dessus la sous-estime, donc `ingredientOutcome` (règle partagée) ne
          // doit pas conclure `insufficient` dessus, seulement `unverifiable`.
          unmeasured: unmeasured.length > 0,
        });
      } else if (unmeasured.length > 0) {
        // Aucun lot ne se convertit dans l'unité par défaut du produit : on
        // garde l'unité d'origine du premier lot plutôt que d'ignorer le
        // stock, pour qu'un ingrédient qui le cible ressorte `unverifiable`
        // plutôt que `missing` (tâche 9).
        const first = unmeasured[0]!;
        entries.push({
          productId: product.id,
          categoryId: product.categoryId,
          unit: first.unit,
          quantity: first.quantity,
          netContent: product.netContent,
          netContentUnit: product.netContentUnit,
          nearExpiry,
        });
      }
    }

    return buildStockSnapshot(entries, parentByCategory);
  }
}

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
}

/**
 * Une seule requête pour tout l'arbre des catégories (id, parent, nom) — partagée
 * par `RecipesCoverageService.snapshot()` et `loadSeedCandidates` (revue de tâche 6)
 * plutôt qu'interrogée séparément par chacun.
 */
export function loadCategoryRows(prisma: PrismaService): Promise<CategoryRow[]> {
  return prisma.category.findMany({ select: { id: true, parentId: true, name: true } });
}

/**
 * Chemin de catégorie normalisé (racine → feuille), pour les candidats de départ
 * des suggestions (EF-26, `SeedCandidate.categoryPath`). Fonction pure : ne fait
 * aucune requête, construit le chemin à partir de lignes déjà chargées.
 */
export function buildCategoryPaths(categories: readonly CategoryRow[]): Map<string, readonly string[]> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const paths = new Map<string, readonly string[]>();
  const resolve = (id: string): readonly string[] => {
    const cached = paths.get(id);
    if (cached) return cached;
    const category = byId.get(id);
    if (!category) return [];
    const parentPath = category.parentId ? resolve(category.parentId) : [];
    const path = [...parentPath, normalizeProductName(category.name)];
    paths.set(id, path);
    return path;
  };
  for (const category of categories) resolve(category.id);
  return paths;
}

/**
 * Candidats de départ pour la sélection des ingrédients (EF-26, `pickSeedIngredients`) :
 * un par produit présent dans l'instantané de stock, trié par importance — profondeur
 * de catégorie (la plus spécifique d'abord), puis nom de produit (ordre alphabétique
 * stable). Les noms de produits sont chargés en une seule requête pour tout le stock,
 * jamais un par produit ; `categories` est fourni par l'appelant (voir `snapshot`),
 * jamais rechargé ici.
 *
 * Le tri n'utilise jamais la quantité : une consommation ordinaire la fait varier en
 * continu et ferait glisser le 8ᵉ ou 9ᵉ candidat d'un appel à l'autre, changeant la
 * signature de cache et déclenchant un appel payant évitable au fournisseur
 * (défaut corrigé en revue de tâche 6).
 */
export async function loadSeedCandidates(prisma: PrismaService, snapshot: StockSnapshot, categories: readonly CategoryRow[]): Promise<SeedCandidate[]> {
  const entries = [...snapshot.byProduct.values()];
  if (entries.length === 0) return [];
  const products = await prisma.product.findMany({ where: { id: { in: entries.map((e) => e.productId) } }, select: { id: true, name: true } });
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  const categoryPaths = buildCategoryPaths(categories);
  const depthOf = (categoryId: string | null): number => (categoryId ? (categoryPaths.get(categoryId)?.length ?? 0) : 0);
  const withNames = entries.map((entry) => ({ entry, name: nameById.get(entry.productId) ?? entry.productId }));
  const sorted = withNames.sort((a, b) => depthOf(b.entry.categoryId) - depthOf(a.entry.categoryId) || a.name.localeCompare(b.name));
  return sorted.map(({ entry, name }) => ({
    productId: entry.productId,
    name,
    categoryPath: entry.categoryId ? (categoryPaths.get(entry.categoryId) ?? []) : [],
  }));
}
