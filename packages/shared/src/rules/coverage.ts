import { convertQuantity, roundQuantity, sameFamily, UNIT_FAMILY, type Unit } from '../units.js';

export type IngredientState = 'available' | 'insufficient' | 'unverifiable' | 'missing' | 'untracked';
export type CoverageGroup = 'ready' | 'almost' | 'excluded';

/** Seuil du groupe « presque » (A8). */
export const ALMOST_COVERAGE_FLOOR = 0.6;

export interface StockEntry {
  productId: string;
  categoryId: string | null;
  unit: Unit;
  quantity: number;
  netContent: number | null;
  netContentUnit: Unit | null;
  nearExpiry: boolean;
}

export interface StockSnapshot {
  byProduct: ReadonlyMap<string, StockEntry>;
  byCategory: ReadonlyMap<string, readonly StockEntry[]>;
}

export interface CoverageIngredient {
  id: string;
  productId: string | null;
  categoryId: string | null;
  quantity: number | null;
  unit: Unit | null;
  essential: boolean;
  substitutable: boolean;
}

export interface IngredientOutcome {
  id: string;
  state: IngredientState;
  nearExpiry: boolean;
  availableQuantity: number | null;
  requiredQuantity: number | null;
}

export interface RecipeCoverage {
  coverage: number;
  group: CoverageGroup;
  bonus: number;
  missingIds: string[];
  outcomes: IngredientOutcome[];
}

/** Insuffisant et non vérifiable comptent comme disponibles (A10, A6). */
export function countsAsAvailable(state: IngredientState): boolean {
  return state === 'available' || state === 'insufficient' || state === 'unverifiable';
}

/**
 * Indexe le stock par produit et par catégorie. Une catégorie porte aussi le
 * stock de ses descendantes (A3) : l'arbre est remonté une fois par entrée,
 * plutôt que parcouru à chaque ingrédient.
 */
export function buildStockSnapshot(
  entries: readonly StockEntry[],
  parentByCategory: ReadonlyMap<string, string | null>,
): StockSnapshot {
  const byProduct = new Map<string, StockEntry>();
  const byCategory = new Map<string, StockEntry[]>();
  for (const entry of entries) {
    byProduct.set(entry.productId, entry);
    let categoryId = entry.categoryId;
    const seen = new Set<string>();
    while (categoryId && !seen.has(categoryId)) {
      seen.add(categoryId);
      const bucket = byCategory.get(categoryId) ?? [];
      bucket.push(entry);
      byCategory.set(categoryId, bucket);
      categoryId = parentByCategory.get(categoryId) ?? null;
    }
  }
  return { byProduct, byCategory };
}

export function availableInUnit(entry: StockEntry, unit: Unit): number | null {
  if (sameFamily(entry.unit, unit)) return convertQuantity(entry.quantity, entry.unit, unit);
  // Le pont par la contenance ne vaut que depuis une unité de conditionnement :
  // un stock en grammes ne devient jamais un volume.
  const family = UNIT_FAMILY[entry.unit];
  const bridgeable = family !== 'mass' && family !== 'volume';
  if (bridgeable && entry.netContent !== null && entry.netContentUnit !== null && sameFamily(entry.netContentUnit, unit)) {
    return convertQuantity(entry.quantity * entry.netContent, entry.netContentUnit, unit);
  }
  return null;
}

function candidates(ingredient: CoverageIngredient, snapshot: StockSnapshot): readonly StockEntry[] {
  if (ingredient.categoryId) return snapshot.byCategory.get(ingredient.categoryId) ?? [];
  if (!ingredient.productId) return [];
  const direct = snapshot.byProduct.get(ingredient.productId);
  if (!ingredient.substitutable) return direct ? [direct] : [];
  // Substituable : toute la catégorie du produit visé convient. Si le produit
  // visé n'a lui-même aucune entrée de stock, sa catégorie est inconnue : on
  // élargit alors à tout le stock plutôt que de conclure trop vite au manque.
  const categoryId = direct?.categoryId ?? null;
  if (categoryId) return snapshot.byCategory.get(categoryId) ?? [];
  return direct ? [direct] : [...snapshot.byProduct.values()];
}

/** Les quantités à la pièce ne se comparent pas au socle (A6). */
function comparable(unit: Unit): boolean {
  const family = UNIT_FAMILY[unit];
  return family === 'mass' || family === 'volume';
}

export function ingredientOutcome(ingredient: CoverageIngredient, snapshot: StockSnapshot): IngredientOutcome {
  const base = { id: ingredient.id, availableQuantity: null, requiredQuantity: null };
  if (!ingredient.productId && !ingredient.categoryId) return { ...base, state: 'untracked', nearExpiry: false };

  const found = candidates(ingredient, snapshot);
  if (found.length === 0) return { ...base, state: 'missing', nearExpiry: false };
  const nearExpiry = found.some((entry) => entry.nearExpiry);

  if (ingredient.quantity === null || ingredient.unit === null) return { ...base, state: 'available', nearExpiry };
  if (!comparable(ingredient.unit)) return { ...base, state: 'unverifiable', nearExpiry };

  let total = 0;
  let measured = false;
  for (const entry of found) {
    const quantity = availableInUnit(entry, ingredient.unit);
    if (quantity === null) continue;
    measured = true;
    total += quantity;
  }
  if (!measured) return { ...base, state: 'unverifiable', nearExpiry };
  const available = roundQuantity(total);
  return available >= ingredient.quantity
    ? { ...base, state: 'available', nearExpiry }
    : { id: ingredient.id, state: 'insufficient', nearExpiry, availableQuantity: available, requiredQuantity: ingredient.quantity };
}

export function recipeCoverage(ingredients: readonly CoverageIngredient[], snapshot: StockSnapshot): RecipeCoverage {
  const outcomes = ingredients.map((ingredient) => ingredientOutcome(ingredient, snapshot));
  const tracked = ingredients
    .map((ingredient, index) => ({ ingredient, outcome: outcomes[index]! }))
    .filter(({ outcome }) => outcome.state !== 'untracked');

  const missing = tracked.filter(({ outcome }) => !countsAsAvailable(outcome.state));
  const essentialMissing = missing.some(({ ingredient }) => ingredient.essential);
  // Une recette dont rien n'est suivi ne manque de rien (A7).
  const coverage = tracked.length === 0 ? 1 : roundQuantity((tracked.length - missing.length) / tracked.length);

  let group: CoverageGroup;
  if (missing.length === 0) group = 'ready';
  else if (!essentialMissing && missing.length <= 2 && coverage >= ALMOST_COVERAGE_FLOOR) group = 'almost';
  else group = 'excluded';

  const bonus = tracked.filter(({ outcome }) => outcome.nearExpiry && countsAsAvailable(outcome.state)).length;
  return { coverage, group, bonus, missingIds: missing.map(({ outcome }) => outcome.id), outcomes };
}
