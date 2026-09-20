import { Inject, Injectable } from '@nestjs/common';
import type { CreateProductInput, Unit } from '@kitchen/shared';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';

interface OffProduct {
  product_name?: string;
  product_name_fr?: string;
  brands?: string;
  categories_tags?: string[];
  product_quantity?: string | number;
  product_quantity_unit?: string;
  quantity?: string;
  image_front_small_url?: string;
  image_front_url?: string;
  [key: string]: unknown;
}

interface OffResponse {
  status?: number;
  product?: OffProduct;
}

export interface OffLookup {
  input: Omit<CreateProductInput, 'barcode'> & { barcode: string };
  categoryName: string | null;
  imageUrl: string | null;
  raw: unknown;
}

/** Correspondance grossière entre les tags Open Food Facts et les catégories de la section 22. */
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/frozen/, 'Surgelés'],
  [/canned|conserve/, 'Conserves'],
  [/noodle|pasta|rice|cereal|flour|grain|legume|bean|lentil|biscuit|snack|cracker/, 'Épicerie sèche'],
  [/sauce|condiment|spread|vinegar|mustard|ketchup|mayonnaise|oil/, 'Sauces et condiments'],
  [/spice|herb|seasoning|salt|pepper/, 'Épices et aromates'],
  [/dair|cheese|yogurt|milk|cream|butter/, 'Produits laitiers'],
  [/beverage|drink|juice|water|soda|tea|coffee/, 'Boissons'],
  [/bread|viennoiserie|pastr|bakery/, 'Pain et viennoiserie'],
  [/egg/, 'Œufs'],
  [/fish|seafood|shrimp|tuna|salmon/, 'Poisson frais'],
  [/meat|poultry|chicken|beef|pork|ham|sausage/, 'Viande fraîche'],
  [/fruit/, 'Fruits frais'],
  [/vegetable/, 'Légumes frais'],
];

const UNIT_MAP: Record<string, { unit: Unit; factor: number }> = {
  g: { unit: 'GRAM', factor: 1 },
  gr: { unit: 'GRAM', factor: 1 },
  kg: { unit: 'KILOGRAM', factor: 1 },
  ml: { unit: 'MILLILITER', factor: 1 },
  cl: { unit: 'MILLILITER', factor: 10 },
  l: { unit: 'LITER', factor: 1 },
};

const ORIGINAL_NAME_LANGS = ['ja', 'ko', 'zh', 'th', 'vi'];

/**
 * Section 5, niveau 3 : Open Food Facts, sans clé, avec l'en-tête User-Agent
 * demandé par le projet. Un échec réseau renvoie null et se journalise ; il ne
 * bloque jamais le scan (section 17).
 */
@Injectable()
export class OpenFoodFactsClient {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_CLIENT) private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  async lookup(barcode: string): Promise<OffLookup | null> {
    const fields = ['product_name', 'product_name_fr', 'brands', 'categories_tags', 'product_quantity', 'product_quantity_unit', 'quantity', 'image_front_small_url', 'image_front_url', ...ORIGINAL_NAME_LANGS.map((l) => `product_name_${l}`)];
    const url = `${this.config.OFF_BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}?fields=${fields.join(',')}`;
    let body: OffResponse;
    try {
      const response = await this.http(url, { headers: { 'User-Agent': this.config.OFF_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
      if (response.status === 404) return null;
      if (!response.ok) {
        this.logger.warn({ barcode, status: response.status }, 'Open Food Facts a répondu en erreur');
        return null;
      }
      body = (await response.json()) as OffResponse;
    } catch (error) {
      this.logger.warn({ barcode, err: error }, 'Open Food Facts injoignable');
      return null;
    }
    if (body.status !== 1 || !body.product) return null;
    const p = body.product;
    const name = (p.product_name_fr || p.product_name || '').trim();
    if (!name) return null;

    const originalName = ORIGINAL_NAME_LANGS.map((l) => p[`product_name_${l}`]).find((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim() !== name) ?? null;
    const brand = p.brands?.split(',')[0]?.trim() || null;
    const net = parseNetContent(p);
    return {
      input: {
        barcode,
        name,
        originalName,
        brand,
        defaultUnit: 'PIECE',
        netContent: net?.value ?? null,
        netContentUnit: net?.unit ?? null,
      },
      categoryName: matchCategory(p.categories_tags ?? []),
      imageUrl: p.image_front_small_url ?? p.image_front_url ?? null,
      raw: body,
    };
  }

  /** Télécharge l'image du produit ; null si indisponible, sans faire échouer le scan. */
  async downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const response = await this.http(url, { headers: { 'User-Agent': this.config.OFF_USER_AGENT }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
      return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
    } catch {
      return null;
    }
  }
}

function parseNetContent(p: OffProduct): { value: number; unit: Unit } | null {
  const rawValue = typeof p.product_quantity === 'number' ? p.product_quantity : Number.parseFloat(String(p.product_quantity ?? '').replace(',', '.'));
  const unitKey = (p.product_quantity_unit ?? p.quantity?.replace(/[\d\s.,]/g, '') ?? '').toLowerCase();
  const mapped = UNIT_MAP[unitKey];
  if (!Number.isFinite(rawValue) || rawValue <= 0 || !mapped) return null;
  return { value: Math.round(rawValue * mapped.factor * 100) / 100, unit: mapped.unit };
}

function matchCategory(tags: string[]): string | null {
  const haystack = tags.join(' ').toLowerCase();
  for (const [pattern, name] of CATEGORY_KEYWORDS) if (pattern.test(haystack)) return name;
  return null;
}
