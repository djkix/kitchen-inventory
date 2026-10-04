import { render, screen } from '@testing-library/react';
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
});
