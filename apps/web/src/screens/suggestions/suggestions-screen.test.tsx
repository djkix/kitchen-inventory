import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api';
import { SuggestionsErrorState } from './suggestions-screen';

describe('SuggestionsErrorState', () => {
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
