import { Injectable } from '@nestjs/common';
import {
  capConsumption,
  convertQuantity,
  roundQuantity,
  sameFamily,
  type CookRecipeInput,
  type CookResult,
  type CookResultLine,
  type Unit,
} from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import type { RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyMovement } from '../stock/stock.quantity.js';

const COOK_RECIPE_INCLUDE = { ingredients: true } satisfies Prisma.RecipeInclude;
type RecipeWithIngredients = Prisma.RecipeGetPayload<{ include: typeof COOK_RECIPE_INCLUDE }>;
type RecipeIngredient = RecipeWithIngredients['ingredients'][number];

/** Message affiché quand au moins une ligne a dû être ramenée au stock disponible. */
const CAPPED_MESSAGE = 'Quantité ramenée au stock disponible';

/**
 * Convertit un besoin exprimé dans `fromUnit` vers `toUnit`, en passant par le
 * pont de contenance (`netContent`/`netContentUnit`) quand les deux unités ne
 * partagent pas la même famille (A16). `null` quand aucune conversion n'est
 * possible, auquel cas le lot visé est ignoré plutôt que de fausser le calcul.
 */
function convertNeed(amount: number, fromUnit: Unit, toUnit: Unit, netContent: number | null, netContentUnit: Unit | null): number | null {
  if (sameFamily(fromUnit, toUnit)) return convertQuantity(amount, fromUnit, toUnit);
  if (netContent === null || netContent <= 0 || netContentUnit === null) return null;
  if (sameFamily(fromUnit, netContentUnit)) {
    // `fromUnit` se mesure (ex. grammes), `toUnit` est un conditionnement (ex. paquet) :
    // on convertit d'abord dans l'unité de contenance, puis on divise par son contenu.
    const inNetContentUnit = convertQuantity(amount, fromUnit, netContentUnit);
    return roundQuantity(inNetContentUnit / netContent);
  }
  if (sameFamily(toUnit, netContentUnit)) {
    // Inverse : `fromUnit` est un conditionnement, `toUnit` se mesure.
    const inNetContentUnit = roundQuantity(amount * netContent);
    return convertQuantity(inNetContentUnit, netContentUnit, toUnit);
  }
  return null;
}

/**
 * Cuisson d'une recette (EF-18) : décrémente le stock au prorata des portions
 * réellement cuisinées, en une seule transaction avec la création du journal.
 * La mise à l'échelle (A14) ne se fait jamais sur la base d'une valeur reçue
 * du client : seule la quantité stockée sur l'ingrédient fait foi.
 */
@Injectable()
export class RecipesCookService {
  constructor(private readonly prisma: PrismaService) {}

  async cook(recipeId: string, input: CookRecipeInput, user: RequestUser): Promise<CookResult> {
    return this.prisma.$transaction(async (tx) => {
      if (input.clientOpId) {
        const existing = await tx.recipeLog.findUnique({ where: { clientOpId: input.clientOpId } });
        if (existing) return this.replay(tx, existing, input);
      }

      const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, include: COOK_RECIPE_INCLUDE });
      if (!recipe) throw ApiError.notFound('Recette introuvable');

      const log = await tx.recipeLog.create({
        data: {
          recipeId,
          userId: user.id,
          servingsCooked: input.servingsCooked,
          stockApplied: true,
          clientOpId: input.clientOpId ?? null,
          ratings:
            input.stars != null ? { create: { userId: user.id, stars: input.stars, comment: input.comment ?? null } } : undefined,
        },
      });

      const lines: CookResultLine[] = [];
      for (const requestedLine of input.lines) {
        const ingredient = recipe.ingredients.find((i) => i.id === requestedLine.ingredientId);
        if (!ingredient) throw ApiError.notFound('Ingrédient introuvable', { ingredientId: requestedLine.ingredientId });

        lines.push(
          await this.applyLine(tx, {
            ingredient,
            recipe,
            productOverride: requestedLine.productId,
            servingsCooked: input.servingsCooked,
            logId: log.id,
            userId: user.id,
            clientOpId: input.clientOpId,
          }),
        );
      }

      const message = lines.some((l) => l.capped) ? CAPPED_MESSAGE : null;
      return { logId: log.id, lines, message };
    });
  }

  private async applyLine(
    tx: Prisma.TransactionClient,
    args: {
      ingredient: RecipeIngredient;
      recipe: RecipeWithIngredients;
      productOverride?: string;
      servingsCooked: number;
      logId: string;
      userId: string;
      clientOpId?: string;
    },
  ): Promise<CookResultLine> {
    const { ingredient, recipe, productOverride, servingsCooked, logId, userId, clientOpId } = args;
    const quantity = toNumber(ingredient.quantity);
    const unit = ingredient.unit;
    const productId = productOverride ?? ingredient.productId ?? null;

    // A17 : une ligne sans quantité, ou qui ne vise aucun produit de l'inventaire, est ignorée.
    if (quantity === null || unit === null || !productId) {
      return { ingredientId: ingredient.id, label: ingredient.label, requested: null, applied: 0, unit: null, capped: false };
    }

    // A14 : mise à l'échelle unique, côté serveur, jamais à partir d'une valeur envoyée par le client.
    const requested = roundQuantity((quantity * servingsCooked) / recipe.servings);

    const product = await tx.product.findUnique({ where: { id: productId }, select: { netContent: true, netContentUnit: true } });
    const netContent = toNumber(product?.netContent ?? null);
    const netContentUnit = product?.netContentUnit ?? null;

    const lots = await tx.stockItem.findMany({
      where: { productId, archivedAt: null, quantity: { gt: 0 } },
      orderBy: [{ effectiveExpiry: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });

    let remaining = requested;
    let applied = 0;
    let appliedUnit: Unit | null = null;
    let capped = false;

    for (const [lotIndex, lot] of lots.entries()) {
      if (remaining <= 0) break;
      const neededInLotUnit = convertNeed(remaining, unit, lot.unit, netContent, netContentUnit);
      if (neededInLotUnit === null || neededInLotUnit <= 0) continue;

      const available = toNumber(lot.quantity) ?? 0;
      const { delta } = capConsumption(available, neededInLotUnit);
      if (delta === 0) continue;

      await applyMovement(tx, {
        stockItemId: lot.id,
        type: 'RECIPE',
        delta,
        userId,
        recipeLogId: logId,
        clientOpId: clientOpId ? `${clientOpId}:${ingredient.id}:${lotIndex}` : undefined,
      });

      const consumedInLotUnit = roundQuantity(-delta);
      applied = roundQuantity(applied + consumedInLotUnit);
      appliedUnit = lot.unit;

      const consumedInRequestedUnit = convertNeed(consumedInLotUnit, lot.unit, unit, netContent, netContentUnit) ?? 0;
      remaining = roundQuantity(remaining - consumedInRequestedUnit);
    }

    if (remaining > 0) capped = true;

    return {
      ingredientId: ingredient.id,
      label: ingredient.label,
      requested,
      applied,
      unit: appliedUnit ?? unit,
      capped,
    };
  }

  /**
   * Rejeu d'une cuisson déjà enregistrée (idempotence du `clientOpId`) : la
   * réponse est reconstruite depuis les mouvements déjà en base, jamais
   * recalculée contre l'état courant du stock, qui a pu changer depuis.
   */
  private async replay(tx: Prisma.TransactionClient, log: { id: string; recipeId: string; servingsCooked: number }, input: CookRecipeInput): Promise<CookResult> {
    const recipe = await tx.recipe.findUniqueOrThrow({ where: { id: log.recipeId }, include: COOK_RECIPE_INCLUDE });
    const movements = await tx.stockMovement.findMany({
      where: { recipeLogId: log.id },
      include: { stockItem: { select: { unit: true } } },
    });

    const byIngredient = new Map<string, { applied: number; unit: Unit }>();
    for (const movement of movements) {
      const parts = (movement.clientOpId ?? '').split(':');
      const ingredientId = parts.length >= 3 ? parts[parts.length - 2] : null;
      if (!ingredientId) continue;
      const entry = byIngredient.get(ingredientId) ?? { applied: 0, unit: movement.stockItem.unit };
      entry.applied = roundQuantity(entry.applied + -movement.delta.toNumber());
      byIngredient.set(ingredientId, entry);
    }

    const lines: CookResultLine[] = [];
    for (const requestedLine of input.lines) {
      const ingredient = recipe.ingredients.find((i) => i.id === requestedLine.ingredientId);
      if (!ingredient) throw ApiError.notFound('Ingrédient introuvable', { ingredientId: requestedLine.ingredientId });

      const quantity = toNumber(ingredient.quantity);
      const unit = ingredient.unit;
      if (quantity === null || unit === null) {
        lines.push({ ingredientId: ingredient.id, label: ingredient.label, requested: null, applied: 0, unit: null, capped: false });
        continue;
      }

      const requested = roundQuantity((quantity * log.servingsCooked) / recipe.servings);
      const effect = byIngredient.get(ingredient.id);
      if (!effect) {
        lines.push({ ingredientId: ingredient.id, label: ingredient.label, requested, applied: 0, unit, capped: requested > 0 });
        continue;
      }

      const productId = requestedLine.productId ?? ingredient.productId ?? null;
      const product = productId
        ? await tx.product.findUnique({ where: { id: productId }, select: { netContent: true, netContentUnit: true } })
        : null;
      const netContent = toNumber(product?.netContent ?? null);
      const netContentUnit = product?.netContentUnit ?? null;
      const requestedInAppliedUnit = convertNeed(requested, unit, effect.unit, netContent, netContentUnit) ?? requested;
      const capped = effect.applied < requestedInAppliedUnit;

      lines.push({ ingredientId: ingredient.id, label: ingredient.label, requested, applied: effect.applied, unit: effect.unit, capped });
    }

    return { logId: log.id, lines, message: lines.some((l) => l.capped) ? CAPPED_MESSAGE : null };
  }
}
