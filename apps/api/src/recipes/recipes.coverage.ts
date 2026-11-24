import { Injectable } from '@nestjs/common';
import {
  type HouseholdProduct,
  availableInUnit,
  buildStockSnapshot,
  expiryStatus,
  isUsableForRecipes,
  roundQuantity,
  STOCK_CONSUMPTION_ORDER,
  temperatureSchema,
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
  locationId: string;
  locationName: string;
  locationTemperature: 'ambient' | 'chilled' | 'frozen' | null;
}

/**
 * `Location.temperature` est un `String?` libre en base (migration manuelle,
 * pas une colonne d'énumération) : seule l'écriture, validée par
 * `temperatureSchema` (module emplacements), garantit qu'elle ne contient que
 * l'une des trois valeurs. Une valeur étrangère (donnée historique ou
 * corrompue) tombe ici en `null` plutôt que de fausser la couleur de la
 * pastille (C3).
 */
function parseLocationTemperature(value: string | null): 'ambient' | 'chilled' | 'frozen' | null {
  const parsed = temperatureSchema.nullable().safeParse(value);
  return parsed.success ? parsed.data : null;
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
   * en a aussi besoin — revue de tâche 6 : les deux interrogeaient chacun la
   * table séparément).
   */
  async snapshot(today = new Date(), categories?: readonly CategoryRow[]): Promise<StockSnapshot> {
    const [lots, loadedCategories, alertDays] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: { archivedAt: null, quantity: { gt: 0 } },
        // Le lot consommé en premier (C4) est celui de la règle partagée avec la
        // cuisson (`recipes.cook.ts`), lue depuis `@kitchen/shared` : jamais
        // réinventée ici, pour que `contributions[0]` désigne toujours le même
        // lot que celui que la cuisson déciderait de décrémenter en premier.
        orderBy: [...STOCK_CONSUMPTION_ORDER],
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
          location: { select: { id: true, name: true, temperature: true } },
        },
      }),
      categories ? Promise.resolve(categories) : loadCategoryRows(this.prisma),
      this.settings.expiryAlertDays(),
    ]);

    const parentByCategory = new Map<string, string | null>(loadedCategories.map((c) => [c.id, c.parentId]));

    const groups = new Map<string, { product: ResolvedProduct; lots: LotContribution[] }>();
    for (const lot of lots) {
      const lotDates = { effectiveExpiry: lot.effectiveExpiry, dateType: lot.dateType, dateEstimated: lot.dateEstimated };
      // Une DLC dépassée écarte le lot du calcul de couverture (section 15) : même
      // règle, partagée avec la cuisson, que celle qui a servi à trier la requête.
      if (!isUsableForRecipes(lotDates, today, alertDays)) continue;
      const status = expiryStatus(lotDates, today, alertDays);
      const nearExpiry = status === 'soon' || status === 'expired_best_before';

      const target = resolveTargetProduct(lot.product);
      const group = groups.get(target.id) ?? { product: target, lots: [] };
      group.lots.push({
        unit: lot.unit,
        quantity: toNumber(lot.quantity) ?? 0,
        nearExpiry,
        locationId: lot.location.id,
        locationName: lot.location.name,
        locationTemperature: parseLocationTemperature(lot.location.temperature),
      });
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
            locationId: null,
            locationName: null,
            locationTemperature: null,
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

      // Le lot consommé en premier (C4) : le tri de la requête fait de
      // `contributions[0]` ce lot, qu'il ait pu être mesuré ou non — un groupe
      // n'existe que si au moins un lot y a été poussé.
      const firstLot = contributions[0]!;

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
          locationId: firstLot.locationId,
          locationName: firstLot.locationName,
          locationTemperature: firstLot.locationTemperature,
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
          locationId: firstLot.locationId,
          locationName: firstLot.locationName,
          locationTemperature: firstLot.locationTemperature,
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
 * par `RecipesCoverageService.snapshot()` et la couverture des recettes,
 * plutôt qu'interrogée séparément par chacun.
 */
export function loadCategoryRows(prisma: PrismaService): Promise<CategoryRow[]> {
  return prisma.category.findMany({ select: { id: true, parentId: true, name: true } });
}


/**
 * Ce que le foyer possède, pour la consigne envoyée au modèle (EF-26,
 * décision du propriétaire du 2026-11-24). Remplace `loadSeedCandidates` et
 * la sélection de huit graines : le modèle voit tout le placard.
 *
 * **Ni quantité, ni date** — c'est tout l'objet de la décision. Aucun filtre
 * de péremption non plus : les dates n'interviennent pas dans le module
 * recettes (cahier, section 12, amendement du 2026-10-04), ce qui distingue
 * cette lecture de `snapshot()`, qui écarte les lots périmés du calcul de
 * couverture.
 *
 * Les produits fusionnés sont résolus vers leur cible, sans quoi un même
 * produit entrerait deux fois dans la liste sous deux noms.
 */
export async function loadHouseholdProducts(prisma: PrismaService): Promise<HouseholdProduct[]> {
  const nameSelect = { id: true, name: true } as const;
  const lots = await prisma.stockItem.findMany({
    where: { archivedAt: null, quantity: { gt: 0 } },
    select: {
      product: {
        select: {
          ...nameSelect,
          mergedInto: { select: { ...nameSelect, mergedInto: { select: nameSelect } } },
        },
      },
      location: { select: { name: true } },
    },
  });

  const byProduct = new Map<string, { name: string; locations: Set<string> }>();
  for (const lot of lots) {
    const target = lot.product.mergedInto?.mergedInto ?? lot.product.mergedInto ?? lot.product;
    const entry = byProduct.get(target.id) ?? { name: target.name, locations: new Set<string>() };
    if (lot.location?.name) entry.locations.add(lot.location.name);
    byProduct.set(target.id, entry);
  }

  return [...byProduct.values()]
    .map(({ name, locations }) => ({ name, locations: [...locations].sort((a, b) => a.localeCompare(b, 'fr')) }))
    // Trié pour que deux appels successifs envoient exactement le même texte :
    // un prompt qui change tout seul fait repayer des appels pour rien.
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
