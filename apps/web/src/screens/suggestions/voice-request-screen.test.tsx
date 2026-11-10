import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceSuggestionBatchDto } from '@kitchen/shared';
import { api, ApiClientError } from '../../lib/api';
import { suggestionsApi } from '../../lib/suggestions-api';
import { microphoneErrorMessage, type VoiceRecording } from './use-voice-recorder';
import { VoiceRequestScreen } from './voice-request-screen';

/**
 * Demande parlée (spécification du 2026-10-21). Aucun de ces cas n'enregistre
 * de son : `MediaRecorder` n'existe pas sous `jsdom`, et un micro ne se
 * simule pas. Le doublure du crochet d'enregistrement rend la main sur son
 * état et sur `onRecorded`, ce qui laisse tester tout le reste — les refus
 * (D9), les bornes (D8) et l'affichage de la lecture du modèle (D2, D4).
 */

const recorder = {
  state: 'idle' as 'idle' | 'recording',
  seconds: 0,
  error: null as string | null,
  supported: true,
  start: vi.fn(),
  stop: vi.fn(),
};
let onRecorded: (recording: VoiceRecording) => void = () => {};

vi.mock('./use-voice-recorder', async (importOriginal) => {
  // `microphoneErrorMessage` reste la vraie fonction : c'est elle que les cas
  // de refus (D9) mettent à l'épreuve, seul `useVoiceRecorder` est doublé.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useVoiceRecorder: (callback: (recording: VoiceRecording) => void) => {
      onRecorded = callback;
      return recorder;
    },
  };
});

vi.mock('../../lib/suggestions-api', () => ({
  suggestionsApi: { voice: vi.fn(), keep: vi.fn(), list: vi.fn() },
}));

const voice = vi.mocked(suggestionsApi.voice);

function renderScreen(entry = '/recettes/parler') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <VoiceRequestScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BATCH: VoiceSuggestionBatchDto = {
  fromCache: false,
  notice: null,
  poolCount: 1,
  poolTotal: 1,
  heard: { ingredients: ['poulet', 'sauce tomate'], orientation: 'plat italien' },
  items: [
    {
      id: 'identite-1',
      title: 'Poulet à la tomate',
      origin: 'Composition',
      region: 'mediterraneenne',
      totalMinutes: 25,
      prepMinutes: 10,
      cookMinutes: 15,
      difficulty: 'EASY',
      dishType: 'MAIN',
      provenance: 'ai',
      sourceUrl: null,
      verified: false,
      steps: ['Faire revenir le poulet.'],
      ingredients: [],
      coverage: 0.5,
      group: 'almost',
      missingLabels: [],
    },
  ],
};

/** Un enregistrement plausible : des octets quelconques, jamais de la parole. */
function recording(bytes: number, mimeType = 'audio/webm'): VoiceRecording {
  return { blob: new Blob([new Uint8Array(bytes)], { type: mimeType }), mimeType };
}

beforeEach(() => {
  recorder.state = 'idle';
  recorder.seconds = 0;
  recorder.error = null;
  recorder.supported = true;
  recorder.start.mockClear();
  recorder.stop.mockClear();
  voice.mockReset();
});

describe('VoiceRequestScreen (demande parlée, 2026-10-21)', () => {
  it('propose de parler, et lance l’enregistrement au geste', () => {
    renderScreen();
    const button = screen.getByRole('button', { name: /parler|enregistrer/i });
    fireEvent.click(button);
    expect(recorder.start).toHaveBeenCalled();
  });

  it('annonce l’écoute en cours et laisse l’arrêter', () => {
    recorder.state = 'recording';
    recorder.seconds = 12;
    renderScreen();
    expect(screen.getByText(/écoute/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /terminer|arrêter/i }));
    expect(recorder.stop).toHaveBeenCalled();
  });

  it('dit le refus d’autorisation du micro (D9)', () => {
    recorder.error = microphoneErrorMessage(Object.assign(new Error('refus'), { name: 'NotAllowedError' }));
    renderScreen();
    expect(screen.getByRole('alert').textContent).toMatch(/refusé/i);
  });

  it('dit l’absence de micro (D9)', () => {
    recorder.error = microphoneErrorMessage(Object.assign(new Error('absent'), { name: 'NotFoundError' }));
    renderScreen();
    expect(screen.getByRole('alert').textContent).toMatch(/aucun micro/i);
  });

  it('refuse un enregistrement vide sans rien envoyer (D8, D9)', async () => {
    renderScreen();
    onRecorded(recording(10));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/vide/i));
    expect(voice).not.toHaveBeenCalled();
  });

  it('refuse un enregistrement au-delà de la borne, côté écran aussi (D8)', async () => {
    renderScreen();
    onRecorded(recording(5 * 1024 * 1024));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/trop long/i));
    expect(voice).not.toHaveBeenCalled();
  });

  it('envoie l’enregistrement, affiche ce que le modèle a compris et les recettes (D2, D4)', async () => {
    voice.mockResolvedValue(BATCH);
    renderScreen();
    onRecorded(recording(4096));

    await waitFor(() => expect(screen.getByText(/Poulet à la tomate/)).toBeTruthy());
    expect(voice).toHaveBeenCalledTimes(1);
    // La lecture du modèle est affichée AVEC les résultats : c'est la
    // contrepartie assumée de l'absence d'étape de confirmation (D2).
    const compris = screen.getByTestId('lecture-du-modele').textContent ?? '';
    expect(compris).toMatch(/poulet/);
    expect(compris).toMatch(/sauce tomate/);
    expect(compris).toMatch(/plat italien/);
  });

  /**
   * Demande du propriétaire le 2026-11-09 : « un bouton pour me proposer
   * d'autres recettes toujours avec le même input ». L'enregistrement n'étant
   * conservé nulle part (D6), la relance porte sur les ingrédients compris, par
   * une recherche écrite — et `refresh` est indispensable, sans quoi le serveur
   * servirait le réservoir et rendrait les mêmes recettes.
   */
  it('redemande des recettes sur les ingrédients compris, sans reparler, et les ajoute aux premières', async () => {
    voice.mockResolvedValue(BATCH);
    const autre = { ...BATCH.items[0]!, id: 'autre-1', title: 'Risotto au poulet' };
    vi.mocked(suggestionsApi.list).mockResolvedValue({ items: [autre], poolCount: 2, poolTotal: 2, fromCache: false } as never);
    renderScreen();
    onRecorded(recording(4096));
    await waitFor(() => expect(screen.getByText(/Poulet à la tomate/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Proposer d’autres recettes' }));

    await waitFor(() => expect(screen.getByText(/Risotto au poulet/)).toBeTruthy());
    // Les premières restent : on en veut davantage, pas d'autres à la place.
    expect(screen.getByText(/Poulet à la tomate/)).toBeTruthy();
    // Aucun second envoi d'audio, et une relance explicite sur les ingrédients compris.
    expect(voice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(suggestionsApi.list)).toHaveBeenCalledWith(expect.objectContaining({ refresh: true, ingredients: expect.stringContaining('poulet') }));
  });

  it('dit le quota atteint plutôt que d’échouer en silence (D9)', async () => {
    voice.mockRejectedValue(new ApiClientError(429, 'rate_limited', 'Quota journalier de suggestions atteint (5 par jour) ; réessayez demain.'));
    renderScreen();
    onRecorded(recording(4096));
    await waitFor(() => expect(screen.getByText(/Quota journalier de suggestions atteint/)).toBeTruthy());
    // « Réessayer » renvoie le même enregistrement (amendement du 2026-11-02) :
    // le refus courant est une pause de quelques minutes, et refaire sa demande
    // à voix haute pour cela seul est un geste de trop. L'audio ne quitte pas
    // la page pour autant (D6).
    voice.mockResolvedValue(BATCH);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByText(/Poulet à la tomate/)).toBeTruthy());
    expect(voice).toHaveBeenCalledTimes(2);
    // Le même enregistrement, mais un identifiant de demande neuf : un second
    // essai est une nouvelle demande, pas le rejeu de la première.
    expect(voice.mock.calls[1]?.[0]).toBe(voice.mock.calls[0]?.[0]);
    expect(voice.mock.calls[1]?.[1]).toBe(voice.mock.calls[0]?.[1]);
    expect(voice.mock.calls[1]?.[2]).not.toBe(voice.mock.calls[0]?.[2]);
  });

  it('dit que le modèle n’a rien compris (D9)', async () => {
    voice.mockRejectedValue(new ApiClientError(422, 'business_rule', 'Votre demande n’a pas été comprise : aucun ingrédient ni aucune envie n’a été reconnu dans l’enregistrement.'));
    renderScreen();
    onRecorded(recording(4096));
    await waitFor(() => expect(screen.getByText(/n’a pas été comprise/)).toBeTruthy());
    // Un titre qui dit quoi faire : ni une panne, ni un quota.
    expect(screen.getByText('Demande non comprise')).toBeTruthy();
  });

  it('dit que l’appareil ne sait pas enregistrer, plutôt qu’un bouton inerte (D9)', () => {
    recorder.supported = false;
    renderScreen();
    expect(screen.getByRole('alert').textContent).toMatch(/navigateur|appareil/i);
  });
});

describe('microphoneErrorMessage (D9)', () => {
  it('distingue le refus d’autorisation de l’absence de micro', () => {
    expect(microphoneErrorMessage(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toMatch(/refusé/i);
    expect(microphoneErrorMessage(Object.assign(new Error('x'), { name: 'NotFoundError' }))).toMatch(/aucun micro/i);
    expect(microphoneErrorMessage(Object.assign(new Error('x'), { name: 'NotReadableError' }))).toMatch(/déjà utilisé/i);
  });

  it('rend un message français pour une cause inconnue, jamais une chaîne vide', () => {
    const message = microphoneErrorMessage(new Error('quelque chose'));
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain('quelque chose');
  });
});

/**
 * Retour sur une demande différée (2026-11-10). La notification et le message
 * de retour portent l'identifiant dans l'adresse ; sans cette relecture, le
 * résultat annoncé n'était affichable nulle part.
 */
describe('reprise d’une demande différée', () => {
  it('réaffiche la lecture et les recettes de la demande nommée dans l’adresse', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ id: 'req-1', kind: 'VOICE', state: 'DONE', result: BATCH, error: null, retryAt: null } as never);

    renderScreen('/recettes/parler?demande=req-1');

    expect(await screen.findByText(/Poulet à la tomate/)).toBeTruthy();
    // La lecture du modèle est là aussi : c'est elle qui montre un contresens (D2).
    expect(screen.getAllByText(/plat italien/).length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith('/ai-requests/req-1');
    get.mockRestore();
  });

  it('le dit sans faire croire à une perte quand la demande n’est plus là', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiClientError(404, 'not_found', 'Demande introuvable'));

    renderScreen('/recettes/parler?demande=req-1');

    expect(await screen.findByText(/n’est plus disponible/)).toBeTruthy();
    get.mockRestore();
  });
});
