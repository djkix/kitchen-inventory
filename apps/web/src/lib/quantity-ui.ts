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
 * Pas de consommation rapide par unité : une pièce, 100 g, 100 ml, 0,1 kg ou 0,1 l.
 * Choix d'interface (non spécifié par le cahier des charges), plafonné au stock disponible.
 */
export function consumeStep(unit: Unit, available: number): number {
  const base = unit === 'GRAM' || unit === 'MILLILITER' ? 100 : unit === 'KILOGRAM' || unit === 'LITER' ? 0.1 : 1;
  return roundQuantity(Math.min(base, available)) || roundQuantity(available);
}

export const UNIT_OPTIONS = UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS_FR[unit] }));
