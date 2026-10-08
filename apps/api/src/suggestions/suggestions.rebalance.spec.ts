import type { ModelRecipe } from '@kitchen/shared';
import { describe, expect, it } from 'vitest';
import { rebalance, SUGGESTION_BATCH_SIZE, SUGGESTION_REQUEST_BUFFER } from './suggestions.service.js';

/** Nombre réellement demandé au fournisseur en production : seize, pas douze. */
const REQUESTED = SUGGESTION_BATCH_SIZE + SUGGESTION_REQUEST_BUFFER;

function recipe(provenance: 'web' | 'ai', index: number): ModelRecipe {
  return {
    title: `${provenance}-${index}`,
    origin: provenance === 'web' ? 'Site' : 'Composition',
    region: 'mediterraneenne',
    totalMinutes: 30,
    prepMinutes: 10, cookMinutes: 15,
    difficulty: 'EASY', dishType: 'MAIN',
    provenance,
    sourceUrl: provenance === 'web' ? `https://exemple.test/${index}` : null,
    steps: ['Cuire'],
    ingredients: [{ label: 'tomate', quantity: 1, unit: 'PIECE' }],
  };
}

/** `count` recettes, `web` d'entre elles trouvées sur le web, le reste composé. */
function batch(web: number, ai: number): ModelRecipe[] {
  return [
    ...Array.from({ length: web }, (_, i) => recipe('web', i)),
    ...Array.from({ length: ai }, (_, i) => recipe('ai', i)),
  ];
}

function counts(recipes: readonly ModelRecipe[]): { web: number; ai: number } {
  return { web: recipes.filter((r) => r.provenance === 'web').length, ai: recipes.filter((r) => r.provenance === 'ai').length };
}

describe('rebalance (EF-26, B8) au nombre demandé en production', () => {
  it('demande bien seize recettes pour en rendre douze', () => {
    expect(REQUESTED).toBe(16);
    expect(SUGGESTION_BATCH_SIZE).toBe(12);
  });

  it('tient la cible huit web / quatre composées quand les deux sont en excès', () => {
    const result = rebalance(batch(10, 6));
    expect(result).toHaveLength(SUGGESTION_BATCH_SIZE);
    expect(counts(result)).toEqual({ web: 8, ai: 4 });
  });

  it('complète par du web quand le modèle rend plus de web que la cible et peu de composé', () => {
    // Quatorze web pour deux composées : la part composée manque, le web la comble.
    const result = rebalance(batch(14, 2));
    expect(result).toHaveLength(SUGGESTION_BATCH_SIZE);
    expect(counts(result)).toEqual({ web: 10, ai: 2 });
  });

  it('complète par du composé quand le modèle rend plus de composé que la cible et peu de web', () => {
    const result = rebalance(batch(2, 14));
    expect(result).toHaveLength(SUGGESTION_BATCH_SIZE);
    expect(counts(result)).toEqual({ web: 2, ai: 10 });
  });

  it('ne garde que la cible quand chaque part est juste à son compte', () => {
    const result = rebalance(batch(8, 8));
    expect(result).toHaveLength(SUGGESTION_BATCH_SIZE);
    expect(counts(result)).toEqual({ web: 8, ai: 4 });
  });

  it('rend tout ce qu’il a quand le fournisseur en rend moins que la fournée visée', () => {
    const result = rebalance(batch(3, 2));
    expect(result).toHaveLength(5);
    expect(counts(result)).toEqual({ web: 3, ai: 2 });
  });
});
