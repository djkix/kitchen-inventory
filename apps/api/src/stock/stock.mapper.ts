import { daysUntil, expiryStatus, type StockItemDto, type StockMovementDto } from '@kitchen/shared';
import type { Category, Location, Product, StockItem, StockMovement, User } from '@prisma/client';
import { formatCivilDate, toNumber } from '../common/decimal.js';
import { toProductDto } from '../products/product.mapper.js';

export type StockItemRow = StockItem & {
  product: Product & { category: Category | null };
  location: Location;
  movements?: Array<StockMovement & { user: User | null }>;
};

export function toStockItemDto(row: StockItemRow, alertDays: number, today = new Date()): StockItemDto {
  const status = expiryStatus({ effectiveExpiry: row.effectiveExpiry, dateType: row.dateType, dateEstimated: row.dateEstimated }, today, alertDays);
  return {
    id: row.id,
    productId: row.productId,
    product: toProductDto(row.product),
    locationId: row.locationId,
    location: { id: row.location.id, name: row.location.name, path: row.location.path },
    quantity: toNumber(row.quantity) ?? 0,
    unit: row.unit,
    expiryDate: formatCivilDate(row.expiryDate),
    dateType: row.dateType,
    dateEstimated: row.dateEstimated,
    opened: row.opened,
    openedAt: row.openedAt?.toISOString() ?? null,
    effectiveExpiry: formatCivilDate(row.effectiveExpiry),
    expiryStatus: status,
    daysUntilExpiry: row.effectiveExpiry ? daysUntil(row.effectiveExpiry, today) : null,
    purchasePrice: toNumber(row.purchasePrice),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(row.movements ? { movements: row.movements.map(toMovementDto) } : {}),
  };
}

export function toMovementDto(m: StockMovement & { user?: User | null }): StockMovementDto {
  return {
    id: m.id,
    type: m.type,
    delta: toNumber(m.delta) ?? 0,
    reason: m.reason,
    userId: m.userId,
    userName: m.user?.name ?? null,
    occurredAt: m.occurredAt.toISOString(),
  };
}
