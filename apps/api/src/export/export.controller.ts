import { Controller, Get, Header } from '@nestjs/common';
import { UNIT_LABELS_FR } from '@kitchen/shared';
import { formatCivilDate, toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface ExportRow {
  productId: string;
  product: string;
  originalName: string | null;
  brand: string | null;
  barcode: string | null;
  category: string | null;
  location: string;
  locationPath: string;
  quantity: number;
  unit: string;
  expiryDate: string | null;
  dateType: string | null;
  dateEstimated: boolean;
  opened: boolean;
  effectiveExpiry: string | null;
  createdAt: string;
}

/** EF-16 : export de l'inventaire actif, protégé par la session comme tout le reste. */
@Controller('export')
export class ExportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('inventory.json')
  json(): Promise<ExportRow[]> {
    return this.rows();
  }

  @Get('inventory.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="inventaire.csv"')
  async csv(): Promise<string> {
    const rows = await this.rows();
    const header = ['produit', 'nom_origine', 'marque', 'code_barres', 'categorie', 'emplacement', 'chemin', 'quantite', 'unite', 'date_peremption', 'type_date', 'date_estimee', 'ouvert', 'date_effective', 'cree_le'];
    const lines = rows.map((r) =>
      [r.product, r.originalName, r.brand, r.barcode, r.category, r.location, r.locationPath, r.quantity, UNIT_LABELS_FR[r.unit as keyof typeof UNIT_LABELS_FR] ?? r.unit, r.expiryDate, r.dateType, r.dateEstimated, r.opened, r.effectiveExpiry, r.createdAt]
        .map(csvCell)
        .join(';'),
    );
    // BOM pour qu'Excel ouvre l'UTF-8 (idéogrammes) correctement.
    return `\uFEFF${[header.join(';'), ...lines].join('\r\n')}\r\n`;
  }

  private async rows(): Promise<ExportRow[]> {
    const items = await this.prisma.stockItem.findMany({
      where: { archivedAt: null },
      include: { product: { include: { category: true } }, location: true },
      orderBy: [{ location: { path: 'asc' } }, { product: { name: 'asc' } }],
    });
    return items.map((i) => ({
      productId: i.productId,
      product: i.product.name,
      originalName: i.product.originalName,
      brand: i.product.brand,
      barcode: i.product.barcode,
      category: i.product.category?.name ?? null,
      location: i.location.name,
      locationPath: i.location.path,
      quantity: toNumber(i.quantity) ?? 0,
      unit: i.unit,
      expiryDate: formatCivilDate(i.expiryDate),
      dateType: i.dateType,
      dateEstimated: i.dateEstimated,
      opened: i.opened,
      effectiveExpiry: formatCivilDate(i.effectiveExpiry),
      createdAt: i.createdAt.toISOString(),
    }));
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'boolean' ? (value ? 'oui' : 'non') : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
