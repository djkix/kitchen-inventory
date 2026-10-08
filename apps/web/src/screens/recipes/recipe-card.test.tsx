import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RecipeSummaryDto } from '@kitchen/shared';
import { RecipeCard } from './recipe-card';

const base: RecipeSummaryDto = {
  id: 'r1',
  title: 'Poulet basquaise',
  difficulty: 'EASY',
  cuisineName: 'Française',
  dishType: 'MAIN',
  prepMinutes: 10,
  cookMinutes: 20,
  totalMinutes: 30,
  servings: 4,
  diets: [],
  imagePath: null,
  archivedAt: null,
  coverage: 1,
  group: 'ready',
  missingLabels: [],
  stats: { timesCooked: 0, lastCookedAt: null, averageRating: null, ratingCount: 0, recentTrend: null, tags: ['never'] },
  favorite: false,
  rating: null,
};

/**
 * Franck ne retrouvait ni la note du foyer ni le nombre de réalisations dans
 * « Mes recettes » (demande d'origine) : les deux doivent apparaître sur la
 * carte elle-même, sans écran dédié.
 */
describe('RecipeCard', () => {
  it('affiche la note et le nombre de réalisations d’une recette déjà faite', () => {
    render(
      <RecipeCard
        recipe={{
          ...base,
          stats: { ...base.stats, timesCooked: 3, averageRating: 4.5, ratingCount: 2, lastCookedAt: null, tags: [] },
        }}
      />,
    );

    expect(screen.getByText(/4,5/)).toBeTruthy();
    expect(screen.getByText(/3 fois/)).toBeTruthy();
  });

  // L'absence de trace se lit mieux que la trace d'une absence : pas de « 0 fois », pas d'étoiles vides.
  it('n’affiche ni note ni compteur pour une recette jamais réalisée', () => {
    render(
      <RecipeCard
        recipe={{
          ...base,
          stats: { ...base.stats, timesCooked: 0, averageRating: null, ratingCount: 0, lastCookedAt: null, tags: ['never'] },
        }}
      />,
    );

    expect(screen.queryByText(/fois/)).toBeNull();
    expect(screen.queryByText(/★/)).toBeNull();
  });
});
