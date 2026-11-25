import { roundQuantity } from '../units.js';

/**
 * Quantités citées dans le texte d'une étape (2026-11-25).
 *
 * Le champ « Parts » ne mettait à l'échelle que la liste d'ingrédients. Depuis
 * que la consigne exige des étapes réalisables sans rien deviner (2026-11-20),
 * celles-ci répètent les quantités — « Versez 200 g de riz » —, et elles
 * restaient au nombre de parts d'origine. Passer de quatre à huit donnait donc
 * une fiche qui se contredisait : une liste pour huit, des instructions pour
 * quatre. En cuisine, c'est pire que pas de mise à l'échelle du tout, parce
 * que rien ne signale la contradiction.
 *
 * Ce qui est reconnu : un nombre suivi d'une unité de masse ou de volume. Rien
 * d'autre. Les températures (« 180 °C »), les durées (« 20 min ») et les
 * nombres sans unité (« 2 œufs », « 4 personnes ») sont laissés tels quels —
 * les premiers parce que les multiplier serait faux, le dernier parce que le
 * texte seul ne dit pas si le nombre se multiplie. Un œuf de plus se lit dans
 * la liste d'ingrédients, qui, elle, est à l'échelle.
 *
 * Calculé à l'affichage et jamais écrit : comme l'équivalent ménager, il suit
 * le choix de parts et vaut pour les recettes déjà enregistrées.
 */
const QUANTITY = /\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|dl|l)\b(?!['’])/gi;

export function scaleQuantitiesInText(text: string, ratio: number, format: (quantity: number) => string): string {
  if (ratio === 1) return text;
  return text.replace(QUANTITY, (whole, value: string, unit: string) => {
    const parsed = Number(value.replace(',', '.'));
    // Une quantité nulle ou illisible reste telle quelle : multiplier zéro ne
    // dit rien, et réécrire ce qu'on n'a pas compris serait pire que se taire.
    if (!Number.isFinite(parsed) || parsed <= 0) return whole;
    return `${format(roundQuantity(parsed * ratio))} ${unit}`;
  });
}
