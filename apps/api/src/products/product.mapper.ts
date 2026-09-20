import type { ProductDto } from '@kitchen/shared';
import type { Category, Product } from '@prisma/client';
import { toNumber } from '../common/decimal.js';

export type ProductWithCategory = Product & { category: Category | null };

export function toProductDto(p: ProductWithCategory): ProductDto {
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    originalName: p.originalName,
    brand: p.brand,
    categoryId: p.categoryId,
    category: p.category ? { id: p.category.id, name: p.category.name, icon: p.category.icon } : null,
    defaultUnit: p.defaultUnit,
    netContent: toNumber(p.netContent),
    netContentUnit: p.netContentUnit,
    afterOpeningDays: p.afterOpeningDays,
    minThreshold: toNumber(p.minThreshold),
    imagePath: p.imagePath,
    recognitionSource: p.recognitionSource,
    confidence: p.confidence,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
