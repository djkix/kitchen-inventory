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
  /**
   * Au moins un lot de ce produit n'a pas pu être converti dans son unité par
   * défaut lors de l'agrégation (API, pas ce module) : `quantity` ne reflète
   * donc qu'une partie du stock réel. Un total mesurable déjà suffisant reste
   * `available` ; sinon la réponse devient `unverifiable` plutôt que
   * `insufficient` ou `missing`, pour ne pas écarter une recette sur la foi
   * d'un total sous-estimé.
   */
  unmeasured?: boolean;
}

export interface StockSnapshot {
  byProduct: ReadonlyMap<string, StockEntry>;
  byCategory: ReadonlyMap<string, readonly StockEntry[]>;
}

export interface CoverageIngredient {
  id: string;
  productId: string | null;
  /**
   * Catégorie *résolue* par l'appelant (l'API, pas cette fonction pure) : soit
   * la catégorie explicitement visée par l'ingrédient, soit — pour une ligne
   * substituable qui vise un produit — la catégorie de ce produit, lue dans la
   * table `Product`. Le produit visé n'a donc pas besoin d'être en stock pour
   * que sa catégorie soit connue : c'est l'appelant qui la fournit, jamais cet
   * instantané qui la devine. `productId` et `categoryId` peuvent donc
   * coexister ici (l'un est résolu depuis l'autre) ; la contrainte « un
   * ingrédient vise un produit ou une catégorie, pas les deux » appartient au
   * schéma Zod de saisie d'une recette, pas à cette structure.
   */
  categoryId: string | null;
  quantity: number | null;
  unit: Unit | null;
  essential: boolean;
  substitutable: boolean;
}

export interface IngredientOutcome {
  id: string;
  state: IngredientState;
  availableQuantity: number | null;
  requiredQuantity: number | null;
}

export interface RecipeCoverage {
  coverage: number;
  group: CoverageGroup;
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

/** Vrai pour une unité de conditionnement (paquet, boîte, sachet, pièce), jamais pour une masse ou un volume. */
function isPackagingUnit(unit: Unit): boolean {
  const family = UNIT_FAMILY[unit];
  return family !== 'mass' && family !== 'volume';
}

/**
 * Pont par la contenance (`netContent`/`netContentUnit`), dans un sens ou
 * l'autre : d'une unité de conditionnement (paquet) vers une unité de mesure
 * (ex. 3 paquets de 500 g → 1500 g), ou l'inverse (ex. un besoin de 1500 g →
 * 3 paquets). Une des deux unités doit être un conditionnement et l'autre
 * doit partager la famille de `netContentUnit` ; sinon `null` — en particulier
 * entre deux unités de mesure de familles différentes (masse vers volume),
 * qui ne se pontent jamais quel que soit `netContentUnit`.
 */
export function convertWithNetContent(amount: number, fromUnit: Unit, toUnit: Unit, netContent: number | null, netContentUnit: Unit | null): number | null {
  if (sameFamily(fromUnit, toUnit)) return convertQuantity(amount, fromUnit, toUnit);
  if (netContent === null || netContent <= 0 || netContentUnit === null) return null;
  if (isPackagingUnit(fromUnit) && sameFamily(netContentUnit, toUnit)) {
    // Conditionnement → mesure (ex. paquets → grammes).
    return convertQuantity(amount * netContent, netContentUnit, toUnit);
  }
  if (isPackagingUnit(toUnit) && sameFamily(fromUnit, netContentUnit)) {
    // Mesure → conditionnement, sens inverse (ex. grammes → paquets).
    return roundQuantity(convertQuantity(amount, fromUnit, netContentUnit) / netContent);
  }
  return null;
}

export function availableInUnit(entry: StockEntry, unit: Unit): number | null {
  // Le pont par la contenance ne vaut que depuis une unité de conditionnement :
  // un stock déjà mesuré en masse ou en volume ne se convertit jamais via le
  // paquet (une consommation en grammes ne redevient jamais un nombre de
  // paquets dans ce calcul de couverture — cette direction-là n'est utilisée
  // que par la cuisson, via `convertWithNetContent` directement).
  const family = UNIT_FAMILY[entry.unit];
  if (family === 'mass' || family === 'volume') {
    return sameFamily(entry.unit, unit) ? convertQuantity(entry.quantity, entry.unit, unit) : null;
  }
  return convertWithNetContent(entry.quantity, entry.unit, unit, entry.netContent, entry.netContentUnit);
}

function candidates(ingredient: CoverageIngredient, snapshot: StockSnapshot): readonly StockEntry[] {
  // `categoryId` est déjà la catégorie résolue par l'appelant (voir le
  // commentaire sur `CoverageIngredient.categoryId`) : pour une ligne
  // substituable, c'est celle du produit visé, donc aucun repli supplémentaire
  // n'est nécessaire ici — `substitutable` ne joue aucun rôle dans ce choix.
  if (ingredient.categoryId) return snapshot.byCategory.get(ingredient.categoryId) ?? [];
  if (!ingredient.productId) return [];
  const direct = snapshot.byProduct.get(ingredient.productId);
  return direct ? [direct] : [];
}

/** Les quantités à la pièce ne se comparent pas au socle (A6). */
function comparable(unit: Unit): boolean {
  const family = UNIT_FAMILY[unit];
  return family === 'mass' || family === 'volume';
}

export function ingredientOutcome(ingredient: CoverageIngredient, snapshot: StockSnapshot): IngredientOutcome {
  const base = { id: ingredient.id, availableQuantity: null, requiredQuantity: null };
  if (!ingredient.productId && !ingredient.categoryId) return { ...base, state: 'untracked' };

  const found = candidates(ingredient, snapshot);
  if (found.length === 0) return { ...base, state: 'missing' };

  if (ingredient.quantity === null || ingredient.unit === null) return { ...base, state: 'available' };
  if (!comparable(ingredient.unit)) return { ...base, state: 'unverifiable' };

  let total = 0;
  let measured = false;
  let unmeasuredPresent = false;
  for (const entry of found) {
    if (entry.unmeasured) unmeasuredPresent = true;
    const quantity = availableInUnit(entry, ingredient.unit);
    if (quantity === null) continue;
    measured = true;
    total += quantity;
  }
  if (!measured) return { ...base, state: 'unverifiable' };
  const available = roundQuantity(total);
  if (available >= ingredient.quantity) return { ...base, state: 'available' };
  // Un total mesurable insuffisant ne vaut verdict ferme que si tout le stock
  // du produit a pu être mesuré : sinon le manque n'est pas vérifié (A6, A10).
  if (unmeasuredPresent) return { ...base, state: 'unverifiable' };
  return { id: ingredient.id, state: 'insufficient', availableQuantity: available, requiredQuantity: ingredient.quantity };
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

  return { coverage, group, missingIds: missing.map(({ outcome }) => outcome.id), outcomes };
}
