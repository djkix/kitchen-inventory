import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { RecipeDto, SuggestionDto } from '@kitchen/shared';
import { ApiClientError } from '../../lib/api';
import { SuggestionSheet } from './suggestion-sheet';

const suggestion: SuggestionDto = {
  id: 's1',
  title: 'Tarte à la crème',
  origin: 'française',
  region: 'europeenne',
  totalMinutes: 40,
  prepMinutes: 15, cookMinutes: 25,
  difficulty: 'EASY', dishType: 'MAIN' as const,
  provenance: 'web',
  sourceUrl: 'https://exemple.test/tarte',
  coverage: 0.8,
  group: 'almost',
  missingLabels: ['Farine'],
  ingredients: [
    {
      label: 'Crème', quantity: 200, unit: 'MILLILITER', match: 'probable', productId: 'p1', productName: 'Crème fraîche épaisse 30%',
      state: 'available', productImagePath: null, locationName: null, locationTemperature: null,
    },
    {
      label: 'Œufs', quantity: 3, unit: 'PIECE', match: 'sure', productId: 'p2', productName: 'Œufs',
      state: 'available', productImagePath: null, locationName: null, locationTemperature: null,
    },
    {
      label: 'Farine', quantity: null, unit: null, match: 'absent', productId: null, productName: null,
      state: 'missing', productImagePath: null, locationName: null, locationTemperature: null,
    },
  ],
};

const recipe: RecipeDto = { id: 'r1' } as RecipeDto;

function renderSheet(props: Partial<ComponentProps<typeof SuggestionSheet>> = {}) {
  const client = new QueryClient();
  const onClose = vi.fn();
  const keep = props.keep ?? vi.fn().mockResolvedValue(recipe);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SuggestionSheet suggestion={suggestion} batchId="b1" open onClose={onClose} keep={keep} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Permet de rouvrir le même tiroir (`open: false → true`) sans démonter le
  // composant, exactement comme `suggestions-screen.tsx` le monte une seule
  // fois et fait varier `open`.
  const setOpen = (open: boolean) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionSheet suggestion={suggestion} batchId="b1" open={open} onClose={onClose} keep={keep} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  return { onClose, keep, setOpen };
}

describe('SuggestionSheet', () => {
  it('détaille les ingrédients et leur état', () => {
    renderSheet();
    expect(screen.getByText('Crème')).toBeTruthy();
    expect(screen.getByText('Œufs')).toBeTruthy();
    expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0);
    expect(screen.getByText('Manquant')).toBeTruthy();
  });

  it('signale un rapprochement probable (B11)', () => {
    renderSheet();
    expect(screen.getByText(/«\s*Crème\s*».*→.*«\s*Crème fraîche épaisse 30%\s*»/)).toBeTruthy();
  });

  it('n’affiche pas d’étapes (B7)', () => {
    renderSheet();
    expect(screen.queryByText(/étape/i)).toBeNull();
  });

  it('conserve la recette et annonce l’attente pendant l’extraction', async () => {
    let resolveKeep: (recipe: RecipeDto) => void = () => {};
    const keep = vi.fn().mockImplementation(() => new Promise<RecipeDto>((resolve) => (resolveKeep = resolve)));
    const { onClose } = renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));

    await waitFor(() => expect(screen.getByText(/extraction de la recette en cours/i)).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Conserver' }) as HTMLButtonElement).disabled).toBe(true);

    resolveKeep(recipe);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(keep).toHaveBeenCalledWith({ batchId: 'b1', suggestionId: 's1', clientOpId: expect.any(String) });
  });

  it('affiche le message français de l’API quand la conservation échoue', async () => {
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValue(new ApiClientError(502, 'provider_unavailable', message));
    renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText(/provider_unavailable/)).toBeNull();
  });

  it('ne conserve pas deux fois sur un double appui (même clientOpId, bouton désactivé)', async () => {
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValueOnce(new ApiClientError(502, 'provider_unavailable', message)).mockResolvedValueOnce(recipe);
    renderSheet({ keep });

    const button = () => screen.getByRole('button', { name: 'Conserver' });

    fireEvent.click(button());
    // Le bouton est désactivé pendant l'appel : un second appui pendant ce
    // temps ne déclenche pas d'appel supplémentaire.
    fireEvent.click(button());
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());

    // Nouvel essai après l'échec : même identifiant d'opération, pour que le
    // serveur reconnaisse un rejeu plutôt qu'une nouvelle conservation.
    fireEvent.click(button());
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(2));

    const firstOpId = keep.mock.calls[0]![0].clientOpId;
    const secondOpId = keep.mock.calls[1]![0].clientOpId;
    expect(secondOpId).toBe(firstOpId);
  });

  it('porte le même clientOpId après une fermeture et une réouverture sur la même suggestion (round 1)', async () => {
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValueOnce(new ApiClientError(502, 'provider_unavailable', message)).mockResolvedValueOnce(recipe);
    const { setOpen } = renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());

    // Parcours de récupération naturel après un échec : fermer, puis rouvrir
    // la même suggestion pour réessayer.
    setOpen(false);
    setOpen(true);

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(2));

    const firstOpId = keep.mock.calls[0]![0].clientOpId;
    const secondOpId = keep.mock.calls[1]![0].clientOpId;
    expect(secondOpId).toBe(firstOpId);
  });
});
