import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api';
import { useSuggestionsQuery } from '../../lib/queries';
import { SuggestionsErrorState, SuggestionsScreen } from './suggestions-screen';

vi.mock('../../lib/queries', () => ({
  useSuggestionsQuery: vi.fn(),
}));

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

    // Utile, pas seulement présent : le titre identifie la suggestion, l'état
    // de couverture dit si elle est cuisinable maintenant avec le stock réel.
    expect(screen.getByRole('button', { name: 'Pâtes à la tomate, Plat, Prête à 100 %' })).toBeTruthy();
  });

  it('filtre la fournée sur le type de plat, et propose une relance quand il ne reste rien', () => {
    // Le filtre est gratuit : il s'applique sur les recettes déjà chargées.
    // La relance, elle, coûte un appel — elle reste donc un geste explicite,
    // jamais déclenchée toute seule (choix de Franck du 2026-10-08).
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

    expect(screen.getByText('Pâtes à la tomate')).toBeTruthy();
    expect(screen.getByText('Salade de tomates')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Entrée' }));
    expect(screen.queryByText('Pâtes à la tomate')).toBeNull();
    expect(screen.getByText('Salade de tomates')).toBeTruthy();

    // Un type absent de la fournée : la liste se vide, et l'écran explique quoi faire.
    fireEvent.click(screen.getByRole('button', { name: 'Dessert' }));
    expect(screen.queryByText('Salade de tomates')).toBeNull();
    expect(screen.getByRole('button', { name: /Chercher des desserts/i })).toBeTruthy();
  });
});
