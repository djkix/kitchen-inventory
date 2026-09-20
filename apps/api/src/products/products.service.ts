import { Injectable } from '@nestjs/common';
import { findDuplicateCandidates, sameFamily, UNIT_FAMILY, type CreateProductInput, type Paginated, type ProductDto, type ProductListQuery, type UpdateProductInput } from '@kitchen/shared';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { paginate, skipTake } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toProductDto, type ProductWithCategory } from './product.mapper.js';
import { searchProductIds } from './products.search.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ProductListQuery): Promise<Paginated<ProductDto>> {
    const { skip, take } = skipTake(query.page, query.limit);
    if (query.q && query.q.length > 0) {
      const { ids, total } = await searchProductIds(this.prisma, query.q, { categoryId: query.category }, { skip, take });
      const rows = await this.prisma.product.findMany({ where: { id: { in: ids } }, include: { category: true } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = ids.map((id) => byId.get(id)).filter((r): r is ProductWithCategory => r !== undefined);
      return paginate(ordered.map(toProductDto), total, query.page, query.limit);
    }
    const where: Prisma.ProductWhereInput = { mergedIntoId: null, ...(query.category ? { categoryId: query.category } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({ where, include: { category: true }, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(rows.map(toProductDto), total, query.page, query.limit);
  }

  async get(id: string): Promise<ProductDto> {
    return toProductDto(await this.require(id));
  }

  /** Suit la chaîne de fusion : un code-barres d'un doublon archivé renvoie le produit cible. */
  async findByBarcode(barcode: string): Promise<ProductDto | null> {
    let product = await this.prisma.product.findUnique({ where: { barcode }, include: { category: true } });
    let hops = 0;
    while (product?.mergedIntoId && hops < 10) {
      product = await this.prisma.product.findUnique({ where: { id: product.mergedIntoId }, include: { category: true } });
      hops++;
    }
    return product ? toProductDto(product) : null;
  }

  async create(input: CreateProductInput, extra: { recognitionSource?: 'BARCODE_CACHE' | 'OPEN_FOOD_FACTS' | 'VISION' | 'MANUAL'; confidence?: number | null } = {}): Promise<ProductDto> {
    this.validateNetContent(input.netContent ?? null, input.netContentUnit ?? null);
    if (input.barcode) {
      const existing = await this.prisma.product.findUnique({ where: { barcode: input.barcode } });
      if (existing) throw ApiError.conflict('Un produit existe déjà avec ce code-barres', { existingId: existing.id });
    }
    if (input.categoryId) await this.requireCategory(input.categoryId);
    const created = await this.prisma.product.create({
      data: {
        name: input.name,
        barcode: input.barcode ?? null,
        originalName: input.originalName ?? null,
        brand: input.brand ?? null,
        categoryId: input.categoryId ?? null,
        defaultUnit: input.defaultUnit,
        netContent: input.netContent ?? null,
        netContentUnit: input.netContentUnit ?? null,
        afterOpeningDays: input.afterOpeningDays ?? null,
        minThreshold: input.minThreshold ?? null,
        imagePath: input.imagePath ?? null,
        recognitionSource: extra.recognitionSource ?? 'MANUAL',
        confidence: extra.confidence ?? null,
      },
      include: { category: true },
    });
    if (input.recognitionLogId) {
      // EF-14 : la fiche créée depuis une reconnaissance en garde la trace.
      await this.prisma.recognitionLog.updateMany({ where: { id: input.recognitionLogId }, data: { correctedTo: created.id } });
    }
    return toProductDto(created);
  }

  async update(id: string, input: UpdateProductInput): Promise<ProductDto> {
    const current = await this.require(id);
    const netContent = input.netContent !== undefined ? input.netContent : (current.netContent?.toNumber() ?? null);
    const netContentUnit = input.netContentUnit !== undefined ? input.netContentUnit : current.netContentUnit;
    this.validateNetContent(netContent, netContentUnit);
    if (input.barcode && input.barcode !== current.barcode) {
      const existing = await this.prisma.product.findUnique({ where: { barcode: input.barcode } });
      if (existing) throw ApiError.conflict('Un produit existe déjà avec ce code-barres', { existingId: existing.id });
    }
    if (input.categoryId) await this.requireCategory(input.categoryId);
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.originalName !== undefined ? { originalName: input.originalName } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.defaultUnit !== undefined ? { defaultUnit: input.defaultUnit } : {}),
        ...(input.netContent !== undefined ? { netContent: input.netContent } : {}),
        ...(input.netContentUnit !== undefined ? { netContentUnit: input.netContentUnit } : {}),
        ...(input.afterOpeningDays !== undefined ? { afterOpeningDays: input.afterOpeningDays } : {}),
        ...(input.minThreshold !== undefined ? { minThreshold: input.minThreshold } : {}),
        ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
      },
      include: { category: true },
    });
    return toProductDto(updated);
  }

  /** Section 15 : rapprochement par nom normalisé et marque, proposition au-delà de 90 %. */
  async checkDuplicates(name: string, brand: string | null, excludeId?: string): Promise<Array<{ product: ProductDto; score: number }>> {
    const products = await this.prisma.product.findMany({ where: { mergedIntoId: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, include: { category: true } });
    return findDuplicateCandidates({ name, brand }, products).map((c) => ({ product: toProductDto(c.product), score: Math.round(c.score * 1000) / 1000 }));
  }

  /** Transfère lots, mouvements et références vers la cible, puis archive le doublon sans le supprimer. */
  async merge(sourceId: string, targetId: string): Promise<ProductDto> {
    if (sourceId === targetId) throw ApiError.businessRule('Un produit ne peut pas être fusionné avec lui-même');
    const [source, target] = await Promise.all([this.require(sourceId), this.require(targetId)]);
    if (source.mergedIntoId) throw ApiError.businessRule('Ce produit a déjà été fusionné');
    if (target.mergedIntoId) throw ApiError.businessRule('La cible a elle-même été fusionnée dans un autre produit');
    if (!sameFamily(source.defaultUnit, target.defaultUnit) && UNIT_FAMILY[source.defaultUnit] !== UNIT_FAMILY[target.defaultUnit]) {
      // Les lots gardent leur unité : la fusion reste possible, on l'indique seulement dans le journal applicatif.
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.stockItem.updateMany({ where: { productId: sourceId }, data: { productId: targetId } });
      await tx.recipeIngredient.updateMany({ where: { productId: sourceId }, data: { productId: targetId } });
      await tx.shoppingListItem.updateMany({ where: { productId: sourceId }, data: { productId: targetId } });
      const barcodeToTransfer = source.barcode && !target.barcode ? source.barcode : null;
      await tx.product.update({ where: { id: sourceId }, data: { mergedIntoId: targetId, ...(barcodeToTransfer ? { barcode: null } : {}) } });
      await tx.product.update({
        where: { id: targetId },
        data: {
          ...(barcodeToTransfer ? { barcode: barcodeToTransfer } : {}),
          ...(!target.imagePath && source.imagePath ? { imagePath: source.imagePath } : {}),
          ...(!target.originalName && source.originalName ? { originalName: source.originalName } : {}),
        },
      });
    });
    return this.get(targetId);
  }

  async require(id: string): Promise<ProductWithCategory> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { category: true } });
    if (!product) throw ApiError.notFound('Produit introuvable');
    return product;
  }

  private async requireCategory(id: string): Promise<void> {
    if (!(await this.prisma.category.findUnique({ where: { id } }))) throw ApiError.notFound('Catégorie introuvable');
  }

  private validateNetContent(netContent: number | null, unit: string | null): void {
    if (netContent === null) return;
    if (!unit || !['mass', 'volume'].includes(UNIT_FAMILY[unit as keyof typeof UNIT_FAMILY])) {
      throw ApiError.businessRule('La contenance doit être exprimée en masse (g, kg) ou en volume (ml, l)');
    }
  }
}
