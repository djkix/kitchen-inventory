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

/**
 * Revue finale du 2026-10-11 : fonction pure extraite pour tester
 * directement le chemin « revenir à la question puis rechoisir le même
 * type » signalé comme risqué, sans dépendre d'un bouton de retour à la
 * question qui n'existe plus dans l'écran (voir le commentaire de la
 * fonction).
 */

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
        notice: null,
        poolCount: 1,
        poolTotal: 1,
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

  /**
   * Revue finale du 2026-10-11 : le sélecteur « Type de plat » relance
   * désormais une vraie recherche, comme cuisine/durée/facilité, au lieu de
   * filtrer localement une fournée qui ne peut plus mélanger les types (la
   * question bloquante envoie le type au modèle, qui ne propose plus que ce
   * type-là — D4 est devenue sans objet). L'ancien test fabriquait une
   * fournée mixte MAIN + STARTER que la production ne peut plus produire :
   * il ne prouvait donc plus rien et est remplacé par celui-ci, qui vérifie
   * la relance plutôt qu'un filtrage impossible à observer en vrai.
   */
  it('changer le type de plat dans la barre relance une recherche, comme les trois autres dimensions', () => {
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
        notice: null,
        poolCount: 1,
        poolTotal: 1,
        items: [{ ...base, id: 's1', title: 'Pâtes à la tomate', dishType: 'MAIN' }],
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

    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'MAIN' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Type de plat' }), { target: { value: 'DESSERT' } });

    // Une vraie relance, pas un filtre : la nouvelle orientation part dans la requête.
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'DESSERT' });
    // Les contrôles propres à l'ancien filtre local ont disparu avec lui.
    expect(screen.queryByText(/Aucun .* dans cette fournée/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Chercher des/i })).toBeNull();
  });

  /**
   * Revue de la tâche 4, tour 2 (2026-10-15) : depuis D11, une orientation déjà
   * cherchée ne repart pas d'elle-même avant 24 heures, et `refresh: true` en
   * est la seule sortie — or plus aucun appelant ne le posait depuis la
   * disparition du bouton de relance. Le recours existait sans être
   * atteignable : l'écran vide était un cul-de-sac.
   */
  it('offre une relance explicite depuis l’état vide', () => {
    const batch = (items: unknown[]) => ({
      isPending: false,
      isError: false,
      isFetching: false,
      data: { notice: null, items, poolCount: items.length, poolTotal: items.length },
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSuggestionsQuery>);

    vi.mocked(useSuggestionsQuery).mockReturnValue(batch([]));

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SuggestionsScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));

    fireEvent.click(screen.getByRole('button', { name: 'Chercher de nouvelles recettes' }));
    // La relance passe par un compteur hors de l'orientation (tour 3) : celle-ci
    // ne porte jamais `refresh`, qui y resterait collé jusqu'au geste suivant.
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'MAIN' });
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(1);

    // Chaque appui compte : le second ne doit pas tomber dans le vide, c'est
    // justement dans l'état vide qu'il sera donné (revue, tour 3).
    fireEvent.click(screen.getByRole('button', { name: 'Chercher de nouvelles recettes' }));
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(2);

    // Le texte d'état vide n'invite plus à attendre un changement de stock :
    // depuis D11 la recherche n'en dépend plus (revue, tour 2).
    expect(screen.queryByText(/le stock aura peut-être changé/i)).toBeNull();
  });

  /**
   * djkix, 2026-10-19 : « j'ai l'impression qu'il n'y a que 12 recettes ».
   * C'était exact. Le bouton de relance n'existait que dans l'état vide, donc
   * dès que le réservoir rendait de quoi remplir une page pour l'orientation,
   * plus aucun appel ne partait et rien ne permettait d'en demander d'autres.
   * Les deux nombres rendent la situation lisible, le bouton la débloque.
   */
  it('annonce la taille du réservoir et laisse relancer même avec des résultats', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      data: {
        notice: null,
        poolCount: 12,
        poolTotal: 37,
        items: [
          {
            id: 's1',
            title: 'Pâtes à la tomate',
            dishType: 'MAIN',
            origin: 'italienne',
            region: 'mediterraneenne',
            totalMinutes: 25,
            difficulty: 'EASY',
            provenance: 'web',
            verified: true,
            sourceUrl: 'https://exemple.test/x',
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
    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));

    // Les deux nombres sont lus sur le pied de liste lui-même : depuis le
    // 2026-10-19 le bouton « Charger plus » les reprend, un `getByText(/12/)`
    // nu ne désignerait donc plus rien d'unique.
    const footer = screen.getByText(/pour cette orientation/);
    expect(footer.textContent).toContain('12');
    expect(footer.textContent).toContain('37');
    fireEvent.click(screen.getByRole('button', { name: 'Chercher de nouvelles recettes' }));
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(1);
  });

  /**
   * Une relance ne doit valoir que pour LA recherche qu'elle déclenche : collée
   * à l'orientation, elle contournerait le verrou de 24 heures à chaque geste
   * suivant — et, le `staleTime` aidant, à chaque retour sur l'onglet. Le
   * compteur vit donc hors de l'orientation et repart de zéro dès qu'un filtre
   * bouge (revue, tour 3).
   */
  it('ne laisse pas la relance collée à l’orientation', () => {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      data: { notice: null, items: [], poolCount: 0, poolTotal: 0 },
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
    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chercher de nouvelles recettes' }));
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: 'asiatique' } });

    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'MAIN', region: 'asiatique', refresh: undefined });
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(0);
  });

  /**
   * djkix, 2026-10-19 : « je veux les conserver afin de les consulter
   * ultérieurement. Plus je fais de requêtes pour les recettes, plus
   * j'emmagasine de recettes dans l'application. » Le réservoir les gardait
   * déjà ; l'écran en cachait définitivement tout ce qui dépassait la page.
   * Même geste et même formulation que « Mes recettes ».
   */
  describe('parcourir le réservoir (2026-10-19)', () => {
    function pooled(count: number, poolCount: number) {
      return {
        isPending: false,
        isError: false,
        isFetching: false,
        data: {
          notice: null,
          poolCount,
          poolTotal: poolCount,
          items: Array.from({ length: count }, (_, index) => ({
            id: `s${index}`,
            title: `Recette ${index}`,
            dishType: 'MAIN',
            origin: 'italienne',
            region: 'mediterraneenne',
            totalMinutes: 25,
            difficulty: 'EASY',
            provenance: 'web',
            verified: true,
            sourceUrl: 'https://exemple.test/x',
            coverage: 1,
            group: 'ready',
            missingLabels: [],
            ingredients: [],
          })),
        },
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useSuggestionsQuery>;
    }

    function mount() {
      const client = new QueryClient();
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SuggestionsScreen />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
    }

    it('demande une page plus grande sans rien repayer au modèle', () => {
      vi.mocked(useSuggestionsQuery).mockReturnValue(pooled(12, 37));
      mount();

      // Un appui au bouton de relance d'abord : charger plus ne doit pas le
      // rejouer, sans quoi chaque page coûterait un appel au modèle.
      fireEvent.click(screen.getByRole('button', { name: 'Chercher de nouvelles recettes' }));
      expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(1);

      fireEvent.click(screen.getByRole('button', { name: 'Charger plus (12 sur 37)' }));

      expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.limit).toBe(24);
      expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(0);
    });

    it('ne propose pas de charger plus quand tout le réservoir est affiché', () => {
      vi.mocked(useSuggestionsQuery).mockReturnValue(pooled(5, 5));
      mount();

      expect(screen.queryByRole('button', { name: /Charger plus/ })).toBeNull();
    });

    it('revient à la première page quand l’orientation change', () => {
      vi.mocked(useSuggestionsQuery).mockReturnValue(pooled(12, 37));
      mount();

      fireEvent.click(screen.getByRole('button', { name: 'Charger plus (12 sur 37)' }));
      expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.limit).toBe(24);

      fireEvent.change(screen.getByRole('combobox', { name: 'Cuisine' }), { target: { value: 'asiatique' } });

      expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.limit).toBe(12);
    });
  });

  /** Revue finale du 2026-10-11 : le type de plat compte comme orientation active, la barre ne doit pas dire « Aucune orientation ». */
  it('affiche le type de plat répondu comme une orientation active dans la barre', () => {
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

    expect(screen.getByText('1 orientation')).toBeTruthy();
    expect(screen.queryByText('Aucune orientation')).toBeNull();
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

  /**
   * Revue finale du 2026-10-11 : le bouton dédié « Relancer une recherche
   * avec un autre type de plat » a été retiré — il faisait doublon avec le
   * sélecteur de la barre, qui relance désormais lui-même (voir le test
   * ci-dessus). Changer de type ne passe donc plus par un aller-retour à la
   * question : le sélecteur en est le seul contrôle.
   */
  it('ne propose plus de bouton séparé pour relancer avec un autre type', () => {
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

    expect(screen.queryByRole('button', { name: /Relancer une recherche avec un autre type de plat/i })).toBeNull();
  });

  /**
   * Revue finale du 2026-10-11, piège signalé par djkix : sans le bouton
   * dédié, le seul chemin restant vers la question bloquante est un
   * rechargement complet de la page — qui réinitialise à la fois la réponse
   * ET l'orientation déjà en mémoire. Répondre ensuite le MÊME type qu'avant
   * le rechargement ne doit pas laisser un écran inchangé sans explication :
   * comme tout repart de zéro (orientation vide, aucune donnée en cache),
   * une vraie recherche part bien, avec son indicateur d'attente.
   */
  it('répondre à nouveau le même type après un rechargement complet relance bien une recherche', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'MAIN' });

    // Rechargement complet simulé : la réponse mémorisée en variable de
    // module s'efface (décision D2), exactement comme un vrai rechargement
    // de page l'aurait fait.
    unmount();
    resetDishTypeAnswerForTests();

    render(
      <MemoryRouter>
        <SuggestionsScreen />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));

    // Une recherche repart bien, avec une orientation fraîche — pas un écran
    // figé sur la fournée précédente sans explication.
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'MAIN' });
    expect(screen.getByText(/Recherche de recettes en cours/i)).toBeTruthy();
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

/**
 * Suggestions à partir d'ingrédients dictés (spécification du 2026-10-19,
 * D6, D7) : « j'ai des pommes de terre et un reste de merguez ». Un champ de
 * texte libre au-dessus des filtres — un reste n'est pas en stock, il ne se
 * choisit pas dans l'inventaire.
 */
describe('SuggestionsScreen, ingrédients dictés (2026-10-19)', () => {
  function mountWith(items: unknown[], poolCount = items.length) {
    vi.mocked(useSuggestionsQuery).mockReturnValue({
      isPending: false,
      isError: false,
      isFetching: false,
      data: { notice: null, items, poolCount, poolTotal: poolCount },
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
    fireEvent.click(screen.getByRole('button', { name: 'Plat' }));
  }

  function type(text: string) {
    const field = screen.getByRole('textbox', { name: /ingrédients/i });
    fireEvent.change(field, { target: { value: text } });
    fireEvent.submit(field);
  }

  it('n’envoie rien tant que le champ est vide : il ne change pas le comportement actuel (D6)', () => {
    mountWith([]);
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toEqual({ dishType: 'MAIN' });
  });

  it('porte les ingrédients saisis dans l’orientation, et repart de la première page', () => {
    mountWith([]);
    type('pommes de terre, merguez');

    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]).toMatchObject({ dishType: 'MAIN', ingredients: 'pommes de terre, merguez' });
    // Une autre demande est une autre liste : page et compteur de relances
    // repartent de zéro, comme pour tout changement d'orientation.
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.limit).toBe(12);
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[1]?.relaunch).toBe(0);
  });

  it('refuse une saisie hors des bornes du schéma partagé, et ne lance rien (D7)', () => {
    mountWith([]);
    type('a, b, c, d, e, f');

    expect(screen.getByText(/5 ingrédients au maximum/i)).toBeTruthy();
    // Rien n'est parti : l'orientation reste celle d'avant la saisie.
    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]?.ingredients).toBeUndefined();
  });

  it('traite une saisie faite de virgules comme une absence de contrainte (tour 1)', () => {
    // Elle passait le schéma, posait `ingredients: ', ,,'` dans l'orientation,
    // et l'écran expliquait alors une liste vide par une « combinaison trop
    // rare » — une explication fausse pour une demande inexistante.
    mountWith([]);
    type(' , ,, ');

    expect(vi.mocked(useSuggestionsQuery).mock.calls.at(-1)?.[0]?.ingredients).toBeUndefined();
    expect(screen.queryByText(/combinaison/i)).toBeNull();
  });

  it('dit pourquoi une demande ne rend rien, au lieu d’une liste vide et muette', () => {
    mountWith([]);
    type('merguez, pommes de terre');

    // La limite assumée de D1, dite à l'écran : imposer tous les ingrédients
    // rend peu de choses sur une combinaison inhabituelle.
    expect(screen.getByText(/combinaison/i)).toBeTruthy();
  });

  it('laisse l’état vide habituel quand aucun ingrédient n’est dicté', () => {
    mountWith([]);
    expect(screen.queryByText(/combinaison/i)).toBeNull();
    expect(screen.getByText(/Changez d’orientation/i)).toBeTruthy();
  });
});
