import { roundQuantity } from '../units.js';

/**
 * La quantité d'un lot est la somme de ses mouvements (section 8). Elle est
 * matérialisée sur le lot pour l'affichage, jamais écrite directement.
 */
export function sumMovements(deltas: number[]): number {
  const total = deltas.reduce((sum, delta) => sum + delta, 0);
  return Math.max(0, roundQuantity(total));
}
