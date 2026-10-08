import { describe, expect, it } from 'vitest';
import { modelBatchSchema, modelRecipeSchema, suggestionQuerySchema, SUGGESTION_REGIONS } from './suggestions.js';

const recette = {
  title: 'Pâtes à la tomate', origin: 'italienne', region: 'mediterraneenne',
  totalMinutes: 25, difficulty: 'EASY', dishType: 'MAIN', provenance: 'web',
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
  it('accepte une URL https écrite en majuscules (test insensible à la casse)', () => {
    expect(modelRecipeSchema.safeParse({ ...recette, sourceUrl: 'HTTPS://EXEMPLE.TEST/pates' }).success).toBe(true);
  });
});

describe('modelBatchSchema : validation recette par recette', () => {
  it('garde les recettes valides et écarte la seule entrée mal formée', () => {
    const result = modelBatchSchema.safeParse({
      recipes: [recette, { ...recette, sourceUrl: 'http://exemple.test/x' }, { ...recette, title: 'Deuxième' }],
    });
    expect(result.success).toBe(true);
    expect(result.data?.recipes.map((r) => r.title)).toEqual(['Pâtes à la tomate', 'Deuxième']);
  });
  it('accepte une recette web dont l’URL est en HTTPS majuscule', () => {
    const result = modelBatchSchema.safeParse({ recipes: [{ ...recette, sourceUrl: 'HTTPS://exemple.test/pates' }] });
    expect(result.success).toBe(true);
    expect(result.data?.recipes).toHaveLength(1);
  });
  it('écarte une recette « ai » qui porte malgré tout une URL, sans perdre les autres', () => {
    const result = modelBatchSchema.safeParse({
      recipes: [{ ...recette, provenance: 'ai', steps: ['Cuire'] }, recette],
    });
    expect(result.success).toBe(true);
    expect(result.data?.recipes).toHaveLength(1);
  });
  it('échoue quand aucune entrée ne tient debout', () => {
    expect(modelBatchSchema.safeParse({ recipes: [{ title: 'rien' }, { nope: true }] }).success).toBe(false);
  });
  it('accepte un lot vide : « je ne propose rien » est une réponse', () => {
    const result = modelBatchSchema.safeParse({ recipes: [] });
    expect(result.success).toBe(true);
    expect(result.data?.recipes).toEqual([]);
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
  it('ne prend pas la chaîne « false » pour un vrai (défaut de z.coerce.boolean)', () => {
    expect(suggestionQuerySchema.parse({ refresh: 'false' }).refresh).toBe(false);
    expect(suggestionQuerySchema.parse({ refresh: 'true' }).refresh).toBe(true);
    expect(suggestionQuerySchema.parse({}).refresh).toBe(false);
  });
  it('refuse une valeur de refresh qui n’est ni « true » ni « false »', () => {
    expect(suggestionQuerySchema.safeParse({ refresh: 'oui' }).success).toBe(false);
  });
  it('refuse une région inconnue', () => {
    expect(suggestionQuerySchema.safeParse({ region: 'martienne' }).success).toBe(false);
  });
  it('expose sept régions, sans doublon', () => {
    expect(new Set(SUGGESTION_REGIONS).size).toBe(SUGGESTION_REGIONS.length);
  });
});
