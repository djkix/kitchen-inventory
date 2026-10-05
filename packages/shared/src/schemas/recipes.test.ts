import { describe, expect, it } from 'vitest';
import { cookRecipeSchema, createRecipeSchema, rateLogSchema, recipeListQuerySchema } from './recipes.js';

const valid = { title: 'Ramen', servings: 2, steps: ['Bouillir'], ingredients: [{ label: 'Nouilles', productId: 'p1', quantity: 200, unit: 'GRAM' }] };

describe('createRecipeSchema', () => {
  it('applique les défauts, dont essentiel à faux (A1, A2)', () => {
    const parsed = createRecipeSchema.parse(valid);
    expect(parsed.ingredients[0]).toMatchObject({ essential: false, substitutable: false });
    expect(parsed.diets).toEqual([]);
  });
  it('exige un titre et au moins une étape', () => {
    expect(createRecipeSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false);
  });
  it('refuse une quantité nulle, et une quantité sans unité', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', quantity: 0, unit: 'GRAM' }] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', quantity: 200 }] }).success).toBe(false);
  });
  it('refuse un ingrédient visant à la fois un produit et une catégorie', () => {
    expect(createRecipeSchema.safeParse({ ...valid, ingredients: [{ label: 'x', productId: 'p', categoryId: 'c' }] }).success).toBe(false);
  });
  it('n’accepte qu’un type de plat et plusieurs régimes (A4, A5)', () => {
    expect(createRecipeSchema.parse({ ...valid, dishType: 'MAIN', diets: ['VEGAN', 'GLUTEN_FREE'] }).dishType).toBe('MAIN');
    expect(createRecipeSchema.safeParse({ ...valid, dishType: ['MAIN'] }).success).toBe(false);
    expect(createRecipeSchema.safeParse({ ...valid, diets: ['INCONNU'] }).success).toBe(false);
  });
});

describe('recipeListQuerySchema', () => {
  it('accepte un filtre unique ou répété, et convertit les nombres', () => {
    expect(recipeListQuerySchema.parse({ difficulty: ['EASY', 'HARD'], maxTime: '30', page: '2' })).toMatchObject({
      difficulty: ['EASY', 'HARD'], maxTime: 30, page: 2, sort: 'rating', archived: false,
    });
    expect(recipeListQuerySchema.parse({ cuisine: 'c1' }).cuisine).toEqual(['c1']);
  });
  it('refuse un tri inconnu', () => {
    expect(recipeListQuerySchema.safeParse({ sort: 'aleatoire' }).success).toBe(false);
  });
  it('ne prend pas la chaîne « false » pour un vrai (même défaut de z.coerce.boolean que suggestionQuerySchema)', () => {
    // Régression : l'écran Mes recettes envoie toujours `archived=false`
    // explicitement (`EMPTY_RECIPE_FILTERS`), jamais une absence du paramètre —
    // `z.coerce.boolean()` rendait `true` pour cette chaîne et la bibliothèque
    // n'affichait plus aucune recette active (section 19, parcours P5).
    expect(recipeListQuerySchema.parse({ archived: 'false' }).archived).toBe(false);
    expect(recipeListQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
    expect(recipeListQuerySchema.parse({}).archived).toBe(false);
  });
});

describe('cookRecipeSchema et rateLogSchema', () => {
  it('exige des portions positives et accepte le produit choisi par ligne (A15)', () => {
    expect(cookRecipeSchema.safeParse({ servingsCooked: 0, lines: [] }).success).toBe(false);
    expect(cookRecipeSchema.parse({ servingsCooked: 4, lines: [{ ingredientId: 'i1', productId: 'p2' }] }).lines[0]).toMatchObject({
      ingredientId: 'i1', productId: 'p2',
    });
  });
  it('n’a pas de champ `quantity` par ligne : seul le serveur met à l’échelle (A14)', () => {
    // Une quantité envoyée par erreur ne doit pas réapparaître après parsing, pour qu'aucun
    // appelant ne puisse être tenté de s'y fier à la place du calcul serveur.
    const parsed = cookRecipeSchema.parse({ servingsCooked: 4, lines: [{ ingredientId: 'i1', quantity: 999 }] });
    expect(parsed.lines[0]).not.toHaveProperty('quantity');
  });
  it('borne la note entre 1 et 5', () => {
    expect(rateLogSchema.safeParse({ stars: 6 }).success).toBe(false);
    expect(rateLogSchema.safeParse({ stars: 0 }).success).toBe(false);
    expect(rateLogSchema.parse({ stars: 4 }).comment).toBeNull();
  });
});
