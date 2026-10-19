import type { RecipeDto, RecipeLogDto } from '@kitchen/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  { id: 'log1', cookedAt: '2026-10-05T19:00:00.000Z', servingsCooked: 4, stockApplied: true, cookedByName: 'djkix', canRate: true, ratings: [] },
  { id: 'log2', cookedAt: '2026-10-01T19:00:00.000Z', servingsCooked: 4, stockApplied: true, cookedByName: 'djkix', canRate: true, ratings: [] },
];

const AUTHENTICATED_AUTH = {
  state: 'authenticated',
  user: { id: 'u1', username: 'proprietaire', role: 'MEMBER' },
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
    // « 42 » et jamais « 2 ». Rencontré par djkix le 2026-10-08.
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
  });

  /**
   * D7 (2026-10-19) : « ne pas afficher la note du foyer (trop de place) ».
   * Les cinq étoiles de notation directe quittent la fiche. La note reste
   * lisible sur les cartes de « Mes recettes » et reste le tri par défaut ; la
   * notation après cuisson, par personne, vit dans l'historique et n'est pas
   * touchée.
   */
  it('n’affiche plus la note du foyer sur la fiche (D7)', () => {
    renderRecipeScreen();

    expect(screen.queryByText('Note du foyer')).toBeNull();
    expect(screen.queryByRole('radio', { name: '4 étoiles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retirer la note' })).toBeNull();
  });

  // La notation par membre, après cuisson, n'est pas concernée : elle reste
  // atteignable depuis chaque réalisation de l'historique.
  it('laisse intacte la notation d’une réalisation dans l’historique (D7)', () => {
    renderRecipeScreen();

    fireEvent.click(screen.getAllByRole('button', { name: /Noter/i })[0]!);
    expect(screen.getByRole('radio', { name: '4 étoiles' })).toBeTruthy();
  });

  /**
   * D8 : le nombre de parts rejoint préparation et cuisson — « pour combien, et
   * combien de temps » est une seule lecture.
   */
  it('range le nombre de parts dans le bloc des durées (D8)', () => {
    renderRecipeScreen();

    const bloc = screen.getByRole('group', { name: 'Durées et parts' });
    expect(bloc.contains(screen.getByLabelText('Nombre de parts'))).toBe(true);
    expect(bloc.contains(screen.getByText('Préparation'))).toBe(true);
    expect(bloc.contains(screen.getByText('Cuisson'))).toBe(true);
  });

  /**
   * D9 : durée et difficulté deviennent des blocs colorés, sur deux échelles
   * distinctes. La couleur ne porte jamais l'information seule — le texte reste
   * lu, pour le daltonisme comme pour le mode sombre.
   */
  it('colore la difficulté selon son échelle, sans jamais retirer le texte (D9)', () => {
    renderRecipeScreen();
    const facile = screen.getByText('Facile');
    const lookFacile = facile.className;

    cleanup();
    vi.mocked(useRecipeQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...recipe, difficulty: 'HARD' },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipeQuery>);
    renderWith();

    const difficile = screen.getByText('Difficile');
    expect(difficile.className).not.toBe(lookFacile);
    // Jetés du thème, jamais de couleur en dur : l'application n'a qu'un mode
    // sombre et une pastille codée en dur y a déjà disparu dans son conteneur.
    expect(lookFacile).toMatch(/bg-[a-z-]+ text-[a-z-]+/);
    expect(difficile.className).toMatch(/bg-[a-z-]+ text-[a-z-]+/);
  });

  it('colore la durée sur sa propre échelle, texte compris (D9)', () => {
    renderRecipeScreen();
    const court = screen.getByText('30 min');
    const lookCourt = court.className;

    cleanup();
    vi.mocked(useRecipeQuery).mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...recipe, totalMinutes: 180, prepMinutes: 60, cookMinutes: 120 },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRecipeQuery>);
    renderWith();

    const long = screen.getByText('3 h');
    expect(long.className).not.toBe(lookCourt);
  });
});
