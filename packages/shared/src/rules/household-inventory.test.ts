import { describe, expect, it } from 'vitest';
import { formatHouseholdInventory } from './household-inventory.js';

describe('formatHouseholdInventory', () => {
  it('cite chaque produit avec son emplacement', () => {
    expect(formatHouseholdInventory([{ name: 'Farine de riz', locations: ['Placard'] }])).toContain('Farine de riz (Placard)');
  });

  it('cite les deux emplacements d’un produit rangé à deux endroits', () => {
    expect(formatHouseholdInventory([{ name: 'Beurre', locations: ['Réfrigérateur', 'Congélateur'] }])).toContain(
      'Beurre (Réfrigérateur, Congélateur)',
    );
  });

  it('se passe d’emplacement quand il n’y en a pas', () => {
    expect(formatHouseholdInventory([{ name: 'Sel', locations: [] }])).toContain('Sel');
  });

  /**
   * Décision du propriétaire du 2026-11-24 : « pas de quantités ni de dates ».
   * Le test épingle ce que le texte ne doit JAMAIS porter.
   */
  it('ne porte ni quantité ni date', () => {
    const texte = formatHouseholdInventory([
      { name: 'Lait de coco', locations: ['Placard'] },
      { name: 'Crème 30%', locations: ['Réfrigérateur'] },
    ]);
    expect(texte).not.toMatch(/\d+\s*(g|ml|kg|l)\b/);
    expect(texte).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('rend une phrase explicite sur un foyer vide', () => {
    expect(formatHouseholdInventory([])).toBe('aucun');
  });
});
