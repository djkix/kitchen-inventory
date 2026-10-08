import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  // Une recette jamais cuisinée mais déjà notée directement (D1) garde sa note visible sur la carte.
  it('affiche la note directe d’une recette jamais réalisée', () => {
    render(<RecipeCard recipe={{ ...base, rating: 5, stats: { ...base.stats, timesCooked: 0 } }} />);

    expect(screen.getByText(/Jamais faite/)).toBeTruthy();
    expect(screen.getByText(/★ 5,0/)).toBeTruthy();
  });

  // D3 : la note directe prime sur la moyenne des réalisations, jamais les deux à la fois.
  it('affiche la note directe plutôt que la moyenne des réalisations quand les deux existent', () => {
    render(
      <RecipeCard
        recipe={{
          ...base,
          rating: 2,
          stats: { ...base.stats, timesCooked: 3, averageRating: 4.5, ratingCount: 2 },
        }}
      />,
    );

    expect(screen.getByText(/★ 2,0/)).toBeTruthy();
    expect(screen.queryByText(/★ 4,5/)).toBeNull();
  });

  it('n’affiche l’étoile de favori que si la carte sait la basculer', () => {
    const { rerender } = render(<RecipeCard recipe={base} />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<RecipeCard recipe={base} onToggleFavorite={vi.fn()} />);
    expect(screen.getByRole('button', { name: `Favori : ${base.title}` })).toBeTruthy();
  });

  it('bascule le favori sans déclencher la navigation de la carte', () => {
    const onToggleFavorite = vi.fn();
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <RecipeCard recipe={{ ...base, favorite: true }} onToggleFavorite={onToggleFavorite} />
      </div>,
    );

    const star = screen.getByRole('button', { name: `Favori : ${base.title}` });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
