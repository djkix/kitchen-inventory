import { UNIT_LABELS_FR, UNITS, roundQuantity, type Unit } from '@kitchen/shared';

const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatQuantity(quantity: number, unit: Unit): string {
  const label = UNIT_LABELS_FR[unit];
  const value = NUMBER_FORMAT.format(roundQuantity(quantity));
  if (unit === 'PIECE' || unit === 'PACK' || unit === 'BOX' || unit === 'SACHET') {
    return `${value} ${label}${quantity >= 2 ? 's' : ''}`;
  }
  return `${value} ${label}`;
}

/**
 * Pas naturel par unité : une pièce, 100 g, 100 ml, 0,1 kg ou 0,1 l.
 * Choix d'interface, non spécifié par le cahier des charges.
 */
export function unitStep(unit: Unit): number {
  if (unit === 'GRAM' || unit === 'MILLILITER') return 100;
  if (unit === 'KILOGRAM' || unit === 'LITER') return 0.1;
  return 1;
}

/** Même pas, plafonné au stock disponible, pour la consommation rapide. */
export function consumeStep(unit: Unit, available: number): number {
  return roundQuantity(Math.min(unitStep(unit), available)) || roundQuantity(available);
}

export const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS_FR[unit] }));
