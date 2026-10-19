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
  verified: true,
  coverage: 0.8,
  group: 'almost',
  missingLabels: ['Farine'],
  // Jamais d'étapes pour une suggestion `web` : la page n'est lue qu'à la
  // conservation (B6) — voir `suggestions.service.ts#toSuggestionDtos`.
  steps: [],
  ingredients: [
    {
      label: 'Crème', quantity: 200, unit: 'MILLILITER', match: 'probable', productId: 'p1', productName: 'Crème fraîche épaisse 30%',
      state: 'available', declared: false, productImagePath: null, locationName: null, locationTemperature: null,
    },
    {
      label: 'Œufs', quantity: 3, unit: 'PIECE', match: 'sure', productId: 'p2', productName: 'Œufs',
      state: 'available', declared: false, productImagePath: null, locationName: null, locationTemperature: null,
    },
    {
      label: 'Farine', quantity: null, unit: null, match: 'absent', productId: null, productName: null,
      state: 'missing', declared: false, productImagePath: null, locationName: null, locationTemperature: null,
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
        <SuggestionSheet suggestion={suggestion} open onClose={onClose} keep={keep} {...props} />
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
          <SuggestionSheet suggestion={suggestion} open={open} onClose={onClose} keep={keep} {...props} />
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

  /**
   * Le tiroir porte deux boutons (demande de djkix du 2026-10-19, second
   * tour) : l'action à gauche, l'abandon à droite. « Plus d'informations »
   * promettait une lecture là où le geste enregistre définitivement la
   * recette, et « Ajouter à mes recettes » ne disait pas où l'on atterrit —
   * c'est la fiche, avec son nombre de parts.
   */
  it('intitule l’action principale « Je fais cette recette », sans ancien libellé', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /Je fais cette recette/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Conserver$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Plus d’informations/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ajouter à mes recettes/i })).toBeNull();
  });

  // « Annuler » ferme et rien d'autre : aucun enregistrement, aucun appel au
  // serveur — c'est le geste d'abandon, pas une seconde façon de conserver.
  it('ferme le tiroir sur « Annuler », sans rien enregistrer', () => {
    const keep = vi.fn().mockResolvedValue(recipe);
    const { onClose } = renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(onClose).toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
  });

  // Un enregistrement en cours ne s'abandonne pas en route : le tiroir est
  // verrouillé (`locked`), « Annuler » l'est aussi.
  it('interdit « Annuler » pendant un enregistrement', async () => {
    let release: ((value: RecipeDto) => void) | undefined;
    const keep = vi.fn().mockImplementation(() => new Promise<RecipeDto>((resolve) => (release = resolve)));
    const { onClose } = renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));

    await waitFor(() => expect((screen.getByRole('button', { name: 'Annuler' }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).not.toHaveBeenCalled();

    release?.(recipe);
  });

  // L'action principale vient en premier dans le document : à gauche à l'œil,
  // et première au clavier comme au lecteur d'écran.
  it('place l’action principale avant l’abandon', () => {
    renderSheet();
    const noms = screen
      .getAllByRole('button')
      .map((bouton) => bouton.textContent?.trim())
      .filter((nom) => nom === 'Annuler' || nom === 'Je fais cette recette');
    expect(noms).toEqual(['Je fais cette recette', 'Annuler']);
  });

  it('affiche les étapes d’une composition de l’IA d’emblée, sans dépliage : elles sont déjà dans la fournée', () => {
    renderSheet({ suggestion: aiSuggestion });
    expect(screen.getByText('Préchauffer le four à 200 °C.')).toBeTruthy();
    expect(screen.getByText('Mélanger les ingrédients et enfourner 25 minutes.')).toBeTruthy();
  });

  it('n’affiche aucune section Étapes pour une composition de l’IA qui n’en porte pas', () => {
    renderSheet({ suggestion: { ...aiSuggestion, steps: [] } });
    expect(screen.queryByText('Étapes')).toBeNull();
  });

  it('n’invente jamais les étapes d’une recette web et annonce qu’elles viendront avec la conservation (B7)', () => {
    renderSheet();
    // Pas de fausses étapes : seule l'annonce honnête de leur indisponibilité
    // avant la conservation (la recette n'est réécrite qu'à ce moment-là, D10), visible
    // d'emblée, sans aucun dépliage.
    expect(screen.getByText(/étapes arriveront à la conservation/i)).toBeTruthy();
  });

  it('conserve la recette et annonce l’attente pendant la réécriture', async () => {
    let resolveKeep: (recipe: RecipeDto) => void = () => {};
    const keep = vi.fn().mockImplementation(() => new Promise<RecipeDto>((resolve) => (resolveKeep = resolve)));
    const { onClose } = renderSheet({ keep });

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));

    await waitFor(() => expect(screen.getByText(/réécriture de la recette en cours/i)).toBeTruthy());
    expect((screen.getByRole('button', { name: /Je fais cette recette/i }) as HTMLButtonElement).disabled).toBe(true);

    resolveKeep(recipe);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(keep).toHaveBeenCalledWith({ suggestionId: 's1', clientOpId: expect.any(String) });
  });

  it('n’annonce aucune attente de plusieurs secondes pour une composition de l’IA', () => {
    // Une composition est déjà au format de l'application : rien n'est
    // réécrit, aucun appel ne part, la réponse est immédiate. Annoncer
    // « plusieurs secondes » y était simplement faux (revue finale du
    // 2026-10-15).
    const keep = vi.fn().mockImplementation(() => new Promise<RecipeDto>(() => {}));
    renderSheet({ suggestion: aiSuggestion, keep });

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));

    expect(screen.queryByText(/plusieurs secondes/i)).toBeNull();
    expect(screen.getByText(/enregistrement de la recette/i)).toBeTruthy();
  });

  it('affiche le message français de l’API quand la conservation échoue', async () => {
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValue(new ApiClientError(502, 'provider_unavailable', message));
    renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));

    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText(/provider_unavailable/)).toBeNull();
  });

  it('ne conserve pas deux fois sur un double appui (même clientOpId, bouton désactivé)', async () => {
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValueOnce(new ApiClientError(502, 'provider_unavailable', message)).mockResolvedValueOnce(recipe);
    renderSheet({ keep });

    const button = () => screen.getByRole('button', { name: /Je fais cette recette/i });

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

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());

    // Parcours de récupération naturel après un échec : fermer, puis rouvrir
    // la même suggestion pour réessayer.
    setOpen(false);
    setOpen(true);

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(2));

    const firstOpId = keep.mock.calls[0]![0].clientOpId;
    const secondOpId = keep.mock.calls[1]![0].clientOpId;
    expect(secondOpId).toBe(firstOpId);
  });

  it('porte le même clientOpId d’une visite à l’autre (réservoir, 2026-10-15)', async () => {
    // La recette servie du réservoir ne change pas d'une visite à l'autre.
    // Tant que le `clientOpId` dérivait de la fournée, deux visites
    // successives portaient deux identifiants : l'idempotence de la
    // conservation, dont c'est le seul garde-fou côté serveur, ne tenait plus.
    const message = 'La page de la recette n’a pas répondu à temps';
    const keep = vi.fn().mockRejectedValueOnce(new ApiClientError(502, 'provider_unavailable', message)).mockResolvedValueOnce(recipe);
    const { setOpen } = renderSheet({ keep });

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());

    // Tiroir refermé puis rouvert après une nouvelle recherche, même suggestion.
    setOpen(false);
    setOpen(true);

    fireEvent.click(screen.getByRole('button', { name: /Je fais cette recette/i }));
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(2));

    expect(keep.mock.calls[1]![0].clientOpId).toBe(keep.mock.calls[0]![0].clientOpId);
    // Dérivé de la seule identité de la suggestion, et de rien d'autre.
    expect(keep.mock.calls[0]![0].clientOpId).toBe(`keep:${suggestion.id}`);
  });
});

/**
 * D5, tour de correction 1 (2026-10-19) : retirer l'ingrédient dicté des
 * manquants ne suffisait pas — le tiroir affichait toujours « Merguez,
 * Manquant » juste après que djkix ait tapé « merguez », et c'est là qu'il
 * regarde.
 */
describe('SuggestionSheet, ingrédient déclaré', () => {
  it('annonce « Déclaré » au lieu de « Manquant » pour un ingrédient que l’on vient de taper', () => {
    const declared: SuggestionDto = {
      ...suggestion,
      missingLabels: [],
      ingredients: [
        {
          label: 'Merguez', quantity: 4, unit: 'PIECE', match: 'absent', productId: null, productName: null,
          // L'état venu du stock reste `missing` : la règle de couverture
          // partagée n'est pas touchée, et le taux affiché reste prudent.
          state: 'missing', declared: true, productImagePath: null, locationName: null, locationTemperature: null,
        },
      ],
    };
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionSheet suggestion={declared} open onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Déclaré')).toBeTruthy();
    expect(screen.queryByText('Manquant')).toBeNull();
  });
});
