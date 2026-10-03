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

/**
 * « 25 min », « 1 h 15 » (section 14) : présentation partagée par la carte
 * recette et la fiche recette, qui la dupliquaient telle quelle.
 */
export function formatMinutes(totalMinutes: number | null): string | null {
  if (totalMinutes === null) return null;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes}` : `${hours} h`;
}

/**
 * « 4,3 » : moyenne des notes au format français, une décimale (EF-28).
 * Ne décide pas de ce qu'afficher pour l'absence de note (`null`) : la carte
 * recette n'affiche alors rien, le bloc Historique affiche « — ». Laisser ce
 * choix à l'appelant évite de figer un rendu qui ne convient qu'à l'un des deux.
 */
export function formatRatingAverage(average: number | null): string | null {
  if (average === null) return null;
  return average.toFixed(1).replace('.', ',');
}
