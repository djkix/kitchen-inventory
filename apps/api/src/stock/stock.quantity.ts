import { sumMovements } from '@kitchen/shared';
import type { MovementType, Prisma, StockItem, StockMovement } from '@prisma/client';

export interface MovementInput {
  stockItemId: string;
  type: MovementType;
  delta: number;
  reason?: string | null;
  userId?: string | null;
  clientOpId?: string | null;
}

export interface MovementResult {
  item: StockItem;
  movement: StockMovement;
  replayed: boolean;
}

/**
 * Règle non négociable : la quantité d'un lot est la somme de ses mouvements.
 * On insère le mouvement, puis on recalcule et matérialise `quantity` dans la
 * même transaction. Un `clientOpId` déjà connu renvoie le résultat précédent
 * sans rien réécrire (idempotence de la file hors ligne).
 */
export async function applyMovement(tx: Prisma.TransactionClient, input: MovementInput): Promise<MovementResult> {
  if (input.clientOpId) {
    const existing = await tx.stockMovement.findUnique({ where: { clientOpId: input.clientOpId } });
    if (existing) {
      const item = await tx.stockItem.findUniqueOrThrow({ where: { id: existing.stockItemId } });
      return { item, movement: existing, replayed: true };
    }
  }
  const movement = await tx.stockMovement.create({
    data: {
      stockItemId: input.stockItemId,
      type: input.type,
      delta: input.delta,
      reason: input.reason ?? null,
      userId: input.userId ?? null,
      clientOpId: input.clientOpId ?? null,
    },
  });
  const item = await recomputeQuantity(tx, input.stockItemId);
  return { item, movement, replayed: false };
}

export async function recomputeQuantity(tx: Prisma.TransactionClient, stockItemId: string): Promise<StockItem> {
  const movements = await tx.stockMovement.findMany({ where: { stockItemId }, select: { delta: true } });
  const quantity = sumMovements(movements.map((m) => m.delta.toNumber()));
  const current = await tx.stockItem.findUniqueOrThrow({ where: { id: stockItemId } });
  // Un lot à zéro est archivé, pas supprimé (section 6) ; un retour au-dessus de zéro le réactive.
  const archivedAt = quantity === 0 ? (current.archivedAt ?? new Date()) : null;
  return tx.stockItem.update({ where: { id: stockItemId }, data: { quantity, archivedAt } });
}
