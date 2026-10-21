import { VOICE_MAX_SECONDS } from '@kitchen/shared';
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from './use-voice-recorder';

/**
 * Arrêt automatique de l'enregistrement (D8, tour de correction 1).
 *
 * `jsdom` ne fournit ni micro ni `MediaRecorder` : la doublure ci-dessous en
 * imite le strict nécessaire — un état, un `stop()` qui **lève
 * `InvalidStateError` quand l'enregistreur est déjà arrêté**, comme le vrai.
 * C'est ce comportement-là qui rendait l'ancienne version dangereuse : un
 * second tick de l'horloge rappelait `stop()` depuis l'updater de
 * `setSeconds`, donc pendant le rendu.
 *
 * Aucun son n'est produit ni envoyé : ce qui est vérifié ici, c'est l'horloge
 * et la borne, pas la capture — celle-ci reste hors de portée des tests.
 */

class FakeMediaRecorder {
  static isTypeSupported = (): boolean => true;
  static instances: FakeMediaRecorder[] = [];

  state: 'inactive' | 'recording' = 'inactive';
  stopCalls = 0;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType = 'audio/webm';

  constructor(readonly stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  /**
   * Fidèle au vrai sur les deux points qui comptent : l'état passe à
   * `inactive` **tout de suite**, mais `onstop` n'arrive qu'au tour suivant.
   * C'est dans cette fenêtre qu'un second arrêt lève `InvalidStateError` —
   * la référence à l'enregistreur n'a pas encore été effacée.
   */
  stop(): void {
    this.stopCalls += 1;
    if (this.state === 'inactive') throw Object.assign(new Error('déjà arrêté'), { name: 'InvalidStateError' });
    this.state = 'inactive';
    setTimeout(() => this.onstop?.(), 0);
  }
}

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startRecording(onRecorded = vi.fn()) {
  // `StrictMode` : React y invoque chaque updater **deux fois**. C'est ce qui
  // met à l'épreuve le point corrigé — un `stop()` appelé depuis l'updater de
  // `setSeconds` y partait deux fois, et le second levait `InvalidStateError`
  // pendant le rendu.
  const hook = renderHook(() => useVoiceRecorder(onRecorded), { wrapper: StrictMode });
  await act(async () => {
    hook.result.current.start();
  });
  // Pas de `waitFor` : les horloges sont truquées, il n'avancerait jamais.
  // Le `act` ci-dessus a déjà vidé la file des microtâches de `getUserMedia`.
  expect(hook.result.current.state).toBe('recording');
  return { hook, onRecorded };
}

describe('useVoiceRecorder, arrêt automatique (D8)', () => {
  it('arrête l’enregistrement à la borne, et rend ce qui a été capté', async () => {
    const { hook, onRecorded } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(VOICE_MAX_SECONDS * 1000);
    });
    // Deuxième tour : l'arrêt part d'un effet, donc à la sortie du `act`
    // ci-dessus, et `onstop` n'arrive qu'au tour d'après.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });

    const recorder = FakeMediaRecorder.instances[0]!;
    expect(recorder.state).toBe('inactive');
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toBe('idle');
  });

  it('ne rappelle pas stop() une fois l’enregistrement terminé', async () => {
    // Le défaut corrigé : un second tick avant `onstop` relançait `stop()`
    // depuis l'updater de `setSeconds`, donc pendant le rendu — et
    // `InvalidStateError` levé là blanchit l'écran, à la soixantième seconde
    // précisément, c'est-à-dire dans le cas que la borne doit protéger.
    const { hook } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime((VOICE_MAX_SECONDS + 5) * 1000);
    });

    expect(FakeMediaRecorder.instances[0]!.stopCalls).toBe(1);
    expect(hook.result.current.error).toBeNull();
  });

  it('ne transmet pas un second arrêt à un enregistreur déjà arrêté', async () => {
    // Le vrai `MediaRecorder` lève `InvalidStateError` dans ce cas, et les
    // deux chemins d'arrêt — la borne des soixante secondes et l'appui sur
    // « Terminer » — peuvent tomber dans le même intervalle.
    const { hook } = await startRecording();
    act(() => hook.result.current.stop());
    // Toujours dans la fenêtre : `onstop` n'a pas encore couru, la référence
    // à l'enregistreur est intacte, et c'est le garde d'état qui doit tenir.
    expect(() => act(() => hook.result.current.stop())).not.toThrow();
    expect(FakeMediaRecorder.instances[0]!.stopCalls).toBe(1);
  });

  it('n’arrête rien avant la borne', async () => {
    const { onRecorded } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime((VOICE_MAX_SECONDS - 2) * 1000);
    });
    expect(FakeMediaRecorder.instances[0]!.state).toBe('recording');
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('éteint le micro en s’arrêtant : la pastille rouge ne doit pas rester', async () => {
    track.stop.mockClear();
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(VOICE_MAX_SECONDS * 1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    expect(track.stop).toHaveBeenCalled();
  });
});
