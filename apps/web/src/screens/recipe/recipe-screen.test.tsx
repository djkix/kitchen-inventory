import type { RecipeDto, RecipeLogDto } from '@kitchen/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import type * as queries from '../../lib/queries';
import { useRecipeLogsInfiniteQuery, useRecipeQuery } from '../../lib/queries';
import { RecipeScreen } from './recipe-screen';

vi.mock('../../lib/queries', async () => {
  const actual = await vi.importActual<typeof queries>('../../lib/queries');
  return { ...actual, useRecipeQuery: vi.fn(), useRecipeLogsInfiniteQuery: vi.fn() };
});

vi.mock('../../hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

const recipe: RecipeDto = {
  id: 'r1',
  title: 'Riz au poulet',
  difficulty: 'EASY',
  cuisineId: null,
  cuisineName: null,
  dishType: null,
  prepMinutes: 10,
  cookMinutes: 20,
  totalMinutes: 30,
  restMinutes: null,
  activeTime: null,
  servings: 4,
  diets: [],
  imagePath: null,
  archivedAt: null,
  coverage: 1,
  group: 'ready',
  missingLabels: [],
  difficultyOverride: false,
  source: 'HOUSEHOLD',
  sourceUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  steps: ['Faire cuire le riz'],
  ingredients: [
    {
      id: 'ing1',
      label: 'Riz',
      productId: null,
      productName: null,
      categoryId: null,
      categoryName: null,
      quantity: 200,
      unit: 'GRAM',
      essential: true,
      substitutable: false,
      state: 'available',
      availableQuantity: 500,
      candidates: [],
      productImagePath: null,
      locationName: null,
      locationTemperature: null,
    },
  ],
  stats: {
    timesCooked: 2,
    lastCookedAt: '2026-10-05T19:00:00.000Z',
    averageRating: null,
    ratingCount: 0,
    recentTrend: null,
    tags: [],
  },
};

const logs: RecipeLogDto[] = [
  { id: 'log1', cookedAt: '2026-10-05T19:00:00.000Z', servingsCooked: 4, stockApplied: true, cookedByName: 'Franck', canRate: true, ratings: [] },
  { id: 'log2', cookedAt: '2026-10-01T19:00:00.000Z', servingsCooked: 4, stockApplied: true, cookedByName: 'Franck', canRate: true, ratings: [] },
];

function renderRecipeScreen() {
  vi.mocked(useAuth).mockReturnValue({
    state: 'authenticated',
    user: { id: 'u1', username: 'franck', role: 'MEMBER' },
    isAdmin: false,
    refresh: vi.fn(),
    clear: vi.fn(),
    error: null,
  } as unknown as ReturnType<typeof useAuth>);

  vi.mocked(useRecipeQuery).mockReturnValue({
    isPending: false,
    isError: false,
    data: recipe,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useRecipeQuery>);

  vi.mocked(useRecipeLogsInfiniteQuery).mockReturnValue({
    data: { pages: [{ items: logs, total: logs.length, page: 1, limit: 20 }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useRecipeLogsInfiniteQuery>);

  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/recettes/r1']}>
          <Routes>
            <Route path="/recettes/:id" element={<RecipeScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * Tâche 5 (D4) : la notation ne doit plus être captive du tiroir de
 * validation de cuisson. Chaque réalisation de l'historique porte son propre
 * bouton « Noter », qui ouvre le même tiroir que celui du bandeau de rappel.
 */
describe('RecipeScreen', () => {
  it('permet de noter une réalisation passée depuis la fiche, sans cuisiner', () => {
    renderRecipeScreen();

    fireEvent.click(screen.getAllByRole('button', { name: /Noter/i })[0]!);

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  /**
   * EF-23 : plusieurs réalisations affichent chacune un bouton « Noter »
   * identique à l'œil. Sans nom distinct, un lecteur d'écran annoncerait
   * plusieurs boutons « Noter » pour la même liste — le nom accessible doit
   * donc désigner la réalisation visée.
   */
  it('nomme chaque bouton « Noter » par sa réalisation', () => {
    renderRecipeScreen();

    expect(screen.getByRole('button', { name: /Noter la réalisation du .*5 oct/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Noter la réalisation du .*1 oct/i })).toBeTruthy();
  });

  it('distingue aussi les boutons de suppression, un par réalisation', () => {
    // Même raison que pour « Noter » : plusieurs boutons au nom identique dans
    // une liste ne se distinguent pas au lecteur d'écran, et une suppression
    // n'est pas une action qu'on veut déclencher sur la mauvaise ligne.
    renderRecipeScreen();
    const boutons = screen.getAllByRole('button', { name: /^Supprimer la réalisation du / });
    const noms = boutons.map((b) => b.getAttribute('aria-label'));
    expect(noms.length).toBeGreaterThan(1);
    expect(new Set(noms).size).toBe(noms.length);
  });

  /**
   * Tâche 8 (EF-26, F1) : la quantité affichée par ligne n'est pas mise à
   * l'échelle par l'API (`RecipeIngredientDto.quantity` reste celui de la
   * recette, tâche 7) — c'est l'écran qui applique `scaleIngredients` à
   * l'affichage, avec le même ratio que celui envoyé au serveur.
   */
  it('recalcule les quantités affichées quand le nombre de parts change', () => {
    renderRecipeScreen();

    expect(screen.getByText('200 g')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Nombre de parts'), { target: { value: '8' } });

    expect(screen.getByText('400 g')).toBeTruthy();
    expect(screen.queryByText('200 g')).toBeNull();
  });

  /**
   * F4 : un seul nombre de parts du début à la fin — jamais deux à tenir.
   * Le nombre choisi sur la fiche devient la valeur initiale du champ
   * « Portions réalisées » du tiroir de cuisson, pas celui de la recette.
   */
  it('reprend le nombre de parts choisi au moment de cuisiner (F4)', () => {
    renderRecipeScreen();

    fireEvent.change(screen.getByLabelText('Nombre de parts'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cuisiner' }));

    expect((screen.getByLabelText('Portions réalisées') as HTMLInputElement).value).toBe('8');
  });
});
