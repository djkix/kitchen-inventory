import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { useCuisinesQuery, useRecipeFiltersQuery, useRecipesInfiniteQuery, usePendingRatingQuery } from '../../lib/queries';
import { RecipesScreen } from './recipes-screen';

vi.mock('../../lib/queries', () => ({
  useCuisinesQuery: vi.fn(),
  useRecipeFiltersQuery: vi.fn(),
  useRecipesInfiniteQuery: vi.fn(),
  usePendingRatingQuery: vi.fn(),
}));

function renderRecipesScreen() {
  vi.mocked(useCuisinesQuery).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useCuisinesQuery>);
  vi.mocked(useRecipeFiltersQuery).mockReturnValue({ isSuccess: false, data: undefined } as unknown as ReturnType<typeof useRecipeFiltersQuery>);
  vi.mocked(usePendingRatingQuery).mockReturnValue({ isPending: false, isError: false, data: null } as unknown as ReturnType<typeof usePendingRatingQuery>);
  vi.mocked(useRecipesInfiniteQuery).mockReturnValue({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { pages: [{ items: [], total: 0, page: 1, limit: 30 }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useRecipesInfiniteQuery>);

  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <RecipesScreen />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * La création de recette à la main a été retirée (EF-26, tâche 13) : la seule
 * façon d'ajouter une recette est de conserver une suggestion. Aucun bouton
 * « + » ne doit donc apparaître sur la bibliothèque.
 */
describe('RecipesScreen', () => {
  it('n’offre plus de création de recette (B13)', () => {
    renderRecipesScreen();

    expect(screen.queryByRole('link', { name: /nouvelle recette/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /nouvelle recette/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^\+$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^\+$/ })).toBeNull();
  });
});
