import { roundQuantity } from '../units.js';

/**
 * Section 15 : une consommation qui dépasse la quantité en stock est ramenée à
 * la quantité disponible. Le service qui l'applique enregistre alors un
 * mouvement d'ajustement et affiche un message explicite (`capped`).
 */
export function capConsumption(available: number, requested: number): { delta: number; capped: boolean } {
  if (!(requested > 0)) throw new RangeError('La quantité doit être positive');
  const stock = Math.max(0, roundQuantity(available));
  if (requested > stock) return { delta: roundQuantity(-stock), capped: true };
  return { delta: roundQuantity(-requested), capped: false };
}
