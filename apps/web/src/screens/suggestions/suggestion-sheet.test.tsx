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
  // Jamais d'étapes pour une suggestion `web` : la page n'est lue qu'à la
  // conservation (B6) — voir `suggestions.service.ts#toSuggestionDtos`.
  steps: [],
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

/** Composition par le modèle (B6) : ses étapes sont déjà dans la fournée, affichables sans attendre la conservation. */
const aiSuggestion: SuggestionDto = {
  ...suggestion,
  id: 's2',
  title: 'Gratin improvisé',
  provenance: 'ai',
  sourceUrl: null,
  steps: ['Préchauffer le four à 200 °C.', 'Mélanger les ingrédients et enfourner 25 minutes.'],
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

/** Déplie la fiche : seul geste qui fait apparaître « Conserver » (E2). */
function expand() {
  fireEvent.click(screen.getByRole('button', { name: /Plus d’informations/i }));
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

  it('intitule le bouton principal « Plus d’informations », sans « Conserver » tant qu’on ne l’a pas ouvert (E2)', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /Plus d’informations/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Conserver$/ })).toBeNull();
    // Avant dépliage, rien ne mentionne non plus les étapes — ni vraies ni
    // notice d'indisponibilité : ce contenu n'apparaît qu'après le geste de
    // consultation, pas avant.
    expect(screen.queryByText(/étape/i)).toBeNull();
  });

  it('propose la conservation une fois les informations affichées', () => {
    renderSheet();
    expand();
    expect(screen.getByRole('button', { name: 'Conserver' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Plus d’informations/i })).toBeNull();
  });

  it('affiche les étapes d’une composition de l’IA une fois dépliée, déjà dans la fournée', () => {
    renderSheet({ suggestion: aiSuggestion });
    expand();
    expect(screen.getByText('Préchauffer le four à 200 °C.')).toBeTruthy();
    expect(screen.getByText('Mélanger les ingrédients et enfourner 25 minutes.')).toBeTruthy();
  });

  it('n’invente jamais les étapes d’une recette web et annonce qu’elles viendront avec la conservation (B7)', () => {
    renderSheet();
    expand();
    // Pas de fausses étapes : seule l'annonce honnête de leur indisponibilité
    // avant la conservation (la page n'est lue qu'à ce moment-là, B6).
    expect(screen.getByText(/détail des étapes.*viendra avec la conservation/i)).toBeTruthy();
  });

  it('conserve la recette et annonce l’attente pendant l’extraction', async () => {
    let resolveKeep: (recipe: RecipeDto) => void = () => {};
    const keep = vi.fn().mockImplementation(() => new Promise<RecipeDto>((resolve) => (resolveKeep = resolve)));
    const { onClose } = renderSheet({ keep });
    expand();

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
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText(/provider_unavailable/)).toBeNull();
  });

  it('ne conserve pas deux fois sur un double appui (même clientOpId, bouton désactivé)', async () => {
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValueOnce(new ApiClientError(502, 'provider_unavailable', message)).mockResolvedValueOnce(recipe);
    renderSheet({ keep });
    expand();

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
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());

    // Parcours de récupération naturel après un échec : fermer, puis rouvrir
    // la même suggestion pour réessayer. La fiche se replie à la réouverture
    // (nouvel effet de bord assumé, tâche 6) : il faut rouvrir le détail
    // avant de retrouver « Conserver ».
    setOpen(false);
    setOpen(true);
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'Conserver' }));
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(2));

    const firstOpId = keep.mock.calls[0]![0].clientOpId;
    const secondOpId = keep.mock.calls[1]![0].clientOpId;
    expect(secondOpId).toBe(firstOpId);
  });
});
