import type { RecipeDto, RecipeLogDto } from '@kitchen/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { useAuth } from '../../hooks/use-auth';
import type * as queries from '../../lib/queries';
import { useRecipeLogsInfiniteQuery, useRecipeQuery } from '../../lib/queries';
import type * as recipesApiModule from '../../lib/recipes-api';
import { recipesApi } from '../../lib/recipes-api';
import { RecipeScreen } from './recipe-screen';

vi.mock('../../lib/queries', async () => {
  const actual = await vi.importActual<typeof queries>('../../lib/queries');
  return { ...actual, useRecipeQuery: vi.fn(), useRecipeLogsInfiniteQuery: vi.fn() };
});

vi.mock('../../hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

// Le favori et la note directe passent par `recipesApi.updateRecipe` (`useRecipeDirectPatch`,
// `lib/queries.ts`) : une vraie requête réseau planterait en test (jsdom, pas de serveur).
vi.mock('../../lib/recipes-api', async () => {
  const actual = await vi.importActual<typeof recipesApiModule>('../../lib/recipes-api');
  return { recipesApi: { ...actual.recipesApi, updateRecipe: vi.fn().mockResolvedValue({}) } };
});

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
  favorite: false,
  rating: null,
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

const AUTHENTICATED_AUTH = {
  state: 'authenticated',
  user: { id: 'u1', username: 'franck', role: 'MEMBER' },
  isAdmin: false,
  refresh: vi.fn(),
  clear: vi.fn(),
  error: null,
} as unknown as ReturnType<typeof useAuth>;

const EMPTY_LOGS_QUERY = {
  data: { pages: [{ items: [], total: 0, page: 1, limit: 20 }] },
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
} as unknown as ReturnType<typeof useRecipeLogsInfiniteQuery>;

function renderWith() {
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

function renderRecipeScreen() {
  vi.mocked(useAuth).mockReturnValue(AUTHENTICATED_AUTH);

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

  renderWith();
}

/**
 * Tâche 5 (D4) : la notation ne doit plus être captive du tiroir de
 * validation de cuisson. Chaque réalisation de l'historique porte son propre
 * bouton « Noter », qui ouvre le même tiroir que celui du bandeau de rappel.
 */
describe('RecipeScreen', () => {
  beforeEach(() => {
    vi.mocked(recipesApi.updateRecipe).mockClear();
  });


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

  it('laisse remplacer le nombre de parts, pas seulement y ajouter des chiffres', () => {
    // Le champ se repliait sur le nombre courant quand il était vide : effacer
    // réaffichait aussitôt l'ancien chiffre, donc taper « 2 » sur « 4 » donnait
    // « 42 » et jamais « 2 ». Rencontré par Franck le 2026-10-08.
    renderRecipeScreen();
    const champ = screen.getByLabelText('Nombre de parts') as HTMLInputElement;
    expect(champ.value).toBe('4');

    fireEvent.change(champ, { target: { value: '' } });
    expect(champ.value).toBe('');

    fireEvent.change(champ, { target: { value: '2' } });
    expect(champ.value).toBe('2');
  });

  // A2 : l'étoile de favori bascule et annonce son état (aria-pressed), sans réalisation requise.
  it('annonce l’état du favori par aria-pressed et bascule au clic', () => {
    vi.mocked(useAuth).mockReturnValue(AUTHENTICATED_AUTH);
    vi.mocked(useRecipeQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...recipe, favorite: true },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipeQuery>);
    vi.mocked(useRecipeLogsInfiniteQuery).mockReturnValue(EMPTY_LOGS_QUERY);
    renderWith();

    const star = screen.getByRole('button', { name: `Favori : ${recipe.title}` });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.textContent).toBe('★');

    fireEvent.click(star);

    // La recette affichée vient d'une donnée figée par le test (mock de `useRecipeQuery`) :
    // on vérifie donc le geste envoyé au serveur, pas le nouvel état visuel, qui dépend du
    // cache réel de TanStack Query (`patchRecipeInCache`, `lib/queries.ts`) hors de ce test.
    expect(vi.mocked(recipesApi.updateRecipe)).toHaveBeenCalledWith('r1', { favorite: false });
  });

  // A3 : cinq étoiles posent une note directe, utilisable sans réalisation enregistrée.
  it('pose une note directe depuis la fiche', () => {
    renderRecipeScreen();

    fireEvent.click(screen.getByRole('radio', { name: '4 étoiles' }));

    expect(vi.mocked(recipesApi.updateRecipe)).toHaveBeenCalledWith('r1', { rating: 4 });
  });

  // A3 : une note directe déjà posée se corrige et se retire.
  it('corrige puis retire une note directe déjà posée', async () => {
    vi.mocked(useAuth).mockReturnValue(AUTHENTICATED_AUTH);
    vi.mocked(useRecipeQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...recipe, rating: 3 },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipeQuery>);
    vi.mocked(useRecipeLogsInfiniteQuery).mockReturnValue(EMPTY_LOGS_QUERY);
    renderWith();

    expect(screen.getByRole('radio', { name: '3 étoiles', checked: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '2 étoiles' }));
    expect(vi.mocked(recipesApi.updateRecipe)).toHaveBeenCalledWith('r1', { rating: 2 });
    // Laisse la requête (simulée) se résoudre avant le geste suivant : sinon le
    // bouton reste désactivé le temps de celle-ci (`busy`, évite un double envoi).
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retirer la note' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Retirer la note' }));
    expect(vi.mocked(recipesApi.updateRecipe)).toHaveBeenCalledWith('r1', { rating: null });
  });

  // Correctif de revue (2026-10-08, A5) : une moyenne de réalisations ne doit
  // JAMAIS cocher une étoile du radiogroup — sinon re-taper cette étoile
  // semblerait ne rien faire alors qu'elle convertirait silencieusement une
  // moyenne en note directe. Les étoiles restent vides, le chiffre reste
  // lisible dans la phrase en dessous.
  it('laisse les étoiles vides quand la seule note vient de la moyenne des réalisations', () => {
    vi.mocked(useAuth).mockReturnValue(AUTHENTICATED_AUTH);
    vi.mocked(useRecipeQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...recipe, rating: null, stats: { ...recipe.stats, averageRating: 4.3, ratingCount: 3 } },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipeQuery>);
    vi.mocked(useRecipeLogsInfiniteQuery).mockReturnValue(EMPTY_LOGS_QUERY);
    renderWith();

    for (const star of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('radio', { name: `${star} étoile${star > 1 ? 's' : ''}` }).getAttribute('aria-checked')).toBe('false');
    }
    expect(screen.getByText('Moyenne des réalisations : posez une note pour la remplacer.')).toBeTruthy();
  });

  // Sans note directe ni réalisation notée, rien à retirer : le bouton ne s'affiche pas.
  it('ne propose pas de retirer une note qui n’existe pas', () => {
    renderRecipeScreen();
    expect(screen.queryByRole('button', { name: 'Retirer la note' })).toBeNull();
  });

  // A6 : la fiche d'une recette jamais cuisinée explique l'absence d'historique et rappelle la note directe.
  it('explique l’absence d’historique pour une recette jamais cuisinée', () => {
    vi.mocked(useAuth).mockReturnValue(AUTHENTICATED_AUTH);
    vi.mocked(useRecipeQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...recipe, stats: { ...recipe.stats, timesCooked: 0, lastCookedAt: null } },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipeQuery>);
    vi.mocked(useRecipeLogsInfiniteQuery).mockReturnValue(EMPTY_LOGS_QUERY);
    renderWith();

    expect(screen.getByText(/Jamais faite/)).toBeTruthy();
    expect(screen.getByText(/note directe.*reste possible/)).toBeTruthy();
  });

  it('intitule la note « Note du foyer », jamais « Ma note »', () => {
    // `Recipe.rating` n'a pas de `userId` : la note est partagée, comme le
    // favori. Un libellé possessif laisserait croire à une note personnelle
    // qu'un autre membre ne pourrait pas écraser — ce qu'il peut faire.
    renderRecipeScreen();
    expect(screen.getByText('Note du foyer')).toBeTruthy();
    expect(screen.queryByText('Ma note')).toBeNull();
  });
});
