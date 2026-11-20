import { describe, expect, it } from 'vitest';
import { recipeIngredientFromModel } from './recipe-ingredient-from-model.js';

/**
 * Le défaut du 2026-11-20 : la consigne enrichie a fait apparaître le placard
 * de base, compté à l'unité, et « Une quantité exige une unité » refusait
 * alors la recette entière à l'entrée dans « Mes recettes ».
 */
describe('recipeIngredientFromModel', () => {
  it('donne PIECE à un nombre nu — « 2 gousses d’ail », « 1 oignon »', () => {
    expect(recipeIngredientFromModel({ label: 'Ail', quantity: 2, unit: null })).toEqual({ quantity: 2, unit: 'PIECE' });
  });

  it('ne touche pas à une quantité qui porte déjà son unité', () => {
    expect(recipeIngredientFromModel({ label: 'Farine', quantity: 250, unit: 'GRAM' })).toEqual({ quantity: 250, unit: 'GRAM' });
  });

  it('laisse un ingrédient sans quantité tel quel', () => {
    expect(recipeIngredientFromModel({ label: 'Sel', quantity: null, unit: null })).toEqual({ quantity: null, unit: null });
  });

  it('écarte une unité sans quantité, qui ne dit rien', () => {
    expect(recipeIngredientFromModel({ label: 'Farine', quantity: null, unit: 'GRAM' })).toEqual({ quantity: null, unit: null });
  });
});
