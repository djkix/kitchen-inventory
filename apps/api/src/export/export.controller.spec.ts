import { describe, expect, it } from 'vitest';
import { csvCell, promptInventory } from './export.controller.js';

/** Injection de formule dans l'export CSV (EF-16, revue de sécurité du 2026-10-22). */
describe('csvCell', () => {
  it.each([
    ['=HYPERLINK("https://ailleurs.example","clic")', `"'=HYPERLINK(""https://ailleurs.example"",""clic"")"`],
    ['+33 6 00 00 00 00', "'+33 6 00 00 00 00"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', `"'\r=1+1"`],
  ])('neutralise %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('laisse le reste tel quel', () => {
    expect(csvCell('Lait demi-écrémé')).toBe('Lait demi-écrémé');
    expect(csvCell('a = b')).toBe('a = b');
    expect(csvCell(-1.5)).toBe('-1.5');
    expect(csvCell(true)).toBe('oui');
    expect(csvCell(null)).toBe('');
    expect(csvCell('Pâtes; 500 g')).toBe('"Pâtes; 500 g"');
  });
});

/**
 * Inventaire allégé (2026-11-23). Ce qui se vérifie ici, c'est le regroupement :
 * le reste du fichier n'est qu'un renommage de champs.
 */
describe('promptInventory', () => {
  const lot = (over: Partial<Parameters<typeof promptInventory>[0][number]>) => ({
    productId: 'p', product: 'Beurre', originalName: null, brand: null, barcode: null,
    category: null, location: 'Réfrigérateur', locationPath: 'Réfrigérateur',
    quantity: 250, unit: 'GRAM', expiryDate: null, dateType: null, dateEstimated: false,
    opened: false, effectiveExpiry: null, createdAt: '2026-11-01T00:00:00.000Z', ...over,
  });

  it('additionne les lots d’un même produit dans la même unité', () => {
    const { stock } = promptInventory([lot({ quantity: 250 }), lot({ quantity: 125 })], '2026-11-23');
    expect(stock).toEqual([{ produit: 'Beurre', quantite: 375, unite: 'g', emplacement: 'Réfrigérateur' }]);
  });

  it('ne mélange jamais deux unités du même produit', () => {
    const { stock } = promptInventory([lot({ quantity: 250 }), lot({ quantity: 2, unit: 'PIECE' })], '2026-11-23');
    expect(stock.map((l) => [l.quantite, l.unite])).toEqual([[250, 'g'], [2, 'pièce']]);
  });

  it('retient la péremption la plus proche du groupe', () => {
    const { stock } = promptInventory(
      [lot({ effectiveExpiry: '2026-12-20' }), lot({ effectiveExpiry: '2026-12-02' })],
      '2026-11-23',
    );
    expect(stock[0]?.peremption).toBe('2026-12-02');
  });

  it('omet la péremption plutôt que de la poser à null', () => {
    const { stock } = promptInventory([lot({})], '2026-11-23');
    expect(stock[0]).not.toHaveProperty('peremption');
  });

  it('trie par produit et date le fichier', () => {
    const inventaire = promptInventory([lot({ product: 'Œufs' }), lot({ product: 'Ail' })], '2026-11-23');
    expect(inventaire.genere).toBe('2026-11-23');
    expect(inventaire.stock.map((l) => l.produit)).toEqual(['Ail', 'Œufs']);
  });
});
