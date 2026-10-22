import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSuggestionsQuery } from './queries';
import { suggestionsApi } from './suggestions-api';

vi.mock('./suggestions-api', () => ({ suggestionsApi: { list: vi.fn() } }));

const list = vi.mocked(suggestionsApi.list);

// Un seul client pour toute la durée d'un cas : construit dans le corps du
// `wrapper`, il serait recréé à chaque rendu, le cache repartirait de zéro et
// ces cas ne prouveraient plus rien.
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  // Aucun réglage par défaut imposé ici : ce sont justement les options posées
  // par `useSuggestionsQuery` que ces cas vérifient.
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient();
  list.mockReset();
  list.mockResolvedValue({ fromCache: true, items: [], notice: null, poolCount: 0, poolTotal: 0 });
});

afterEach(() => {
  // Rendu au navigateur : un test qui laisse la fenêtre « hors focus » fausse les suivants.
  focusManager.setFocused(undefined);
});

/**
 * `POST /suggestions` est la seule route du module qui coûte de l'argent : un
 * appel part vers Gemini, entame le quota journalier et le plafond mensuel
 * partagé avec le scan photo. Ces deux cas tiennent la propriété qui compte —
 * **aucun appel sans geste, autant d'appels que de gestes** — et ils mordent :
 * sans `refetchOnWindowFocus: false` et `staleTime`, le second échoue ; sans le
 * compteur dans la clé de requête, le premier échoue au deuxième appui.
 */
describe('useSuggestionsQuery (EF-25)', () => {
  it('relance autant de fois qu’on le demande, et n’envoie `refresh` que pour la recherche demandée', async () => {
    const { rerender } = renderHook(({ relaunch }) => useSuggestionsQuery({ dishType: 'MAIN' }, { relaunch }), {
      initialProps: { relaunch: 0 },
      wrapper,
    });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(list.mock.calls[0]?.[0]).toEqual({ dishType: 'MAIN', refresh: undefined });

    // Premier appui sur « Chercher de nouvelles recettes ».
    rerender({ relaunch: 1 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls[1]?.[0]).toEqual({ dishType: 'MAIN', refresh: true });

    // Second appui : c'est dans l'état vide, quand la première relance n'a rien
    // rendu, qu'il sera donné. Avec un `refresh: true` posé dans l'orientation,
    // la clé de requête ne changeait pas et le bouton restait muet.
    rerender({ relaunch: 2 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list.mock.calls[2]?.[0]).toEqual({ dishType: 'MAIN', refresh: true });
  });

  it('relance encore après un compteur redescendu à zéro (démontage de l’écran, changement d’orientation)', async () => {
    // Le défaut qu'il attrape (revue finale du 2026-10-15) : `relaunch` est un
    // état local de l'écran Suggestions, remis à zéro au changement
    // d'orientation et reparti de zéro au remontage — aller voir « Mes
    // recettes » puis revenir. Le cache de requêtes, lui, survit. Un compteur
    // qui repasse par 1 reformait donc une clé déjà en cache et, sous
    // `staleTime: Infinity`, n'envoyait rien : pas d'appel, pas même un
    // indicateur de chargement, sur le seul bouton qui sorte du verrou de 24 h.
    const { rerender } = renderHook(({ relaunch }) => useSuggestionsQuery({ dishType: 'MAIN' }, { relaunch }), {
      initialProps: { relaunch: 0 },
      wrapper,
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    rerender({ relaunch: 1 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    // Le compteur redescend…
    rerender({ relaunch: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    // …sans rien coûter : revenir sur l'écran n'est pas une relance.
    expect(list).toHaveBeenCalledTimes(2);

    // …et le même appui, de nouveau, doit repartir.
    rerender({ relaunch: 1 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list.mock.calls[2]?.[0]).toEqual({ dishType: 'MAIN', refresh: true });
  });

  it('ne rappelle jamais le modèle sur un simple retour sur l’onglet, même après une relance', async () => {
    const { rerender } = renderHook(({ relaunch }) => useSuggestionsQuery({ dishType: 'MAIN' }, { relaunch }), {
      initialProps: { relaunch: 0 },
      wrapper,
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    rerender({ relaunch: 1 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    // Quitter l'application puis y revenir : le geste le plus banal sur un
    // téléphone. TanStack Query rejoue par défaut toute requête périmée à ce
    // moment-là, et sans `staleTime` elle l'est immédiatement.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(list).toHaveBeenCalledTimes(2);
  });
});
