import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraState =
  | { status: 'idle' }
  | { status: 'insecure' }
  | { status: 'unsupported' }
  | { status: 'starting' }
  | { status: 'ready'; stream: MediaStream }
  | { status: 'denied' }
  | { status: 'error'; message: string };

/**
 * Accès caméra (`getUserMedia`, caméra arrière). Le flux n'est jamais coupé entre
 * deux articles : le mode rafale de la section 8 en dépend.
 */
export function useCamera(active: boolean) {
  const [state, setState] = useState<CameraState>({ status: 'idle' });
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) {
      setState({ status: 'insecure' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ status: 'unsupported' });
      return;
    }
    setState({ status: 'starting' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState({ status: 'ready', stream });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setState({ status: 'denied' });
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState({ status: 'unsupported' });
      else setState({ status: 'error', message: error instanceof Error ? error.message : 'Caméra indisponible' });
    }
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      setState({ status: 'idle' });
      return;
    }
    void start();
    return stop;
  }, [active, start, stop]);

  // La vidéo est branchée au flux quand l'élément apparaît après le démarrage.
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (element && streamRef.current && element.srcObject !== streamRef.current) {
      element.srcObject = streamRef.current;
      void element.play().catch(() => undefined);
    }
  }, []);

  return { state, videoRef, attachVideo, retry: start };
}
