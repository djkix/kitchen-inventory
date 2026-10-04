import { describe, expect, it } from 'vitest';
import { modelRecipeSchema, suggestionQuerySchema, SUGGESTION_REGIONS } from './suggestions.js';

const recette = {
  title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne',
  totalMinutes: 25, difficulty: 'EASY', provenance: 'web',
  sourceUrl: 'https://exemple.test/pates', steps: [],
  ingredients: [{ label: 'spaghettis', quantity: 200, unit: 'GRAM' }],
};

describe('modelRecipeSchema', () => {
  it('accepte une recette web complète', () => {
    expect(modelRecipeSchema.parse(recette).title).toBe('Pâtes à la tomate');
  });
  it('refuse une URL qui n’est pas en HTTPS (vigilance 2)', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: 'http://exemple.test/x' }).success).toBe(false);
  });
  it('exige une URL pour une recette web, jamais pour une composition', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: null }).success).toBe(false);
    expect(modelRecipeSchema.safeParse({ ...recette, provenance: 'ai', sourceUrl: null, steps: ['Cuire'] }).success).toBe(true);
  });
  it('exige des étapes pour une composition, qui en dispose déjà', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, provenance: 'ai', sourceUrl: null, steps: [] }).success).toBe(false);
  });
  it('refuse un libellé d’ingrédient vide', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, ingredients: [{ label: '  ', quantity: null, unit: null }] }).success).toBe(false);
  });
  it('accepte une quantité absente : « une pincée » existe', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, ingredients: [{ label: 'persil', quantity: null, unit: null }] }).success).toBe(true);
  });
});

describe('suggestionQuerySchema', () => {
  it('accepte une orientation vide', () => {
    expect(suggestionQuerySchema.parse({})).toEqual({ refresh: false });
  });
  it('accepte les trois dimensions ensemble (B9)', () => {
    const q = suggestionQuerySchema.parse({ region: 'asiatique', maxMinutes: '30', difficulty: 'EASY' });
    expect(q).toMatchObject({ region: 'asiatique', maxMinutes: 30, difficulty: 'EASY' });
  });
  it('refuse une durée hors des paliers', () => {
    expect(suggestionQuerySchema.safeParse({ maxMinutes: '42' }).success).toBe(false);
  });
  it('refuse une région inconnue', () => {
    expect(suggestionQuerySchema.safeParse({ region: 'martienne' }).success).toBe(false);
  });
  it('expose sept régions, sans doublon', () => {
    expect(new Set(SUGGESTION_REGIONS).size).toBe(SUGGESTION_REGIONS.length);
  });
});
