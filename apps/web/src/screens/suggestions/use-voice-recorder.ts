import { VOICE_MAX_SECONDS } from '@kitchen/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Enregistrement d'une demande parlée (spécification du 2026-10-21, D1, D8,
 * D9).
 *
 * Le navigateur enregistre, le serveur transmet, le modèle écoute : rien
 * n'est transcrit ici. L'audio ne quitte ce module que sous la forme d'un
 * `Blob` remis à l'appelant, et n'est écrit nulle part (D6).
 *
 * Ce que ce module garantit, et que le serveur revérifie de son côté :
 * l'enregistrement s'arrête tout seul à `VOICE_MAX_SECONDS` (D8), et chaque
 * refus du micro porte son propre message en français (D9) — jamais un bouton
 * qui ne réagit pas.
 *
 * Aucun test ne peut exercer ce code : ni `jsdom` ni le navigateur sans
 * geste humain ne fournissent `MediaRecorder` et un vrai micro. C'est la
 * limite assumée de ce lot, et la raison pour laquelle tout ce qui peut être
 * décidé sans micro l'est ailleurs — `microphoneErrorMessage` ici,
 * `voiceAudioRejection` dans `packages/shared`, tous deux testés.
 */

export type VoiceRecorderState = 'idle' | 'recording';

export interface VoiceRecording {
  blob: Blob;
  mimeType: string;
}

/**
 * Formats tentés dans l'ordre : Opus dans WebM (Chrome, Android) puis AAC
 * dans MP4 (Safari, iOS). `MediaRecorder` ne garantit aucun des deux, d'où la
 * liste et le repli sur le défaut du navigateur.
 */
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Message français d'un refus du micro (D9). Exporté et testé à part : c'est
 * la seule partie de l'enregistrement qui puisse l'être sans micro.
 *
 * `NotAllowedError` est le refus d'autorisation, `NotFoundError` l'absence de
 * périphérique ; les distinguer compte, les gestes à faire n'ont rien à voir
 * (rouvrir les réglages du navigateur, ou brancher un micro).
 */
export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Accès au micro refusé. Autorisez le micro pour ce site dans les réglages du navigateur, puis réessayez.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Aucun micro détecté sur cet appareil.';
  }
  if (name === 'NotReadableError') {
    return 'Le micro est déjà utilisé par une autre application.';
  }
  return 'Enregistrement impossible sur cet appareil : le navigateur ne le permet pas.';
}

/**
 * `onRecorded` reçoit l'enregistrement terminé. Les bornes de taille et de
 * format sont vérifiées par l'appelant avec la règle partagée
 * (`voiceAudioRejection`), jamais réécrites ici.
 */
export function useVoiceRecorder(onRecorded: (recording: VoiceRecording) => void): {
  state: VoiceRecorderState;
  seconds: number;
  error: string | null;
  supported: boolean;
  start: () => void;
  stop: () => void;
} {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';

  /**
   * `stop()` sur un enregistreur déjà arrêté lève `InvalidStateError` : le
   * garde n'est pas décoratif, l'arrêt automatique et l'appui sur
   * « Terminer » peuvent tomber dans le même intervalle.
   */
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  // Le compteur ne fait que compter.
  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  /**
   * Arrêt automatique à `VOICE_MAX_SECONDS` (D8), dans un effet et **jamais
   * dans l'updater de `setSeconds`** (tour de correction 1). React appelle un
   * updater plusieurs fois (StrictMode, rendu concurrent) et ne lui permet
   * aucun effet de bord : un second tick avant `onstop` y relançait `stop()`,
   * donc un `InvalidStateError` levé pendant le rendu — écran blanc à la
   * soixantième seconde, c'est-à-dire exactement dans le cas que la borne est
   * censée protéger.
   */
  useEffect(() => {
    if (state === 'recording' && seconds >= VOICE_MAX_SECONDS) stop();
  }, [state, seconds, stop]);

  // Le micro reste allumé tant que les pistes ne sont pas arrêtées : la
  // pastille rouge du navigateur resterait affichée après coup.
  useEffect(() => () => recorderRef.current?.stream.getTracks().forEach((track) => track.stop()), []);

  const start = useCallback(() => {
    setError(null);
    if (!supported) {
      setError(microphoneErrorMessage(new Error('unsupported')));
      return;
    }
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (cause) {
        setError(microphoneErrorMessage(cause));
        return;
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setState('idle');
        setSeconds(0);
        const type = recorder.mimeType || mimeType || 'audio/webm';
        onRecorded({ blob: new Blob(chunks, { type }), mimeType: type.split(';')[0]?.trim() ?? type });
      };
      recorderRef.current = recorder;
      setSeconds(0);
      setState('recording');
      recorder.start();
    })();
  }, [onRecorded, supported]);

  return { state, seconds, error, supported, start, stop };
}
