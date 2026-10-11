import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api';
import { useSuggestionsQuery } from '../../lib/queries';
import { resetDishTypeAnswerForTests } from './dish-type-question';
import { SuggestionsErrorState, SuggestionsScreen } from './suggestions-screen';

vi.mock('../../lib/queries', () => ({
  useSuggestionsQuery: vi.fn(),
}));

beforeEach(() => {
  // La réponse à la question de type de plat vit dans une variable de module
  // (tâche 2) : sans reset, un scénario hériterait de la réponse du précédent.
  resetDishTypeAnswerForTests();
});

describe('SuggestionsErrorState', () => {
  it('annonce le stock insuffisant sur son code, pas sur le statut 409', () => {
    const error = new ApiClientError(409, 'insufficient_stock', 'Le stock ne contient pas assez d’ingrédients pour composer une recherche de recettes');
    render(
      <MemoryRouter>
        <SuggestionsErrorState error={error} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Stock insuffisant pour suggérer/i)).toBeTruthy();
  });

  it('ne prend pas un conflit quelconque pour un stock insuffisant', () => {
    const error = new ApiClientError(409, 'conflict', 'Version obsolète');
    render(
      <MemoryRouter>
        <SuggestionsErrorState error={error} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Stock insuffisant pour suggérer/i)).toBeNull();
    expect(screen.getByText(/La recherche de recettes a échoué/i)).toBeTruthy();
  });

  it('nomme la panne du fournisseur plutôt qu’un message générique', () => {
    // Un modèle inexistant (404) et un quota épuisé (429) produisent tous deux
    // `provider_unavailable` : sans le message du serveur, l'écran ne permet
    // pas de les distinguer, et la panne reste invisible depuis le téléphone.
    const error = new ApiClientError(502, 'provider_unavailable', 'Fournisseur de suggestions Gemini en erreur (404)');
    render(
      <MemoryRouter>
        <SuggestionsErrorState error={error} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/La recherche de recettes a échoué/i)).toBeTruthy();
    expect(screen.getByText(/en erreur \(404\)/i)).toBeTruthy();
  });

  it('relaie le message du serveur quand le fournisseur est désactivé, sans en inventer un autre (round 1)', () => {
    const serverMessage = 'Fournisseur de suggestions désactivé : renseignez VISION_PROVIDER et VISION_API_KEY';
    const error = new ApiClientError(422, 'provider_disabled', serverMessage);
    render(
      <MemoryRouter>
        <SuggestionsErrorState error={error} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    // Le message affiché est celui du serveur, pas une description réécrite à la main.
    expect(screen.getByText(serverMessage)).toBeTruthy();
    // Jamais vers « Mes recettes », qui ne permet pas de configurer un fournisseur.
    expect(screen.queryByText(/Mes recettes/i)).toBeNull();
    expect(screen.getByRole('link', { name: /réglages/i }).getAttribute('href')).toBe('/reglages');
  });

  it('n’affiche jamais la promesse d’une fournée pour un quota bloquant sans repli', () => {
    const serverMessage = 'Quota journalier de suggestions atteint (20 par jour) ; réessayez demain, ou augmentez-le dans la configuration du serveur.';
    const error = new ApiClientError(429, 'rate_limited', serverMessage);
    render(
      <MemoryRouter>
        <SuggestionsErrorState error={error} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(serverMessage)).toBeTruthy();
    expect(screen.queryByText(/fournée connue est affichée/i)).toBeNull();
  });
});

describe('SuggestionsScreen', () => {
  it('donne accès à Mes recettes depuis Suggestions', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: true,
      isError: false,
      isFetching: true,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Mes recettes/i }).getAttribute('href')).toBe('/recettes/bibliotheque');
  });

  /**
   * EF-23 : même défaut que `RecipeCard` — le bouton qui ouvre le tiroir de
   * conservation enveloppe une `SuggestionCard` (un `<article>`), dont le
   * contenu ne remonte pas dans le nom calculé d'un bouton ancêtre
   * (Chromium). `getByRole('button', { name })` reproduit la requête d'un
   * lecteur d'écran ou d'un test de bout en bout ; un test qui vérifierait
   * seulement la présence du bouton n'aurait pas détecté un nom vide.
   */
  it('nomme chaque suggestion pour une requête par rôle et nom (EF-23)', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      data: {
        batchId: 'batch-1',
        notice: null,
        items: [
          {
            id: 's1',
            title: 'Pâtes à la tomate',
            origin: 'italienne',
            region: 'mediterraneenne',
            totalMinutes: 25,
            difficulty: 'EASY', dishType: 'MAIN' as const,
            provenance: 'web',
            sourceUrl: 'https://exemple.test/pates',
            coverage: 1,
            group: 'ready',
            missingLabels: [],
            ingredients: [],
          },
        ],
      },
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // La question bloquante (A2) précède la liste : y répondre est nécessaire
    // pour atteindre la fournée, même dans ce scénario qui ne teste pas la
    // question elle-même.
    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));

    // Utile, pas seulement présent : le titre identifie la suggestion, l'état
    // de couverture dit si elle est cuisinable maintenant avec le stock réel.
    expect(screen.getByRole('button', { name: 'Pâtes à la tomate, Plat, Prête à 100 %' })).toBeTruthy();
  });

  it('filtre la fournée sur le type de plat, et propose une relance quand il ne reste rien', () => {
    // Le filtre est gratuit : il s'applique sur les recettes déjà chargées.
    // La relance, elle, coûte un appel — elle reste donc un geste explicite,
    // jamais déclenchée toute seule (choix de djkix du 2026-10-08).
    const base = {
      origin: 'italienne',
      region: 'mediterraneenne',
      totalMinutes: 25,
      difficulty: 'EASY',
      provenance: 'web',
      sourceUrl: 'https://exemple.test/x',
      coverage: 1,
      group: 'ready',
      missingLabels: [],
      ingredients: [],
    };
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      data: {
        batchId: 'batch-1',
        notice: null,
        items: [
          { ...base, id: 's1', title: 'Pâtes à la tomate', dishType: 'MAIN' },
          { ...base, id: 's2', title: 'Salade de tomates', dishType: 'STARTER' },
        ],
      },
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Répond d'abord à la question bloquante (A2) avec un type différent de
    // ceux utilisés pour filtrer ensuite, pour ne pas ambiguïser les clics.
    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));

    expect(screen.getByText('Pâtes à la tomate')).toBeTruthy();
    expect(screen.getByText('Salade de tomates')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Type de plat' }), { target: { value: 'STARTER' } });
    expect(screen.queryByText('Pâtes à la tomate')).toBeNull();
    expect(screen.getByText('Salade de tomates')).toBeTruthy();

    // Un type absent de la fournée : la liste se vide, et l'écran explique quoi faire.
    fireEvent.change(screen.getByRole('combobox', { name: 'Type de plat' }), { target: { value: 'DESSERT' } });
    expect(screen.queryByText('Salade de tomates')).toBeNull();
    expect(screen.getByRole('button', { name: /Chercher des desserts/i })).toBeTruthy();
  });

  /** A2 : la question bloque tout le reste de l'écran tant qu'elle n'a pas de réponse. */
  it('pose la question de type de plat et n’affiche ni liste ni barre de filtres avant d’y répondre', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: true,
      isError: false,
      isFetching: true,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    // Les sept types de la taxonomie, nommés par la question.
    for (const label of ['Entrée', 'Plat', 'Dessert', 'Accompagnement', 'Apéritif', 'Petit-déjeuner', 'Boisson']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    // Ni squelette d'attente, ni barre de filtres (région/durée/difficulté) tant que le type n'est pas choisi.
    expect(screen.queryByText(/Recherche de recettes en cours/i)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Cuisine' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Durée' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Facilité' })).toBeNull();

    // `useSuggestionsQuery` n'a encore reçu aucune orientation de type de plat.
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({});
  });

  /** A3 : la première réponse part dans la requête initiale. */
  it('envoie le type choisi dans la requête initiale', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: true,
      isError: false,
      isFetching: true,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dessert' }));

    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'DESSERT' });
    // La question a disparu, la barre de filtres (désormais utile) est affichée.
    expect(screen.queryByRole('heading', { name: /Que cherchez-vous/i })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Cuisine' })).toBeTruthy();
  });

  /** Piège signalé par la tâche : un rafraîchissement de la fournée ne doit pas reposer la question. */
  it('ne repose pas la question quand la fournée se rafraîchit', () => {
    const base = {
      origin: 'italienne', region: 'mediterraneenne', totalMinutes: 25, difficulty: 'EASY',
      provenance: 'web', sourceUrl: 'https://exemple.test/x', coverage: 1, group: 'ready', missingLabels: [], ingredients: [],
    };
    const batch = {
      batchId: 'batch-1',
      notice: null,
      items: [{ ...base, id: 's1', title: 'Pâtes à la tomate', dishType: 'MAIN' }],
    };

    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      data: batch,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    const client = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
    expect(screen.getByText('Pâtes à la tomate')).toBeTruthy();

    // La fournée se rafraîchit (`isFetching` repasse à vrai, les données restent) : la question ne doit pas revenir.
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: true,
      data: batch,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('heading', { name: /Que cherchez-vous/i })).toBeNull();
    expect(screen.getByText('Pâtes à la tomate')).toBeTruthy();
  });

  /** A5 : un moyen explicite de revenir à la question existe. */
  it('permet de revenir à la question pour repartir d’un autre type', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: true,
      isError: false,
      isFetching: true,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
    expect(screen.queryByRole('heading', { name: /Que cherchez-vous/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Relancer une recherche avec un autre type de plat/i }));

    expect(screen.getByRole('heading', { name: /Que cherchez-vous/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dessert' })).toBeTruthy();
  });

  /** Piège signalé par la tâche : la réponse ne doit pas se perdre au retour depuis une fiche de recette. */
  it('ne reperd pas la réponse quand l’écran se démonte puis se remonte (retour depuis une fiche de recette)', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: true,
      isError: false,
      isFetching: true,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    const { unmount } = render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dessert' }));
    expect(screen.queryByRole('heading', { name: /Que cherchez-vous/i })).toBeNull();

    // `/recettes` et `/recettes/:id` sont deux routes distinctes (`app.tsx`) :
    // visiter la fiche d'une recette conservée démonte cet écran.
    unmount();

    render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    // La question ne revient pas : la réponse a survécu au remontage.
    expect(screen.queryByRole('heading', { name: /Que cherchez-vous/i })).toBeNull();
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'DESSERT' });
  });
});
