import { convertQuantity, UNIT_FAMILY, type Unit } from '../units.js';

/**
 * Équivalent ménager d'une quantité (demande du propriétaire, 2026-11-24 :
 * « pour les cuillères à soupe, tu me donnes l'équivalent mais tu gardes les
 * deux »). Il s'**ajoute** à la mesure exacte, il ne la remplace jamais : la
 * règle de `MEASUREMENT_RULE` (2026-11-21) impose toujours au modèle des
 * grammes et des millilitres.
 *
 * Calculé ici plutôt que stocké, et c'est tout l'intérêt : un « 3 c. à soupe »
 * écrit en base deviendrait faux dès que le champ « Parts » de la fiche passe
 * de quatre à six, alors qu'un calcul à l'affichage suit `scaleIngredients`
 * sans rien de plus. Il vaut aussi, gratuitement, pour les quelque quatre
 * cents recettes déjà au réservoir.
 *
 * Les équivalences sont celles que le modèle emploie lui-même (cuillère à
 * soupe = 15, cuillère à café = 5), écrites dans `MEASUREMENT_RULE`. Elles
 * sont approchées pour une masse — une cuillère de farine et une de miel ne
 * pèsent pas pareil — et c'est assumé : l'équivalent est une aide à la louche,
 * la mesure exacte reste affichée à côté.
 */
export type SpoonKind = 'tablespoon' | 'teaspoon';

export interface KitchenEquivalent {
  /** Nombre de cuillères, arrondi au demi. */
  spoons: number;
  spoon: SpoonKind;
}

/** Une cuillère à soupe vaut 15 g ou 15 ml, une cuillère à café 5. */
const TABLESPOON = 15;
const TEASPOON = 5;

/**
 * Plancher : une demi-cuillère à café. En dessous, l'équivalent n'aide plus —
 * « 0,2 c. à café » se lit moins bien que « 1 g ».
 */
const FLOOR = TEASPOON / 2;

/**
 * Plafond : huit cuillères à soupe. Au-delà, le compte cesse d'être parlant —
 * personne ne mesure 250 g de farine en seize cuillères.
 */
const CEILING = TABLESPOON * 8;

/**
 * L'équivalent en cuillères, ou `null` quand il n'y a rien d'utile à dire :
 * une unité qui se compte (pièce, paquet, boîte, sachet), une quantité nulle
 * ou négative, ou une quantité hors des bornes ci-dessus.
 */
export function kitchenEquivalent(quantity: number, unit: Unit): KitchenEquivalent | null {
  const family = UNIT_FAMILY[unit];
  if (family !== 'mass' && family !== 'volume') return null;
  // Ramené à l'unité de base de la famille : les équivalences sont écrites en
  // grammes et en millilitres, pas en kilos ni en litres.
  const base = convertQuantity(quantity, unit, family === 'mass' ? 'GRAM' : 'MILLILITER');
  if (base < FLOOR || base > CEILING) return null;
  const spoon: SpoonKind = base < TABLESPOON ? 'teaspoon' : 'tablespoon';
  const spoons = Math.round((base / (spoon === 'teaspoon' ? TEASPOON : TABLESPOON)) * 2) / 2;
  return spoons > 0 ? { spoons, spoon } : null;
}
