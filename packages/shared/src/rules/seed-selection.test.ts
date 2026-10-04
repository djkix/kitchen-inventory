import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../constants.js';
import { normalizeProductName } from './duplicates.js';
import { pickSeedIngredients, isStructuring, NON_STRUCTURING_CATEGORIES, SEED_MAX, type SeedCandidate } from './seed-selection.js';

const c = (name: string, ...categoryPath: string[]): SeedCandidate => ({ productId: name, name, categoryPath });
const many = (n: number): SeedCandidate[] => Array.from({ length: n }, (_, i) => c(`produit ${i}`, 'feculents'));
const JOUR = new Date('2026-10-04T12:00:00Z');
const LENDEMAIN = new Date('2026-10-05T08:00:00Z');

/** Chemin de catégorie d'une des catégories réellement semées par défaut (revue de tâche 6). */
const defaultCategoryPath = (name: string): string => {
  const category = DEFAULT_CATEGORIES.find((cat) => cat.name === name);
  if (!category) throw new Error(`Catégorie par défaut introuvable : ${name}`);
  return normalizeProductName(category.name);
};

describe('isStructuring', () => {
  it('écarte les épices par la catégorie réellement semée par défaut (B5)', () => {
    const epices = defaultCategoryPath('Épices et aromates');
    expect(NON_STRUCTURING_CATEGORIES).toContain(epices);
    expect(isStructuring(c('Paprika fumé', 'epicerie', epices))).toBe(false);
  });
  it('écarte le sel et le poivre par le nom du produit, faute de catégorie dédiée (B5)', () => {
    expect(isStructuring(c('Sel fin'))).toBe(false);
    expect(isStructuring(c('Gros sel de Guérande'))).toBe(false);
    expect(isStructuring(c('Poivre noir moulu'))).toBe(false);
  });
  it('ne confond jamais le poivron avec le poivre', () => {
    expect(isStructuring(c('Poivron rouge'))).toBe(true);
  });
  it('garde l’huile et le vinaigre, qui font des plats (B5)', () => {
    expect(isStructuring(c('Huile d’olive', 'epicerie', 'huiles-et-vinaigres'))).toBe(true);
  });
  it('garde un aliment sans catégorie plutôt que de l’écarter au hasard', () => {
    expect(isStructuring(c('Reste de poulet'))).toBe(true);
  });
});

describe('pickSeedIngredients', () => {
  it('ne dépasse jamais huit ingrédients (B3)', () => {
    expect(pickSeedIngredients(many(30), JOUR)).toHaveLength(SEED_MAX);
  });
  it('rend tout ce qu’il y a quand le stock est maigre', () => {
    expect(pickSeedIngredients(many(3), JOUR)).toHaveLength(3);
  });
  it('rend une liste vide plutôt que d’inventer, quand tout est exclu', () => {
    expect(pickSeedIngredients([c('Sel')], JOUR)).toEqual([]);
  });
  it('garde les cinq premières places stables d’un jour à l’autre (B4)', () => {
    const stock = many(20);
    const jour = pickSeedIngredients(stock, JOUR).slice(0, 5).map((s) => s.productId);
    const lendemain = pickSeedIngredients(stock, LENDEMAIN).slice(0, 5).map((s) => s.productId);
    expect(lendemain).toEqual(jour);
  });
  it('fait tourner les trois dernières places (B4)', () => {
    const stock = many(20);
    const jour = pickSeedIngredients(stock, JOUR).slice(5).map((s) => s.productId);
    const lendemain = pickSeedIngredients(stock, LENDEMAIN).slice(5).map((s) => s.productId);
    expect(lendemain).not.toEqual(jour);
  });
  it('rend deux fois la même chose le même jour, à heure différente', () => {
    const stock = many(20);
    const matin = pickSeedIngredients(stock, new Date('2026-10-04T07:00:00Z'));
    const soir = pickSeedIngredients(stock, new Date('2026-10-04T21:00:00Z'));
    expect(soir).toEqual(matin);
  });
  it('ne répète jamais un produit entre les places stables et les tournantes', () => {
    const ids = pickSeedIngredients(many(9), JOUR).map((s) => s.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
