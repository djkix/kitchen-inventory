/**
 * Unités autorisées par la section 15 du cahier des charges. Aucune unité libre.
 * Les conversions ne sont possibles qu'au sein d'une même famille : masse
 * (g ↔ kg) et volume (ml ↔ l). Jamais entre masse et volume.
 */
export const UNITS = ['PIECE', 'GRAM', 'KILOGRAM', 'MILLILITER', 'LITER', 'PACK', 'BOX', 'SACHET'] as const;
export type Unit = (typeof UNITS)[number];

/**
 * Unités qui comptent des objets entiers. Le « 3 × » d'un ticket de caisse
 * (EF-29) en désigne trois : trois paquets, trois boîtes, trois sachets, comme
 * trois pièces. Les masses et les volumes en sont exclus — ajouter « 3 » à un
 * produit suivi en grammes écrirait trois grammes.
 */
export const COUNTABLE_UNITS = ['PIECE', 'PACK', 'BOX', 'SACHET'] as const;

export function isCountableUnit(unit: Unit): boolean {
  return (COUNTABLE_UNITS as readonly Unit[]).includes(unit);
}

export type UnitFamily = 'count' | 'mass' | 'volume' | 'pack' | 'box' | 'sachet';

export const UNIT_FAMILY: Record<Unit, UnitFamily> = {
  PIECE: 'count',
  GRAM: 'mass',
  KILOGRAM: 'mass',
  MILLILITER: 'volume',
  LITER: 'volume',
  PACK: 'pack',
  BOX: 'box',
  SACHET: 'sachet',
};

export const UNIT_LABELS_FR: Record<Unit, string> = {
  PIECE: 'pièce',
  GRAM: 'g',
  KILOGRAM: 'kg',
  MILLILITER: 'ml',
  LITER: 'l',
  PACK: 'paquet',
  BOX: 'boîte',
  SACHET: 'sachet',
};

/** Facteur vers l'unité de base de la famille (g pour la masse, ml pour le volume). */
const BASE_FACTOR: Partial<Record<Unit, number>> = {
  GRAM: 1,
  KILOGRAM: 1000,
  MILLILITER: 1,
  LITER: 1000,
};

export class IncompatibleUnitsError extends Error {
  constructor(
    public readonly from: Unit,
    public readonly to: Unit,
  ) {
    super(`Unités incompatibles : ${UNIT_LABELS_FR[from]} et ${UNIT_LABELS_FR[to]}`);
    this.name = 'IncompatibleUnitsError';
  }
}

export function sameFamily(a: Unit, b: Unit): boolean {
  return UNIT_FAMILY[a] === UNIT_FAMILY[b];
}

/** Arrondi à deux décimales, sans jamais renvoyer -0. */
export function roundQuantity(quantity: number): number {
  const rounded = Math.round((quantity + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function convertQuantity(quantity: number, from: Unit, to: Unit): number {
  if (from === to) return roundQuantity(quantity);
  if (!sameFamily(from, to)) throw new IncompatibleUnitsError(from, to);
  const fromFactor = BASE_FACTOR[from];
  const toFactor = BASE_FACTOR[to];
  if (fromFactor === undefined || toFactor === undefined) throw new IncompatibleUnitsError(from, to);
  return roundQuantity((quantity * fromFactor) / toFactor);
}
