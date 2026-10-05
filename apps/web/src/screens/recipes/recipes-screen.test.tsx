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

function renderRecipesScreen(recipesQuery?: Partial<ReturnType<typeof useRecipesInfiniteQuery>>) {
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
    ...recipesQuery,
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

  /**
   * EF-23 : le `<Link>` enveloppe une `RecipeCard`, dont le contenu est un
   * `<article>` — le contenu d'un rôle `article` ne remonte pas dans le nom
   * calculé d'un lien ancêtre (Chromium), un lien sans `aria-label` explicite
   * serait donc annoncé sans nom par un lecteur d'écran, et introuvable par
   * une requête rôle + nom (c'est ainsi que le défaut a été découvert, un
   * test de bout en bout ne retrouvant pas une recette qu'il venait de
   * conserver). `getByRole('link', { name })` reproduit cette requête : un
   * test qui se contenterait de vérifier la présence d'un lien n'aurait pas
   * détecté le défaut d'origine (un nom vide passe toujours `toBeVisible`).
   */
  it('nomme chaque recette pour une requête par rôle et nom (EF-23)', () => {
    renderRecipesScreen({
      data: {
        pages: [
          {
            items: [
              {
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
                stats: { timesCooked: 0, lastCookedAt: null, averageRating: null, recentTrend: null },
              },
            ],
            total: 1,
            page: 1,
            limit: 30,
          },
        ],
      },
    } as unknown as Partial<ReturnType<typeof useRecipesInfiniteQuery>>);

    // Le nom doit être utile, pas seulement présent : le titre identifie la
    // recette, l'état de couverture dit si elle est cuisinable maintenant —
    // la même information que le badge coloré de la carte, en mots.
    const link = screen.getByRole('link', { name: 'Poulet basquaise, Prête à 100 %' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/recettes/r1');
  });
});
