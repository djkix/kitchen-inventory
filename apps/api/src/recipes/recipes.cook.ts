import { Injectable } from '@nestjs/common';
import {
  capConsumption,
  convertWithNetContent,
  excludedFromRecipes,
  expiryStatus,
  roundQuantity,
  type CookRecipeInput,
  type CookResult,
  type CookResultLine,
  type Unit,
} from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { applyMovement } from '../stock/stock.quantity.js';
import { PRODUCT_MERGE_SELECT, resolveTargetProduct } from './recipes.coverage.js';

const COOK_RECIPE_INCLUDE = { ingredients: true } satisfies Prisma.RecipeInclude;
type RecipeWithIngredients = Prisma.RecipeGetPayload<{ include: typeof COOK_RECIPE_INCLUDE }>;
type RecipeIngredient = RecipeWithIngredients['ingredients'][number];

/** Même sélection, avec la même profondeur de fusion, que `recipes.coverage.ts`. */
const PRODUCT_MERGE_CHAIN_SELECT = {
  ...PRODUCT_MERGE_SELECT,
  mergedInto: { select: { ...PRODUCT_MERGE_SELECT, mergedInto: { select: PRODUCT_MERGE_SELECT } } },
} satisfies Prisma.ProductSelect;

/** Message affiché quand au moins une ligne a dû être ramenée au stock disponible. */
const CAPPED_MESSAGE = 'Quantité ramenée au stock disponible';

/** Violation d'unicité, quelle que soit la contrainte touchée. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Cuisson d'une recette (EF-18) : décrémente le stock au prorata des portions
 * réellement cuisinées, en une seule transaction avec la création du journal.
 * La mise à l'échelle (A14) ne se fait jamais sur la base d'une valeur reçue
 * du client : seule la quantité stockée sur l'ingrédient fait foi. Le pont de
 * contenance (A16) est celui, unique, de `@kitchen/shared`
 * (`convertWithNetContent`) : jamais réimplémenté ici.
 */
@Injectable()
export class RecipesCookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async cook(recipeId: string, input: CookRecipeInput, user: RequestUser): Promise<CookResult> {
    // Lus avant d'ouvrir la transaction : une lecture de réglages par ligne, sur une
    // seconde connexion pendant qu'une transaction interactive est tenue, épuise le
    // pool dès que deux cuissons se croisent.
    const alertDays = await this.settings.expiryAlertDays();
    const today = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (input.clientOpId) {
          const existing = await tx.recipeLog.findUnique({ where: { clientOpId: input.clientOpId } });
          if (existing) return this.replay(tx, existing, input);
        }

        const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, include: COOK_RECIPE_INCLUDE });
        if (!recipe) throw ApiError.notFound('Recette introuvable');
        if (recipe.archivedAt) throw ApiError.conflict('Cette recette est archivée : restaurez-la avant de la cuisiner');

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
              alertDays,
              today,
            }),
          );
        }

        const message = lines.some((l) => l.capped) ? CAPPED_MESSAGE : null;
        return { logId: log.id, lines, message };
      });
    } catch (error) {
      // Rejeu concurrent du même `clientOpId` : la vérification préalable laisse passer une course
      // entre deux transactions (même filet que recipe-logs.service.ts et cuisines.controller.ts).
      // Une erreur Postgres avorte le reste de la transaction en cours : le rejeu se fait donc dans
      // une transaction neuve, une fois celle qui a gagné la course validée et visible.
      // La contrainte violée n'est pas forcément celle du `clientOpId` de la réalisation :
      // les mouvements de stock en portent un, dérivé. On ne rejoue donc que si la
      // réalisation gagnante existe vraiment ; sinon l'erreur d'origine remonte, plutôt
      // qu'un 500 opaque sur une réalisation annulée par le retour arrière.
      if (input.clientOpId && isUniqueViolation(error)) {
        const winner = await this.prisma.recipeLog.findUnique({ where: { clientOpId: input.clientOpId } });
        if (winner) return this.prisma.$transaction((tx) => this.replay(tx, winner, input));
      }
      throw error;
    }
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
      alertDays: number;
      today: Date;
    },
  ): Promise<CookResultLine> {
    const { ingredient, recipe, productOverride, servingsCooked, logId, userId, clientOpId, alertDays, today } = args;
    const quantity = toNumber(ingredient.quantity);
    const unit = ingredient.unit;
    const productId = productOverride ?? ingredient.productId ?? null;

    // A17 : une ligne vraiment sans quantité (ex. « Sel », à l'œil) est ignorée, silencieusement.
    if (quantity === null || unit === null) {
      return { ingredientId: ingredient.id, label: ingredient.label, requested: null, applied: 0, unit: null, capped: false };
    }

    // A14 : mise à l'échelle unique, côté serveur, jamais à partir d'une valeur envoyée par le client.
    const requested = roundQuantity((quantity * servingsCooked) / recipe.servings);

    // Une ligne qui vise une catégorie (A15) exige que le client résolve un produit ;
    // sans lui, impossible de décrémenter. Signalé `capped` plutôt qu'ignoré en silence
    // (défaut 1) : la quantité demandée reste visible, rien n'a été appliqué.
    if (!productId) {
      return { ingredientId: ingredient.id, label: ingredient.label, requested, applied: 0, unit, capped: true };
    }

    // Suit la chaîne de fusion (section 9, tâche « défaut 3 ») : un produit fusionné depuis
    // la création de la recette doit décrémenter la cible, comme le fait déjà l'instantané
    // de couverture (`recipes.coverage.ts`), jamais une troisième résolution divergente.
    const productRecord = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_MERGE_CHAIN_SELECT });
    if (!productRecord) throw ApiError.notFound('Produit introuvable', { productId });
    const target = resolveTargetProduct(productRecord);
    const netContent = target.netContent;
    const netContentUnit = target.netContentUnit;

    const candidateLots = await tx.stockItem.findMany({
      where: { productId: target.id, archivedAt: null, quantity: { gt: 0 } },
      orderBy: [{ effectiveExpiry: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    // Une DLC dépassée écarte le lot de la cuisson, exactement comme du calcul de
    // couverture (défaut 2) : sinon le lot périmé est vidé en premier (tri par date
    // croissante) pendant que le lot encore bon reste en stock, intact.
    const lots = candidateLots.filter(
      (lot) => !excludedFromRecipes(expiryStatus({ effectiveExpiry: lot.effectiveExpiry, dateType: lot.dateType, dateEstimated: lot.dateEstimated }, today, alertDays)),
    );

    // `applied` et `unit` s'expriment toujours dans l'unité de l'ingrédient (celle de
    // `requested`), jamais dans celle d'un lot : un même ingrédient peut être servi par
    // plusieurs lots dont les unités diffèrent (ex. 500 g puis 1 kg du même produit).
    let remaining = requested;
    let applied = 0;
    let capped = false;

    for (const [lotIndex, lot] of lots.entries()) {
      if (remaining <= 0) break;
      const neededInLotUnit = convertWithNetContent(remaining, unit, lot.unit, netContent, netContentUnit);
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
      const consumedInIngredientUnit = convertWithNetContent(consumedInLotUnit, lot.unit, unit, netContent, netContentUnit);
      if (consumedInIngredientUnit === null) {
        // Le mouvement a bien été appliqué (le stock est décrémenté), mais ce lot ne se
        // reconvertit pas dans l'unité de l'ingrédient : on ne l'additionne pas à `applied`
        // pour ne pas fausser l'unité renvoyée, et la ligne est signalée `capped` puisqu'on
        // ne peut plus garantir que le besoin affiché a été entièrement servi.
        capped = true;
        continue;
      }

      applied = roundQuantity(applied + consumedInIngredientUnit);
      remaining = roundQuantity(remaining - consumedInIngredientUnit);
    }

    if (remaining > 0) capped = true;

    return { ingredientId: ingredient.id, label: ingredient.label, requested, applied, unit, capped };
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

    // Un même ingrédient a pu être servi par plusieurs lots : on garde chaque mouvement
    // séparément (unité du lot comprise) plutôt que de les sommer prématurément, pour
    // pouvoir reconvertir chacun dans l'unité de l'ingrédient au moment du regroupement.
    const movementsByIngredient = new Map<string, { appliedInLotUnit: number; lotUnit: Unit }[]>();
    for (const movement of movements) {
      const parts = (movement.clientOpId ?? '').split(':');
      const ingredientId = parts.length >= 3 ? parts[parts.length - 2] : null;
      if (!ingredientId) continue;
      const list = movementsByIngredient.get(ingredientId) ?? [];
      list.push({ appliedInLotUnit: roundQuantity(-movement.delta.toNumber()), lotUnit: movement.stockItem.unit });
      movementsByIngredient.set(ingredientId, list);
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
      const lotMovements = movementsByIngredient.get(ingredient.id);
      if (!lotMovements) {
        lines.push({ ingredientId: ingredient.id, label: ingredient.label, requested, applied: 0, unit, capped: requested > 0 });
        continue;
      }

      const productId = requestedLine.productId ?? ingredient.productId ?? null;
      const productRecord = productId
        ? await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_MERGE_CHAIN_SELECT })
        : null;
      const target = productRecord ? resolveTargetProduct(productRecord) : null;
      const netContent = target?.netContent ?? null;
      const netContentUnit = target?.netContentUnit ?? null;

      let applied = 0;
      let capped = false;
      for (const { appliedInLotUnit, lotUnit } of lotMovements) {
        const inIngredientUnit = convertWithNetContent(appliedInLotUnit, lotUnit, unit, netContent, netContentUnit);
        if (inIngredientUnit === null) {
          capped = true;
          continue;
        }
        applied = roundQuantity(applied + inIngredientUnit);
      }
      if (applied < requested) capped = true;

      lines.push({ ingredientId: ingredient.id, label: ingredient.label, requested, applied, unit, capped });
    }

    return { logId: log.id, lines, message: lines.some((l) => l.capped) ? CAPPED_MESSAGE : null };
  }
}
