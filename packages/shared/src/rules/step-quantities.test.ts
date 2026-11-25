import { describe, expect, it } from 'vitest';
import { scaleQuantitiesInText } from './step-quantities.js';

/** Formateur de test : virgule française, deux décimales au plus, comme l'écran. */
const fr = (quantity: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(quantity);

describe('scaleQuantitiesInText', () => {
  it('met à l’échelle une quantité citée dans une étape', () => {
    expect(scaleQuantitiesInText('Versez 200 g de riz', 2, fr)).toBe('Versez 400 g de riz');
  });

  it('ne touche à rien quand le rapport vaut un', () => {
    expect(scaleQuantitiesInText('Versez 200 g de riz', 1, fr)).toBe('Versez 200 g de riz');
  });

  it('laisse les températures et les durées', () => {
    const etape = 'Enfournez à 180 °C pendant 20 min, puis 5 minutes de repos';
    expect(scaleQuantitiesInText(etape, 2, fr)).toBe(etape);
  });

  it('ne multiplie pas un nombre sans unité', () => {
    expect(scaleQuantitiesInText('Cassez 2 œufs pour 4 personnes', 2, fr)).toBe('Cassez 2 œufs pour 4 personnes');
  });

  it('reconnaît les unités de volume et de masse, collées ou non', () => {
    expect(scaleQuantitiesInText('250 ml de lait, 1 kg de farine, 200g de beurre', 2, fr)).toBe(
      '500 ml de lait, 2 kg de farine, 400 g de beurre',
    );
  });

  it('accepte la virgule décimale', () => {
    expect(scaleQuantitiesInText('0,5 l de bouillon', 3, fr)).toBe('1,5 l de bouillon');
  });

  // « 1 l'huile » n'est pas du français, mais une élision derrière l'unité
  // signalerait qu'on a pris une apostrophe pour un litre.
  it('ne prend pas une élision pour un litre', () => {
    expect(scaleQuantitiesInText("Ajoutez 1 l'huile", 2, fr)).toBe("Ajoutez 1 l'huile");
  });

  it('laisse une quantité nulle ou négative tranquille', () => {
    expect(scaleQuantitiesInText('0 g de sel', 2, fr)).toBe('0 g de sel');
  });
});
