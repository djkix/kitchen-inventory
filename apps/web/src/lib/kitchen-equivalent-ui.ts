import { kitchenEquivalent, type Unit } from '@kitchen/shared';
import { formatQuantity } from './quantity-ui';

const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

const SPOON_LABELS_FR = {
  tablespoon: 'c. à soupe',
  teaspoon: 'c. à café',
} as const;

/**
 * « 3 c. à soupe » : l'équivalent ménager tel qu'il s'affiche à côté de la
 * mesure exacte (2026-11-24). Le calcul est la règle pure partagée, jamais
 * refait ici ; cette fonction n'ajoute que le français.
 *
 * Volontairement distincte de `formatQuantity` (`quantity-ui.ts`), qui est
 * partagée avec les écrans Stock, Article, Scan et Périme bientôt : un stock
 * ne se compte pas en cuillères, et l'équivalent n'a sa place que dans les
 * vues recette.
 */
export function formatKitchenEquivalent(quantity: number, unit: Unit): string | null {
  const equivalent = kitchenEquivalent(quantity, unit);
  if (equivalent === null) return null;
  return `${NUMBER_FORMAT.format(equivalent.spoons)} ${SPOON_LABELS_FR[equivalent.spoon]}`;
}

/**
 * « 45 ml (3 c. à soupe) » : la mesure exacte, puis l'équivalent entre
 * parenthèses quand il y en a un. C'est la forme demandée — « tu me donnes
 * l'équivalent mais tu gardes les deux » — et le seul rendu employé par les
 * trois vues recette, pour qu'elles ne divergent pas.
 */
export function formatQuantityWithEquivalent(quantity: number, unit: Unit): string {
  const exact = formatQuantity(quantity, unit);
  const equivalent = formatKitchenEquivalent(quantity, unit);
  return equivalent === null ? exact : `${exact} (${equivalent})`;
}
