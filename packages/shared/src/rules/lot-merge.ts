/**
 * Section 15 : deux saisies du même produit donnent deux lots si les dates
 * diffèrent, un seul lot à quantité incrémentée si elles sont identiques.
 */
export function sameExpiry(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function findMergeableLot<
  T extends { id: string; productId: string; locationId: string; expiryDate: Date | null; unit: string; archivedAt: Date | null },
>(lots: T[], incoming: { productId: string; locationId: string; expiryDate: Date | null; unit: string }): T | null {
  return (
    lots.find(
      (lot) =>
        lot.archivedAt === null &&
        lot.productId === incoming.productId &&
        lot.locationId === incoming.locationId &&
        lot.unit === incoming.unit &&
        sameExpiry(lot.expiryDate, incoming.expiryDate),
    ) ?? null
  );
}
