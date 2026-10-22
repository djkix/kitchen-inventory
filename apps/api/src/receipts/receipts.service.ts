import { Inject, Injectable } from '@nestjs/common';
import { matchReceiptLine, normalizeReceiptLabel, type AttachLabelInput, type PendingLabelDto, type ReceiptCandidate, type ReceiptDto, type ValidateReceiptInput } from '@kitchen/shared';
import { Logger } from 'nestjs-pino';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { toNumber } from '../common/decimal.js';
import type { RequestUser } from '../auth/request-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toProductDto } from '../products/product.mapper.js';
import { GeminiPausedError, geminiRefusal } from '../gemini/gemini-errors.js';
import { GeminiService } from '../gemini/gemini.service.js';
import { ProviderError } from '../recognition/providers/recognition-provider.js';
import { VISION_PROVIDER_NAMES } from '../recognition/recognition.service.js';
import { StockService } from '../stock/stock.service.js';
import { GeminiReceiptReader, ReceiptReadError } from './gemini-receipt.reader.js';

const PROVIDER = 'gemini';

/**
 * Lecture d'un ticket de caisse en brouillon (EF-29). Le service orchestre :
 * le modèle lit, `matchReceiptLine` (packages/shared) rapproche. Le fichier
 * est lu puis abandonné : ni `MediaService`, ni chemin, ni octets en journal.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: GeminiReceiptReader,
    private readonly gemini: GeminiService,
    private readonly stock: StockService,
    private readonly logger: Logger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async read(file: Buffer, mimeType: string, locationId: string, userId: string): Promise<ReceiptDto> {
    if (this.config.VISION_PROVIDER !== 'gemini' || !this.config.VISION_API_KEY) {
      throw ApiError.providerDisabled('Fournisseur de lecture de ticket désactivé : renseignez VISION_PROVIDER et VISION_API_KEY');
    }
    if (!(await this.prisma.location.findUnique({ where: { id: locationId } }))) throw ApiError.notFound('Emplacement introuvable');
    await this.assertQuota();

    const started = Date.now();
    let read;
    try {
      read = (await this.gemini.call((model) => this.reader.read(file, mimeType, model))).result;
    } catch (error) {
      // Gemini en pause ou quota atteint : rien n'est parti, rien à journaliser ; l'heure de reprise est dite.
      if (error instanceof GeminiPausedError) throw geminiRefusal(error);
      // Un ticket illisible a quand même été facturé : le coût entre au plafond mensuel.
      const billed = error instanceof ReceiptReadError;
      await this.log({ error: String(error instanceof Error ? error.message : error), ...(billed ? { response: error.raw } : {}) }, billed ? error.costCents : null, false, Date.now() - started);
      this.logger.warn({ latencyMs: Date.now() - started, err: error }, 'Échec de la lecture du ticket');
      const message = error instanceof ProviderError ? error.message : 'Fournisseur de lecture de ticket injoignable';
      throw billed ? ApiError.providerInvalidResponse(message) : ApiError.providerUnavailable(message);
    }
    await this.log(read.raw, read.costCents, true, Date.now() - started);

    const [products, aliases] = await Promise.all([
      this.prisma.product.findMany({ where: { mergedIntoId: null }, select: { id: true, name: true, defaultUnit: true } }),
      this.prisma.receiptLabelAlias.findMany(),
    ]);
    const catalog: ReceiptCandidate[] = products;
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const aliasByLabel = new Map(aliases.map((a) => [a.label, byId.get(a.productId) ?? null]));

    const receipt = await this.prisma.receipt.create({
      data: {
        locationId,
        createdById: userId,
        lines: {
          create: read.lines.map((line, position) => {
            const match = matchReceiptLine(line.label, aliasByLabel.get(normalizeReceiptLabel(line.label)) ?? null, catalog);
            return { position, rawLabel: line.label, quantity: line.quantity, state: match.state, productId: match.productId, candidateIds: match.candidateIds };
          }),
        },
      },
    });
    return this.get(receipt.id);
  }

  async get(id: string): Promise<ReceiptDto> {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!receipt) throw ApiError.notFound('Ticket introuvable');
    const ids = [...new Set(receipt.lines.flatMap((l) => [...(l.productId ? [l.productId] : []), ...l.candidateIds]))];
    const [products, stock] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, include: { category: true } }),
      this.prisma.stockItem.groupBy({ by: ['productId'], where: { productId: { in: ids }, locationId: receipt.locationId, archivedAt: null }, _sum: { quantity: true } }),
    ]);
    const dtos = new Map(products.map((p) => [p.id, toProductDto(p)]));
    const totals = new Map(stock.map((s) => [s.productId, toNumber(s._sum.quantity) ?? 0]));
    return {
      id: receipt.id,
      locationId: receipt.locationId,
      status: receipt.status,
      lines: receipt.lines.map((l) => ({
        id: l.id,
        position: l.position,
        rawLabel: l.rawLabel,
        quantity: toNumber(l.quantity) ?? 0,
        state: l.state,
        product: (l.productId && dtos.get(l.productId)) || null,
        candidates: l.candidateIds.flatMap((c) => dtos.get(c) ?? []),
        currentQuantity: (l.productId && totals.get(l.productId)) || 0,
      })),
    };
  }

  /**
   * Chaque ligne cochée passe par `StockService.create` (lot, mouvement, quantité
   * recalculée) : aucune logique de stock ici. Sans date, par décision D2. Les
   * lignes `UNKNOWN` ne créent aucun produit.
   */
  async validate(id: string, input: ValidateReceiptInput, user: RequestUser): Promise<{ added: number }> {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: { lines: true } });
    if (!receipt) throw ApiError.notFound('Ticket introuvable');
    const own = new Map(receipt.lines.map((l) => [l.id, l]));
    if (input.lines.some((l) => !own.has(l.id))) throw ApiError.notFound('Ligne introuvable sur ce ticket');

    if (receipt.status === 'VALIDATED') {
      // Un rejeu à l'identique (réponse perdue) réussit sans rien ajouter ; toute autre demande est refusée.
      const known = await this.prisma.stockMovement.count({ where: { clientOpId: { in: input.lines.map((l) => l.clientOpId) } } });
      if (known === input.lines.length) return { added: 0 };
      throw ApiError.conflict('Ce ticket a déjà été validé');
    }

    // Un produit n'entre que par sa propre ligne : le serveur ne s'en remet pas à l'écran.
    for (const line of input.lines) {
      const row = own.get(line.id)!;
      const allowed = row.state === 'MATCHED' ? row.productId === line.productId : row.state === 'AMBIGUOUS' && row.candidateIds.includes(line.productId);
      if (!allowed) {
        throw ApiError.businessRule(
          row.state === 'UNKNOWN'
            ? `La ligne « ${row.rawLabel} » n'est pas reconnue : elle ne peut pas être validée`
            : `Le produit choisi ne correspond pas à la ligne « ${row.rawLabel} »`,
        );
      }
    }

    let added = 0;
    for (const line of input.lines) {
      const { replayed } = await this.stock.create(
        { productId: line.productId, locationId: receipt.locationId, quantity: line.quantity, estimateExpiry: false, clientOpId: line.clientOpId },
        user,
      );
      if (!replayed) added++;
    }
    await this.prisma.receipt.update({ where: { id }, data: { status: 'VALIDATED' } });
    return { added };
  }

  /**
   * Lignes `UNKNOWN` dont la forme normalisée n'a pas d'alias, groupées par cette
   * forme (la même que celle de l'alias, donc la même que celle de la lecture).
   */
  async pendingLabels(): Promise<PendingLabelDto[]> {
    const [lines, aliases] = await Promise.all([
      this.prisma.receiptLine.findMany({ where: { state: 'UNKNOWN' }, select: { rawLabel: true, receipt: { select: { createdAt: true } } } }),
      this.prisma.receiptLabelAlias.findMany({ select: { label: true } }),
    ]);
    const learned = new Set(aliases.map((a) => a.label));
    const groups = new Map<string, { label: string; seenAt: Date; count: number }>();
    for (const line of lines) {
      const key = normalizeReceiptLabel(line.rawLabel);
      if (!key || learned.has(key)) continue; // sans mot significatif, rien à rattacher
      const seenAt = line.receipt.createdAt;
      const group = groups.get(key);
      if (!group) groups.set(key, { label: line.rawLabel, seenAt, count: 1 });
      else {
        group.count++;
        if (seenAt > group.seenAt) Object.assign(group, { label: line.rawLabel, seenAt });
      }
    }
    return [...groups.values()].sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime()).map((g) => ({ label: g.label, seenAt: g.seenAt.toISOString(), count: g.count }));
  }

  /** Corriger un rattachement est permis : l'alias existant est mis à jour. */
  async attachLabel({ label, productId }: AttachLabelInput): Promise<void> {
    const key = normalizeReceiptLabel(label);
    if (!key) throw ApiError.businessRule('Ce libellé ne contient aucun mot exploitable');
    if (!(await this.prisma.product.findFirst({ where: { id: productId, mergedIntoId: null } }))) throw ApiError.notFound('Produit introuvable');
    await this.prisma.receiptLabelAlias.upsert({ where: { label: key }, create: { label: key, productId }, update: { productId } });
  }

  /** Quota journalier propre aux tickets, et plafond mensuel partagé avec le scan et les suggestions. */
  private async assertQuota(): Promise<void> {
    const now = new Date();
    const callsToday = await this.prisma.recognitionLog.count({
      where: { purpose: 'RECEIPT', createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
    });
    if (callsToday >= this.config.RECEIPT_DAILY_QUOTA) {
      throw ApiError.rateLimited('Quota journalier de lecture de tickets atteint ; la saisie manuelle reste disponible', {
        callsToday,
        dailyQuota: this.config.RECEIPT_DAILY_QUOTA,
      });
    }
    const cap = this.config.VISION_MONTHLY_CAP_CENTS;
    if (cap > 0) {
      const spent = await this.prisma.recognitionLog.aggregate({
        where: { provider: { in: VISION_PROVIDER_NAMES }, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
        _sum: { costCents: true },
      });
      const spentCents = spent._sum.costCents?.toNumber() ?? 0;
      if (spentCents >= cap) {
        throw ApiError.rateLimited('Plafond de dépense mensuel atteint ; la saisie manuelle reste disponible', {
          spentCents: Math.round(spentCents * 100) / 100,
          monthlyCapCents: cap,
        });
      }
    }
  }

  private async log(raw: unknown, costCents: number | null, succeeded: boolean, latencyMs: number): Promise<void> {
    await this.prisma.recognitionLog.create({
      data: { provider: PROVIDER, purpose: 'RECEIPT', succeeded, costCents, latencyMs, rawResult: JSON.parse(JSON.stringify(raw ?? null)) as object },
    });
  }
}
