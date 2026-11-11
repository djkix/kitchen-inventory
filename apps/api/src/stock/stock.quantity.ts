import { sumMovements } from '@kitchen/shared';
import { Prisma } from '@prisma/client';
import type { MovementType, StockItem, StockMovement } from '@prisma/client';

export interface MovementInput {
  stockItemId: string;
  type: MovementType;
  delta: number;
  reason?: string | null;
  userId?: string | null;
  clientOpId?: string | null;
  /** Rattache le mouvement à une cuisson (tâche 10), pour remonter au journal depuis la fiche article. */
  recipeLogId?: string | null;
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
  const replay = await findReplay(tx, input.clientOpId);
  if (replay) return replay;
  let movement;
  try {
    movement = await tx.stockMovement.create({
      data: {
        stockItemId: input.stockItemId,
        type: input.type,
        delta: input.delta,
        reason: input.reason ?? null,
        userId: input.userId ?? null,
        clientOpId: input.clientOpId ?? null,
        recipeLogId: input.recipeLogId ?? null,
      },
    });
  } catch (error) {
    // Deux rejeux du même `clientOpId` partis en même temps : l'un insère,
    // l'autre bute sur l'unicité. C'est le succès de l'autre, pas une erreur —
    // sans quoi la file hors ligne reçoit un 500 (audit du 2026-11-11).
    const raced = isUniqueViolation(error) ? await findReplay(tx, input.clientOpId) : null;
    if (raced) return raced;
    throw error;
  }
  const item = await recomputeQuantity(tx, input.stockItemId);
  return { item, movement, replayed: false };
}

/**
 * Le résultat déjà produit par ce `clientOpId`, s'il existe. Un rejeu ne doit
 * jamais être jugé sur l'état du lot : la première écriture a pu l'épuiser, et
 * la réponse s'est perdue en route (audit du 2026-11-11).
 */
export async function findReplay(tx: Prisma.TransactionClient, clientOpId: string | null | undefined): Promise<MovementResult | null> {
  if (!clientOpId) return null;
  const existing = await tx.stockMovement.findUnique({ where: { clientOpId } });
  if (!existing) return null;
  const item = await tx.stockItem.findUniqueOrThrow({ where: { id: existing.stockItemId } });
  return { item, movement: existing, replayed: true };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Verrouille la ligne du lot jusqu'à la fin de la transaction. Deux
 * consommations simultanées du même lot liraient sinon la même quantité
 * disponible et inséreraient chacune leur mouvement : leur somme passerait
 * sous zéro, alors que la quantité matérialisée, elle, s'arrête à zéro — la
 * vérité des mouvements et la valeur affichée divergeraient (audit du
 * 2026-11-11).
 */
export async function lockStockItem(tx: Prisma.TransactionClient, stockItemId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "StockItem" WHERE id = ${stockItemId} FOR UPDATE`;
}

export async function recomputeQuantity(tx: Prisma.TransactionClient, stockItemId: string): Promise<StockItem> {
  const movements = await tx.stockMovement.findMany({ where: { stockItemId }, select: { delta: true } });
  const quantity = sumMovements(movements.map((m) => m.delta.toNumber()));
  const current = await tx.stockItem.findUniqueOrThrow({ where: { id: stockItemId } });
  // Un lot à zéro est archivé, pas supprimé (section 6) ; un retour au-dessus de zéro le réactive.
  const archivedAt = quantity === 0 ? (current.archivedAt ?? new Date()) : null;
  return tx.stockItem.update({ where: { id: stockItemId }, data: { quantity, archivedAt } });
}
