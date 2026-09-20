import { Injectable } from '@nestjs/common';
import {
  capConsumption,
  computeEffectiveExpiry,
  estimateExpiry,
  expandSearchTerms,
  findMergeableLot,
  roundQuantity,
  sameFamily,
  UNIT_LABELS_FR,
  type AdjustStockInput,
  type ConsumeStockInput,
  type CreateStockItemInput,
  type Paginated,
  type StockItemDto,
  type StockListQuery,
  type StockWriteResult,
  type UpdateStockItemInput,
} from '@kitchen/shared';
import { Prisma, type Unit } from '@prisma/client';
import type { RequestUser } from '../auth/request-user.js';
import { ApiError } from '../common/api-error.js';
import { parseCivilDate } from '../common/decimal.js';
import { paginate, skipTake } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { toMovementDto, toStockItemDto, type StockItemRow } from './stock.mapper.js';
import { applyMovement, type MovementResult } from './stock.quantity.js';

const INCLUDE = { product: { include: { category: true } }, location: true } as const;

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: StockListQuery): Promise<Paginated<StockItemDto>> {
    const alertDays = await this.settings.expiryAlertDays();
    const where: Prisma.StockItemWhereInput = {};
    if (query.status === 'active') where.archivedAt = null;
    if (query.status === 'archived') where.archivedAt = { not: null };
    if (query.product) where.productId = query.product;
    if (query.expiringBefore) where.effectiveExpiry = { lte: parseCivilDate(query.expiringBefore) ?? undefined };
    if (query.location) {
      const location = await this.prisma.location.findUnique({ where: { id: query.location } });
      if (!location) throw ApiError.notFound('Emplacement introuvable');
      where.location = { OR: [{ id: location.id }, { path: { startsWith: `${location.path}/` } }] };
    }
    if (query.q) {
      const terms = expandSearchTerms(query.q);
      where.product = {
        OR: terms.flatMap((t) => [
          { name: { contains: t, mode: 'insensitive' } },
          { originalName: { contains: t, mode: 'insensitive' } },
          { brand: { contains: t, mode: 'insensitive' } },
        ]),
      };
    }
    const { skip, take } = skipTake(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ effectiveExpiry: { sort: 'asc', nulls: 'last' } }, { product: { name: 'asc' } }, { createdAt: 'asc' }],
        skip,
        take,
      }),
      this.prisma.stockItem.count({ where }),
    ]);
    return paginate(rows.map((r) => toStockItemDto(r, alertDays)), total, query.page, query.limit);
  }

  /** EF-09 : articles périmant sous X jours ; ceux sans date n'y figurent jamais. */
  async expiring(days?: number): Promise<{ items: StockItemDto[]; alertDays: number }> {
    const alertDays = await this.settings.expiryAlertDays();
    const horizon = days ?? alertDays;
    const limit = new Date();
    limit.setDate(limit.getDate() + horizon);
    limit.setHours(23, 59, 59, 999);
    const rows = await this.prisma.stockItem.findMany({
      where: { archivedAt: null, effectiveExpiry: { not: null, lte: limit } },
      include: INCLUDE,
      orderBy: [{ effectiveExpiry: 'asc' }, { product: { name: 'asc' } }],
    });
    return { items: rows.map((r) => toStockItemDto(r, alertDays)), alertDays };
  }

  async get(id: string): Promise<StockItemDto> {
    const row = await this.prisma.stockItem.findUnique({
      where: { id },
      include: { ...INCLUDE, movements: { include: { user: true }, orderBy: { occurredAt: 'desc' } } },
    });
    if (!row) throw ApiError.notFound('Lot introuvable');
    return toStockItemDto(row, await this.settings.expiryAlertDays());
  }

  async create(input: CreateStockItemInput, user: RequestUser): Promise<StockWriteResult> {
    const product = await this.prisma.product.findUnique({ where: { id: input.productId }, include: { category: true } });
    if (!product) throw ApiError.notFound('Produit introuvable');
    if (!(await this.prisma.location.findUnique({ where: { id: input.locationId } }))) throw ApiError.notFound('Emplacement introuvable');

    const unit: Unit = input.unit ?? product.defaultUnit;
    if (!sameFamily(unit, product.defaultUnit)) {
      throw ApiError.businessRule(
        `Unité incompatible avec celle du produit (${UNIT_LABELS_FR[product.defaultUnit]}) : ${UNIT_LABELS_FR[unit]}`,
      );
    }

    let expiryDate = parseCivilDate(input.expiryDate);
    let dateType = input.dateType ?? null;
    let dateEstimated = false;
    if (!expiryDate && input.estimateExpiry && product.category?.shelfLifeDays != null) {
      expiryDate = estimateExpiry(new Date(), product.category.shelfLifeDays);
      dateType = dateType ?? 'BEST_BEFORE';
      dateEstimated = true;
    }
    if (expiryDate && !dateType) dateType = 'USE_BY';

    const result = await this.prisma.$transaction(async (tx) => {
      if (input.clientOpId) {
        const existing = await tx.stockMovement.findUnique({ where: { clientOpId: input.clientOpId } });
        if (existing) {
          const item = await tx.stockItem.findUniqueOrThrow({ where: { id: existing.stockItemId }, include: INCLUDE });
          return { item, movement: existing, replayed: true, merged: false };
        }
      }
      const activeLots = await tx.stockItem.findMany({ where: { productId: product.id, locationId: input.locationId, archivedAt: null } });
      const mergeable = findMergeableLot(activeLots, { productId: product.id, locationId: input.locationId, expiryDate, unit });
      const target =
        mergeable ??
        (await tx.stockItem.create({
          data: {
            productId: product.id,
            locationId: input.locationId,
            quantity: 0,
            unit,
            expiryDate,
            dateType,
            dateEstimated,
            effectiveExpiry: computeEffectiveExpiry({ expiryDate, openedAt: null, afterOpeningDays: null }),
            purchasePrice: input.purchasePrice ?? null,
          },
        }));
      const applied = await applyMovement(tx, {
        stockItemId: target.id,
        type: 'INBOUND',
        delta: input.quantity,
        userId: writerId(user),
        clientOpId: input.clientOpId ?? null,
      });
      const item = await tx.stockItem.findUniqueOrThrow({ where: { id: target.id }, include: INCLUDE });
      return { ...applied, item, merged: mergeable !== null };
    });
    return this.toResult(result, { merged: result.merged });
  }

  /** EF-10 : consommation plafonnée au stock disponible (section 15). */
  async consume(id: string, input: ConsumeStockInput, user: RequestUser): Promise<StockWriteResult> {
    const item = await this.requireActive(id);
    const { delta, capped } = capConsumption(item.quantity.toNumber(), input.quantity);
    const result = await this.prisma.$transaction((tx) =>
      applyMovement(tx, {
        stockItemId: id,
        type: capped ? 'ADJUSTMENT' : 'CONSUMPTION',
        delta,
        reason: capped ? `Consommation de ${formatQty(input.quantity)} ramenée au stock disponible` : (input.reason ?? null),
        userId: writerId(user),
        clientOpId: input.clientOpId ?? null,
      }),
    );
    const available = item.quantity.toNumber();
    return this.toResult(result, {
      capped,
      ...(capped ? { message: `Quantité ramenée au stock disponible (${formatQty(available)} ${UNIT_LABELS_FR[item.unit]})` } : {}),
    });
  }

  /** Ajustement libre (inventaire, annulation). Ne descend jamais sous zéro. */
  async adjust(id: string, input: AdjustStockInput, user: RequestUser): Promise<StockWriteResult> {
    const item = await this.require(id);
    if (roundQuantity(item.quantity.toNumber() + input.delta) < 0) {
      throw ApiError.businessRule('L’ajustement ferait passer la quantité sous zéro');
    }
    const result = await this.prisma.$transaction((tx) =>
      applyMovement(tx, {
        stockItemId: id,
        type: 'ADJUSTMENT',
        delta: roundQuantity(input.delta),
        reason: input.reason ?? null,
        userId: writerId(user),
        clientOpId: input.clientOpId ?? null,
      }),
    );
    return this.toResult(result, {});
  }

  /** Jeter un lot : mouvement de perte pour tout le reste, puis archivage. */
  async discard(id: string, user: RequestUser, reason?: string): Promise<StockWriteResult> {
    const item = await this.requireActive(id);
    const result = await this.prisma.$transaction((tx) =>
      applyMovement(tx, { stockItemId: id, type: 'LOSS', delta: -item.quantity.toNumber(), reason: reason ?? 'Jeté', userId: writerId(user) }),
    );
    return this.toResult(result, {});
  }

  /** Section 15 : à l'ouverture, date effective = min(DLC, ouverture + durée après ouverture). */
  async open(id: string): Promise<StockItemDto> {
    const item = await this.prisma.stockItem.findUnique({ where: { id }, include: INCLUDE });
    if (!item) throw ApiError.notFound('Lot introuvable');
    const openedAt = item.openedAt ?? new Date();
    const afterOpeningDays = item.product.afterOpeningDays ?? item.product.category?.afterOpeningDays ?? null;
    await this.prisma.stockItem.update({
      where: { id },
      data: { opened: true, openedAt, effectiveExpiry: computeEffectiveExpiry({ expiryDate: item.expiryDate, openedAt, afterOpeningDays }) },
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateStockItemInput): Promise<StockItemDto> {
    const item = await this.prisma.stockItem.findUnique({ where: { id }, include: INCLUDE });
    if (!item) throw ApiError.notFound('Lot introuvable');
    const expiryDate = input.expiryDate !== undefined ? parseCivilDate(input.expiryDate) : item.expiryDate;
    const dateType = input.dateType !== undefined ? input.dateType : expiryDate && !item.dateType ? 'USE_BY' : item.dateType;
    const afterOpeningDays = item.product.afterOpeningDays ?? item.product.category?.afterOpeningDays ?? null;
    await this.prisma.stockItem.update({
      where: { id },
      data: {
        expiryDate,
        dateType: expiryDate ? dateType : null,
        dateEstimated: input.dateEstimated ?? (input.expiryDate !== undefined ? false : item.dateEstimated),
        effectiveExpiry: computeEffectiveExpiry({ expiryDate, openedAt: item.opened ? item.openedAt : null, afterOpeningDays }),
        ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
      },
    });
    return this.get(id);
  }

  async move(id: string, locationId: string): Promise<StockItemDto> {
    await this.require(id);
    if (!(await this.prisma.location.findUnique({ where: { id: locationId } }))) throw ApiError.notFound('Emplacement introuvable');
    await this.prisma.stockItem.update({ where: { id }, data: { locationId } });
    return this.get(id);
  }

  private async require(id: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw ApiError.notFound('Lot introuvable');
    return item;
  }

  private async requireActive(id: string) {
    const item = await this.require(id);
    if (item.archivedAt || item.quantity.toNumber() <= 0) throw ApiError.businessRule('Ce lot est déjà épuisé');
    return item;
  }

  private async toResult(result: MovementResult & { item: StockItemRow | MovementResult['item'] }, extra: Partial<StockWriteResult>): Promise<StockWriteResult> {
    const alertDays = await this.settings.expiryAlertDays();
    const row =
      'product' in result.item
        ? (result.item as StockItemRow)
        : await this.prisma.stockItem.findUniqueOrThrow({ where: { id: result.item.id }, include: INCLUDE });
    return {
      item: toStockItemDto(row, alertDays),
      movement: toMovementDto(result.movement),
      replayed: result.replayed,
      merged: false,
      capped: false,
      ...extra,
    };
  }
}

function writerId(user: RequestUser): string | null {
  return user.via === 'session' ? user.id : null;
}

function formatQty(value: number): string {
  return roundQuantity(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
