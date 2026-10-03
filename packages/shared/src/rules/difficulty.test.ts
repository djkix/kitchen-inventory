import { describe, expect, it } from 'vitest';
import { computeDifficulty, detectTechniques, difficultyScore } from './difficulty.js';

describe('detectTechniques', () => {
  it('repère une technique sous chacune de ses formes', () => {
    expect(detectTechniques(['Réduire la sauce'])).toEqual(['reduire']);
    expect(detectTechniques(['Faites réduire de moitié'])).toEqual(['reduire']);
    expect(detectTechniques(['Sauce réduite à feu doux'])).toEqual(['reduire']);
  });
  it('ne compte une technique qu’une fois par recette', () => {
    expect(detectTechniques(['Réduire la sauce', 'Réduire encore'])).toEqual(['reduire']);
  });
  it('exige des mots entiers (A11)', () => {
    expect(detectTechniques(['Soulever délicatement', 'Se dessaisir du moule'])).toEqual([]);
  });
  it('ignore les expressions de la liste d’exceptions', () => {
    expect(detectTechniques(['Réduire le feu et couvrir'])).toEqual([]);
    expect(detectTechniques(['Réduire la flamme', 'Réduire la sauce'])).toEqual(['reduire']);
  });
  it('ne repère rien dans une recette sans technique', () => {
    expect(detectTechniques(['Mélanger les ingrédients', 'Servir frais'])).toEqual([]);
  });
});

describe('difficultyScore', () => {
  it('additionne étapes, temps actif et techniques', () => {
    expect(difficultyScore({ steps: ['Ouvrir', 'Servir'], activeTime: 5, prepMinutes: null })).toBe(0);
    expect(difficultyScore({ steps: ['a', 'b', 'c', 'd', 'Déglacer la poêle'], activeTime: 30, prepMinutes: null })).toBe(4);
  });
  it('se replie sur le temps de préparation quand le temps actif manque (A12)', () => {
    expect(difficultyScore({ steps: ['a'], activeTime: null, prepMinutes: 60 })).toBe(3);
    expect(difficultyScore({ steps: ['a'], activeTime: 5, prepMinutes: 60 })).toBe(0);
  });
  it('traite deux temps absents comme nuls', () => {
    expect(difficultyScore({ steps: ['a'], activeTime: null, prepMinutes: null })).toBe(0);
  });
  it('plafonne la contribution des techniques à trois points', () => {
    const steps = ['Pétrir', 'Laisser lever', 'Émulsionner', 'Caraméliser', 'Flamber'];
    expect(difficultyScore({ steps, activeTime: 0, prepMinutes: null })).toBe(4);
  });
});

describe('computeDifficulty', () => {
  it('place chaque score dans son palier', () => {
    expect(computeDifficulty({ steps: ['Ouvrir la boîte'], activeTime: 2, prepMinutes: null })).toBe('VERY_EASY');
    expect(computeDifficulty({ steps: ['a', 'b', 'c', 'd'], activeTime: 20, prepMinutes: null })).toBe('EASY');
    expect(computeDifficulty({ steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], activeTime: 30, prepMinutes: null })).toBe('INTERMEDIATE');
    expect(
      computeDifficulty({
        steps: ['Pétrir la pâte', 'Laisser lever', 'Émulsionner', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
        activeTime: 90,
        prepMinutes: null,
      }),
    ).toBe('HARD');
  });
});
