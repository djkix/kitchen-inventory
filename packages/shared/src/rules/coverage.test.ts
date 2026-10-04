import { describe, expect, it } from 'vitest';
import { availableInUnit, buildStockSnapshot, ingredientOutcome, recipeCoverage, type CoverageIngredient, type StockEntry } from './coverage.js';

const entry = (over: Partial<StockEntry> = {}): StockEntry => ({
  productId: 'p1', categoryId: 'c1', unit: 'GRAM', quantity: 500,
  netContent: null, netContentUnit: null, nearExpiry: false, ...over,
});
const ing = (over: Partial<CoverageIngredient> = {}): CoverageIngredient => ({
  id: 'i1', productId: 'p1', categoryId: null, quantity: 200, unit: 'GRAM',
  essential: false, substitutable: false, ...over,
});
/** c2 est une sous-catégorie de c1. */
const tree = new Map<string, string | null>([['c1', null], ['c2', 'c1']]);
const snap = (entries: StockEntry[]) => buildStockSnapshot(entries, tree);

describe('availableInUnit', () => {
  it('convertit dans la même famille', () => {
    expect(availableInUnit(entry({ unit: 'KILOGRAM', quantity: 1 }), 'GRAM')).toBe(1000);
  });
  it('fait le pont par la contenance entre paquets et grammes', () => {
    expect(availableInUnit(entry({ unit: 'PACK', quantity: 3, netContent: 500, netContentUnit: 'GRAM' }), 'GRAM')).toBe(1500);
  });
  it('refuse de ponter depuis une masse ou un volume', () => {
    expect(availableInUnit(entry({ unit: 'GRAM', netContent: 1, netContentUnit: 'LITER' }), 'LITER')).toBeNull();
  });
  it('renvoie null quand aucun pont n’existe', () => {
    expect(availableInUnit(entry({ unit: 'PACK', quantity: 3 }), 'GRAM')).toBeNull();
  });
});

describe('ingredientOutcome', () => {
  it('marque hors inventaire un ingrédient sans rattachement', () => {
    expect(ingredientOutcome(ing({ productId: null }), snap([entry()])).state).toBe('untracked');
  });
  it('sans quantité, suffit que la cible soit en stock', () => {
    expect(ingredientOutcome(ing({ quantity: null, unit: null }), snap([entry()])).state).toBe('available');
    expect(ingredientOutcome(ing({ productId: 'absent', quantity: null, unit: null }), snap([entry()])).state).toBe('missing');
  });
  it('distingue manquant et quantité insuffisante (A10)', () => {
    expect(ingredientOutcome(ing({ quantity: 200 }), snap([entry()])).state).toBe('available');
    expect(ingredientOutcome(ing({ quantity: 900 }), snap([entry()]))).toMatchObject({
      state: 'insufficient', availableQuantity: 500, requiredQuantity: 900,
    });
    expect(ingredientOutcome(ing({ productId: 'absent' }), snap([entry()])).state).toBe('missing');
  });
  it('signale une quantité non vérifiable plutôt que de trancher', () => {
    expect(ingredientOutcome(ing({ quantity: 200, unit: 'GRAM' }), snap([entry({ unit: 'PACK', quantity: 2 })])).state).toBe('unverifiable');
  });
  it('traite une quantité à la pièce comme non vérifiable (A6)', () => {
    expect(ingredientOutcome(ing({ quantity: 3, unit: 'PIECE' }), snap([entry({ unit: 'PIECE', quantity: 6 })])).state).toBe('unverifiable');
  });
  it('inclut les sous-catégories, récursivement (A3)', () => {
    const s = snap([entry({ productId: 'sous', categoryId: 'c2', quantity: 300 })]);
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 200 }), s).state).toBe('available');
  });
  it('additionne les produits convertibles d’une catégorie et ignore les autres', () => {
    const s = snap([
      entry({ productId: 'a', quantity: 150 }),
      entry({ productId: 'b', quantity: 100 }),
      entry({ productId: 'c', unit: 'PACK', quantity: 9 }),
    ]);
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 200 }), s).state).toBe('available');
    expect(ingredientOutcome(ing({ productId: null, categoryId: 'c1', quantity: 400 }), s).state).toBe('insufficient');
  });
  it('un substituable accepte un autre produit de la catégorie de son produit', () => {
    const s = snap([entry({ productId: 'autre', quantity: 300 })]);
    expect(ingredientOutcome(ing({ substitutable: true, categoryId: 'c1', quantity: 200 }), s).state).toBe('available');
    expect(ingredientOutcome(ing({ substitutable: false, quantity: 200 }), s).state).toBe('missing');
  });
  it('un substituable dont la catégorie est inconnue n’est pas satisfait par un produit quelconque', () => {
    const s = snap([entry({ productId: 'autre', quantity: 300 })]);
    expect(ingredientOutcome(ing({ substitutable: true, quantity: 200 }), s).state).toBe('missing');
  });
  it('évalue chaque ligne indépendamment (A9)', () => {
    const s = snap([entry({ quantity: 300 })]);
    expect([
      ingredientOutcome(ing({ id: 'a', quantity: 200 }), s).state,
      ingredientOutcome(ing({ id: 'b', quantity: 200 }), s).state,
    ]).toEqual(['available', 'available']);
  });
  describe('lot partiellement non convertible (correctif tâche 9)', () => {
    it('reste disponible quand la part mesurable suffit déjà', () => {
      const s = snap([entry({ quantity: 500, unmeasured: true })]);
      expect(ingredientOutcome(ing({ quantity: 200 }), s).state).toBe('available');
    });
    it('devient non vérifiable, pas insuffisant, quand la part mesurable ne suffit pas', () => {
      const s = snap([entry({ quantity: 100, unmeasured: true })]);
      expect(ingredientOutcome(ing({ quantity: 200 }), s)).toMatchObject({ state: 'unverifiable', availableQuantity: null });
    });
    it('reste non vérifiable, sans changement, quand aucun lot n’est mesurable', () => {
      const s = snap([entry({ unit: 'PACK', quantity: 2, unmeasured: true })]);
      expect(ingredientOutcome(ing({ quantity: 200, unit: 'GRAM' }), s).state).toBe('unverifiable');
    });
  });
});

describe('recipeCoverage', () => {
  const s = snap([entry()]);
  it('classe réalisable une recette entièrement couverte', () => {
    expect(recipeCoverage([ing()], s)).toMatchObject({ coverage: 1, group: 'ready', missingIds: [] });
  });
  it('compte insuffisant et non vérifiable comme disponibles', () => {
    expect(recipeCoverage([ing({ quantity: 900 }), ing({ id: 'i2', quantity: 2, unit: 'PIECE' })], s)).toMatchObject({
      coverage: 1, group: 'ready',
    });
  });
  it('exige une couverture d’au moins 60 % pour « presque » (A8)', () => {
    const present = [1, 2].map((n) => ing({ id: `ok${n}` }));
    const absent = ing({ id: 'ko', productId: 'absent' });
    expect(recipeCoverage([...present, absent], s)).toMatchObject({ group: 'almost', coverage: 0.67 });
    expect(recipeCoverage([ing(), absent, ing({ id: 'ko2', productId: 'absent2' })], s).group).toBe('excluded');
  });
  it('écarte une recette dont un ingrédient essentiel manque', () => {
    expect(recipeCoverage([ing(), ing({ id: 'i2', productId: 'absent', essential: true })], s).group).toBe('excluded');
  });
  it('ignore les ingrédients hors inventaire dans le taux', () => {
    expect(recipeCoverage([ing(), ing({ id: 'sel', productId: null })], s)).toMatchObject({ coverage: 1, group: 'ready' });
  });
  it('tient pour réalisable une recette sans ingrédient retenu (A7)', () => {
    expect(recipeCoverage([], s)).toMatchObject({ coverage: 1, group: 'ready' });
    expect(recipeCoverage([ing({ productId: null })], s).coverage).toBe(1);
  });
});
