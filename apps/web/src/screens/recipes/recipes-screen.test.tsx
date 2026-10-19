import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import { useCuisinesQuery, useRecipeDirectPatch, useRecipeFiltersQuery, useRecipesInfiniteQuery, usePendingRatingQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import { RecipesScreen } from './recipes-screen';

// L'écran écrit les préférences de filtres et archive une recette : aucune de
// ces deux routes ne doit partir sur le réseau depuis un test (jsdom).
vi.mock('../../lib/recipes-api', () => ({
  recipesApi: { setFilters: vi.fn().mockResolvedValue(undefined), archiveRecipe: vi.fn().mockResolvedValue({}) },
}));

const POULET = {
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
  favorite: false,
  rating: null,
  stats: { timesCooked: 0, lastCookedAt: null, averageRating: null, recentTrend: null },
};

/** Une page unique contenant la recette donnée, au format attendu par `useRecipesInfiniteQuery`. */
function onePage(recipe: unknown = POULET) {
  return { data: { pages: [{ items: [recipe], total: 1, page: 1, limit: 30 }] } } as unknown as Partial<
    ReturnType<typeof useRecipesInfiniteQuery>
  >;
}

/** Glissement : `dx` négatif vers la gauche, `dy` pour le défilement vertical du pouce. */
function swipe(target: Element, dx: number, dy = 0) {
  fireEvent.touchStart(target, { touches: [{ clientX: 300, clientY: 200 }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientX: 300 + dx, clientY: 200 + dy }] });
}

vi.mock('../../lib/queries', () => ({
  useCuisinesQuery: vi.fn(),
  useRecipeFiltersQuery: vi.fn(),
  useRecipesInfiniteQuery: vi.fn(),
  usePendingRatingQuery: vi.fn(),
  // Favori depuis la carte (A2) : un geste à l'écran le pose, aucun des tests
  // existants de cet écran ne l'exerce, d'où un simple bouchon qui ne fait rien.
  useRecipeDirectPatch: vi.fn(() => vi.fn()),
}));

function renderRecipesScreen(recipesQuery?: Partial<ReturnType<typeof useRecipesInfiniteQuery>>, saved?: unknown) {
  vi.mocked(useCuisinesQuery).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useCuisinesQuery>);
  vi.mocked(useRecipeFiltersQuery).mockReturnValue({
    isSuccess: saved !== undefined,
    data: saved,
  } as unknown as ReturnType<typeof useRecipeFiltersQuery>);
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
  beforeEach(() => {
    vi.mocked(recipesApi.archiveRecipe).mockClear();
  });

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
                favorite: false,
                rating: null,
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

  // A2 : la carte bascule le favori sans ouvrir la fiche (le favori n'est pas une navigation).
  it('bascule le favori d’une carte sans suivre son lien', () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useRecipeDirectPatch).mockReturnValue(patch);

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
                favorite: false,
                rating: null,
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

    const star = screen.getByRole('button', { name: 'Favori : Poulet basquaise' });
    fireEvent.click(star);

    expect(patch).toHaveBeenCalledWith('r1', { favorite: true });
  });

  // Un bouton dans un lien est du HTML invalide, et mal exploré au doigt par
  // les lecteurs d'écran mobiles (balayage) : l'étoile doit être la voisine
  // du lien de la carte, jamais sa descendante (round de correction 1).
  it('ne pose jamais l’étoile de favori à l’intérieur du lien de la carte', () => {
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
                favorite: false,
                rating: null,
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

    const link = screen.getByRole('link', { name: 'Poulet basquaise, Prête à 100 %' });
    const star = screen.getByRole('button', { name: 'Favori : Poulet basquaise' });
    expect(link.contains(star)).toBe(false);
  });

  /**
   * D2 (2026-10-19) : les six sélecteurs et les cinq bascules remplissaient en
   * permanence le haut d'un écran de téléphone (« ça prend trop de place sur la
   * page surtout sur un mobile »). Ils passent derrière un bouton unique ; rien
   * n'est retiré, c'est la place permanente qui disparaît.
   */
  it('cache les filtres derrière un bouton « Filtres » (D2)', () => {
    renderRecipesScreen();

    expect(screen.queryByLabelText('Type de plat')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Pastilles rapides' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Type de plat')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Pastilles rapides' })).toBeTruthy();
  });

  // Le bouton doit dire combien de filtres travaillent, sinon un filtre actif
  // devient invisible une fois le panneau refermé.
  it('porte le nombre de filtres actifs (D2)', () => {
    renderRecipesScreen(undefined, { favorite: true, archived: true });

    expect(screen.getByRole('button', { name: 'Filtres (2 actifs)' })).toBeTruthy();
  });

  it('annonce « Filtres » sans nombre quand aucun filtre n’est actif (D2)', () => {
    renderRecipesScreen();

    expect(screen.getByRole('button', { name: 'Filtres' })).toBeTruthy();
  });

  /**
   * D5 : le glissement découvre une action rouge, il n'efface jamais de
   * lui-même — un pouce qui fait défiler la liste en déclencherait sinon une.
   */
  it('découvre l’effacement au glissement vers la gauche, sans rien archiver (D5)', () => {
    renderRecipesScreen(onePage());

    const row = screen.getByRole('listitem');
    expect(row.getAttribute('data-revealed')).toBe('false');

    swipe(row, -90);

    expect(row.getAttribute('data-revealed')).toBe('true');
    expect(vi.mocked(recipesApi.archiveRecipe)).not.toHaveBeenCalled();
  });

  it('ignore un geste surtout vertical : faire défiler la liste ne découvre rien (D5)', () => {
    renderRecipesScreen(onePage());

    const row = screen.getByRole('listitem');
    swipe(row, -90, 120);

    expect(row.getAttribute('data-revealed')).toBe('false');
  });

  /**
   * D5 : un glissement n'existe ni au clavier ni au lecteur d'écran. L'action
   * doit donc être atteignable sans glisser — et nommée par sa recette, jamais
   * « Supprimer » seul au milieu d'une liste.
   */
  it('laisse l’effacement atteignable sans glisser, nommé par sa recette (D5, EF-23)', () => {
    renderRecipesScreen(onePage());

    const bouton = screen.getByRole('button', { name: 'Supprimer Poulet basquaise' });
    // Jamais descendant du lien de couverture : un bouton dans un lien est du
    // HTML invalide, et les lecteurs d'écran tactiles l'absorbent.
    expect(screen.getByRole('link', { name: /^Poulet basquaise,/ }).contains(bouton)).toBe(false);
  });

  /**
   * D4 : « toujours présent dans la base des recettes » — l'effacement est un
   * archivage, précédé d'une confirmation. Aucune suppression réelle.
   */
  it('demande confirmation, puis archive la recette (D4, D5)', async () => {
    renderRecipesScreen(onePage());

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Poulet basquaise' }));
    expect(vi.mocked(recipesApi.archiveRecipe)).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Poulet basquaise/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Effacer' }));

    await waitFor(() => expect(vi.mocked(recipesApi.archiveRecipe)).toHaveBeenCalledWith('r1'));
  });

  it('n’archive rien si la confirmation est annulée (D5)', () => {
    renderRecipesScreen(onePage());

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Poulet basquaise' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(recipesApi.archiveRecipe)).not.toHaveBeenCalled();
  });

  // Une recette déjà archivée (bascule « Archivées ») ne se ré-archive pas.
  it('n’offre pas d’effacement sur une recette déjà archivée', () => {
    renderRecipesScreen(onePage({ ...POULET, archivedAt: '2026-10-01T10:00:00.000Z' }));

    expect(screen.queryByRole('button', { name: /^Supprimer / })).toBeNull();
  });
});
