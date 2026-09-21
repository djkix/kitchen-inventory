import { Inject, Injectable } from '@nestjs/common';
import { normalizeProductName, VISION_REJECT_THRESHOLD, VISION_REVIEW_THRESHOLD, type ProductDto, type RecognitionStats, type ScanBarcodeResult, type ScanImageResult } from '@kitchen/shared';
import { Logger } from 'nestjs-pino';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProductsService } from '../products/products.service.js';
import { OpenFoodFactsClient } from './open-food-facts.client.js';
import { ProviderError, RECOGNITION_PROVIDER, type RecognitionProvider } from './providers/recognition-provider.js';

const OFF_PROVIDER = 'open_food_facts';

/** Cascade de reconnaissance de la section 5 : cache local → Open Food Facts → vision. */
@Injectable()
export class RecognitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly off: OpenFoodFactsClient,
    private readonly media: MediaService,
    private readonly logger: Logger,
    @Inject(RECOGNITION_PROVIDER) private readonly provider: RecognitionProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Niveaux 1 à 3. `null` si le code est inconnu partout : le client bascule sur la photo. */
  async resolveBarcode(barcode: string): Promise<ScanBarcodeResult | null> {
    const cached = await this.products.findByBarcode(barcode);
    if (cached) {
      await this.prisma.recognitionLog.create({ data: { barcode, provider: 'cache', succeeded: true, latencyMs: 0 } });
      return { product: cached, source: 'cache' };
    }
    const started = Date.now();
    const lookup = await this.off.lookup(barcode);
    if (!lookup) {
      await this.prisma.recognitionLog.create({ data: { barcode, provider: OFF_PROVIDER, succeeded: false, latencyMs: Date.now() - started } });
      return null;
    }
    const category = lookup.categoryName ? await this.prisma.category.findUnique({ where: { name: lookup.categoryName } }) : null;
    let imagePath: string | null = null;
    if (lookup.imageUrl) {
      const image = await this.off.downloadImage(lookup.imageUrl);
      if (image && this.media.isSupportedMime(image.mimeType)) imagePath = await this.media.save(image.buffer, image.mimeType, 'products');
    }
    let product: ProductDto;
    try {
      product = await this.products.create({ ...lookup.input, categoryId: category?.id ?? null, imagePath }, { recognitionSource: 'OPEN_FOOD_FACTS' });
    } catch (error) {
      // Deux scans simultanés du même code : le premier a gagné, on le renvoie.
      const existing = await this.products.findByBarcode(barcode);
      if (existing) return { product: existing, source: 'cache' };
      throw error;
    }
    await this.prisma.recognitionLog.create({
      data: { barcode, provider: OFF_PROVIDER, succeeded: true, latencyMs: Date.now() - started, rawResult: toJson(lookup.raw), correctedTo: product.id, imagePath },
    });
    return { product, source: 'off' };
  }

  /** Niveau 4 : photo envoyée au fournisseur de vision, sous quota journalier. */
  async recognizeImage(image: Buffer, mimeType: string, hint: string | undefined, barcode: string | undefined): Promise<ScanImageResult> {
    if (!this.provider.enabled) {
      throw ApiError.businessRule('Fournisseur de vision désactivé : renseignez VISION_PROVIDER et VISION_API_KEY');
    }
    const callsToday = await this.countVisionCalls(startOfDay(new Date()));
    if (callsToday >= this.config.VISION_DAILY_QUOTA) {
      throw ApiError.rateLimited('Quota journalier de reconnaissance photo atteint ; le scan de code-barres reste disponible', {
        callsToday,
        dailyQuota: this.config.VISION_DAILY_QUOTA,
      });
    }
    const imagePath = await this.media.save(image, mimeType, 'scans');
    const started = Date.now();
    try {
      const output = await this.provider.recognize({ image, mimeType, hint });
      const latencyMs = Date.now() - started;
      const log = await this.prisma.recognitionLog.create({
        data: {
          imagePath,
          barcode: barcode ?? null,
          provider: this.provider.name,
          rawResult: toJson(output.raw),
          confidence: output.suggestion.confidence,
          costCents: output.costCents,
          latencyMs,
          succeeded: output.suggestion.confidence >= VISION_REJECT_THRESHOLD,
        },
      });
      this.logger.log({ provider: this.provider.name, latencyMs, costCents: output.costCents, confidence: output.suggestion.confidence }, 'Appel au fournisseur de vision');
      const category = output.suggestion.category ? await this.matchCategory(output.suggestion.category) : null;
      return {
        suggestion: output.suggestion,
        confidence: output.suggestion.confidence,
        rawId: log.id,
        imagePath,
        categoryId: category,
        needsReview: output.suggestion.confidence < VISION_REVIEW_THRESHOLD,
        rejected: output.suggestion.confidence < VISION_REJECT_THRESHOLD,
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      // L'échec est conservé avec sa photo : c'est un article « à identifier » à rejouer (section 17).
      const log = await this.prisma.recognitionLog.create({
        data: { imagePath, barcode: barcode ?? null, provider: this.provider.name, succeeded: false, latencyMs, rawResult: toJson({ error: String(error instanceof Error ? error.message : error) }) },
      });
      this.logger.warn({ provider: this.provider.name, latencyMs, err: error }, 'Échec du fournisseur de vision');
      const message = error instanceof ProviderError ? error.message : 'Fournisseur de vision injoignable';
      throw ApiError.providerUnavailable(message, { imagePath, rawId: log.id });
    }
  }

  /** EF-14 : la correction manuelle d'une reconnaissance est mémorisée. */
  async recordCorrection(rawId: string, productId: string): Promise<void> {
    const log = await this.prisma.recognitionLog.findUnique({ where: { id: rawId } });
    if (!log) throw ApiError.notFound('Reconnaissance introuvable');
    await this.products.get(productId);
    await this.prisma.recognitionLog.update({ where: { id: rawId }, data: { correctedTo: productId } });
    if (log.barcode) {
      const product = await this.prisma.product.findUnique({ where: { id: productId } });
      if (product && !product.barcode && !(await this.prisma.product.findUnique({ where: { barcode: log.barcode } }))) {
        await this.prisma.product.update({ where: { id: productId }, data: { barcode: log.barcode } });
      }
    }
  }

  /** Compteurs de la section 21. */
  async stats(): Promise<RecognitionStats> {
    const now = new Date();
    const dayStart = startOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const visionProviders = ['gemini', 'anthropic', 'openai', 'ollama'];
    const [visionCallsToday, monthAgg, recent, pendingIdentification] = await Promise.all([
      this.countVisionCalls(dayStart),
      this.prisma.recognitionLog.aggregate({ where: { provider: { in: visionProviders }, createdAt: { gte: monthStart } }, _count: { _all: true }, _sum: { costCents: true } }),
      this.prisma.recognitionLog.findMany({ where: { createdAt: { gte: thirtyDaysAgo }, provider: { not: 'cache' } }, select: { provider: true, succeeded: true } }),
      this.prisma.recognitionLog.count({ where: { provider: { in: visionProviders }, succeeded: false, correctedTo: null, imagePath: { not: null } } }),
    ]);
    const cacheHits = await this.prisma.recognitionLog.count({ where: { createdAt: { gte: thirtyDaysAgo }, provider: 'cache' } });
    const attempts = recent.length + cacheHits;
    const automatic = cacheHits + recent.filter((r) => r.succeeded).length;
    return {
      visionCallsToday,
      visionCallsThisMonth: monthAgg._count._all,
      visionCostCentsThisMonth: Math.round((monthAgg._sum.costCents?.toNumber() ?? 0) * 100) / 100,
      dailyQuota: this.config.VISION_DAILY_QUOTA,
      automaticRate30d: attempts > 0 ? Math.round((automatic / attempts) * 1000) / 1000 : null,
      cacheShare30d: attempts > 0 ? Math.round((cacheHits / attempts) * 1000) / 1000 : null,
      pendingIdentification,
      provider: this.provider.name,
    };
  }

  private countVisionCalls(since: Date): Promise<number> {
    return this.prisma.recognitionLog.count({ where: { provider: this.provider.name, createdAt: { gte: since } } });
  }

  private async matchCategory(name: string): Promise<string | null> {
    const wanted = normalizeProductName(name);
    const categories = await this.prisma.category.findMany({ select: { id: true, name: true } });
    return categories.find((c) => normalizeProductName(c.name) === wanted)?.id ?? categories.find((c) => normalizeProductName(c.name).startsWith(wanted.split(' ')[0] ?? ''))?.id ?? null;
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toJson(value: unknown): object {
  return JSON.parse(JSON.stringify(value ?? null)) as object;
}
