import type { RecipeDto } from '@kitchen/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/toast';
import type * as queries from '../../lib/queries';
import { useRecipeQuery } from '../../lib/queries';
import type * as recipesApiModule from '../../lib/recipes-api';
import { recipesApi } from '../../lib/recipes-api';
import { RecipeScreen } from './recipe-screen';

vi.mock('../../lib/queries', async () => {
  const actual = await vi.importActual<typeof queries>('../../lib/queries');
  return { ...actual, useRecipeQuery: vi.fn() };
});

// Le favori passe par `recipesApi.updateRecipe` (`useRecipeDirectPatch`,
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

function renderRecipeScreen(overrides: Partial<RecipeDto> = {}) {
  vi.mocked(useRecipeQuery).mockReturnValue({
    isPending: false,
    isError: false,
    data: { ...recipe, ...overrides },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useRecipeQuery>);

  renderWith();
}

describe('RecipeScreen', () => {
  beforeEach(() => {
    vi.mocked(recipesApi.updateRecipe).mockClear();
  });

  /**
   * 2026-10-20, demande de Franck : la fiche devient strictement en lecture.
   * Plus de cuisson, plus d'enregistrement de réalisation, plus de
   * modification, d'archivage, de restauration ni de suppression depuis ici.
   * Les composants correspondants restent dans le dépôt, simplement plus rendus.
   */
  it('ne propose plus aucune action d’écriture, hors favori', () => {
    renderRecipeScreen();

    for (const nom of ['Cuisiner', 'J’ai fait cette recette', 'Modifier', 'Archiver', 'Restaurer', 'Supprimer']) {
      expect(screen.queryByRole('button', { name: nom })).toBeNull();
    }
    expect(screen.queryByRole('region', { name: 'Historique' })).toBeNull();
    expect(screen.queryByText(/Jamais faite/)).toBeNull();
  });

  /**
   * Un seul bloc en tête : cuisine, durée totale, difficulté, favori, durées
   * de détail et nombre de parts se lisent d'un coup, sans second encadré.
   */
  it('réunit repères, durées et parts dans une seule section en tête', () => {
    renderRecipeScreen();

    const bloc = screen.getByRole('group', { name: 'Résumé de la recette' });
    expect(bloc.contains(screen.getByLabelText('Parts'))).toBe(true);
    expect(bloc.contains(screen.getByText('Préparation'))).toBe(true);
    expect(bloc.contains(screen.getByText('Facile'))).toBe(true);
    expect(bloc.contains(screen.getByRole('button', { name: `Favori : ${recipe.title}` }))).toBe(true);
  });

  /**
   * « Si pas de repos, ne l'affiche pas » : une durée absente ne laisse plus
   * un tiret à lire, elle disparaît.
   */
  it('n’affiche que les durées renseignées', () => {
    renderRecipeScreen();

    expect(screen.queryByText('Repos')).toBeNull();
    expect(screen.queryByText('Temps actif')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();

    cleanup();
    renderRecipeScreen({ restMinutes: 45 });

    expect(screen.getByText('Repos')).toBeTruthy();
    expect(screen.getByText('45 min')).toBeTruthy();
  });

  /**
   * EF-26, F1 : la quantité affichée par ligne n'est pas mise à l'échelle par
   * l'API — c'est l'écran qui applique `scaleIngredients`. Seule fonction du
   * bloc « Durées et parts » qui survit au passage en lecture seule.
   */
  it('recalcule les quantités affichées quand le nombre de parts change', () => {
    renderRecipeScreen();

    expect(screen.getByText('200 g')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Parts'), { target: { value: '8' } });

    expect(screen.getByText('400 g')).toBeTruthy();
    expect(screen.queryByText('200 g')).toBeNull();
  });

  // 2026-10-20 : le champ habillé était deux fois plus haut que les durées et
  // cassait la ligne pour un seul chiffre. Même gabarit qu'elles désormais, et
  // deux chiffres au plus.
  it('borne les parts à deux chiffres et refuse au-delà de vingt', () => {
    renderRecipeScreen();
    const champ = screen.getByLabelText('Parts') as HTMLInputElement;
    expect(champ.maxLength).toBe(2);

    fireEvent.change(champ, { target: { value: '25' } });
    // La saisie reste à l'écran — on n'efface jamais sous les doigts — mais
    // elle ne part pas au serveur.
    expect(champ.value).toBe('25');
    expect(screen.queryByText('Pour 25 parts')).toBeNull();
  });

  it('laisse remplacer le nombre de parts, pas seulement y ajouter des chiffres', () => {
    // Le champ se repliait sur le nombre courant quand il était vide : effacer
    // réaffichait aussitôt l'ancien chiffre, donc taper « 2 » sur « 4 » donnait
    // « 42 » et jamais « 2 ». Rencontré par Franck le 2026-10-08.
    renderRecipeScreen();
    const champ = screen.getByLabelText('Parts') as HTMLInputElement;
    expect(champ.value).toBe('4');

    fireEvent.change(champ, { target: { value: '' } });
    expect(champ.value).toBe('');

    fireEvent.change(champ, { target: { value: '2' } });
    expect(champ.value).toBe('2');
  });

  // A2 : l'étoile de favori bascule et annonce son état (aria-pressed), sans réalisation requise.
  it('annonce l’état du favori par aria-pressed et bascule au clic', () => {
    renderRecipeScreen({ favorite: true });

    const star = screen.getByRole('button', { name: `Favori : ${recipe.title}` });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.textContent).toBe('★');

    fireEvent.click(star);

    // La recette affichée vient d'une donnée figée par le test (mock de `useRecipeQuery`) :
    // on vérifie donc le geste envoyé au serveur, pas le nouvel état visuel, qui dépend du
    // cache réel de TanStack Query (`patchRecipeInCache`, `lib/queries.ts`) hors de ce test.
    expect(vi.mocked(recipesApi.updateRecipe)).toHaveBeenCalledWith('r1', { favorite: false });
  });

  /**
   * D7 (2026-10-19) : « ne pas afficher la note du foyer (trop de place) ».
   */
  it('n’affiche plus la note du foyer sur la fiche (D7)', () => {
    renderRecipeScreen();

    expect(screen.queryByText('Note du foyer')).toBeNull();
    expect(screen.queryByRole('radio', { name: '4 étoiles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retirer la note' })).toBeNull();
  });

  /**
   * D9 : durée et difficulté deviennent des blocs colorés, sur deux échelles
   * distinctes. La couleur ne porte jamais l'information seule — le texte reste
   * lu, pour le daltonisme comme pour le mode sombre.
   */
  it('colore la difficulté selon son échelle, sans jamais retirer le texte (D9)', () => {
    renderRecipeScreen();
    const lookFacile = screen.getByText('Facile').className;

    cleanup();
    renderRecipeScreen({ difficulty: 'HARD' });

    const difficile = screen.getByText('Difficile');
    expect(difficile.className).not.toBe(lookFacile);
    // Jetons du thème, jamais de couleur en dur : l'application n'a qu'un mode
    // sombre et une pastille codée en dur y a déjà disparu dans son conteneur.
    expect(lookFacile).toMatch(/bg-[a-z-]+ text-[a-z-]+/);
    expect(difficile.className).toMatch(/bg-[a-z-]+ text-[a-z-]+/);
  });

  it('colore la durée sur sa propre échelle, texte compris (D9)', () => {
    renderRecipeScreen();
    const lookCourt = screen.getByText('30 min').className;

    cleanup();
    renderRecipeScreen({ totalMinutes: 180, prepMinutes: 60, cookMinutes: 120 });

    expect(screen.getByText('3 h').className).not.toBe(lookCourt);
  });
});
