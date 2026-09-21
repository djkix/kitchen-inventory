import { useEffect, useRef, useState, type RefObject } from 'react';
import { createScanGate, normalizeBarcode } from '../../lib/scan-debounce';
import { createBarcodeDecoder, type BarcodeDecoder } from './barcode-decoder';

interface Options {
  /** Vidéo affichée par le scanner. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Faux pendant qu'une fiche ou un tiroir est ouvert : la caméra tourne, la lecture attend. */
  enabled: boolean;
  onCode: (code: string) => void;
  intervalMs?: number;
}

/**
 * Boucle de lecture à ~10 images/s. Les lectures non numériques (QR d'URL)
 * sont ignorées. Le filtre anti-répétition vit hors de l'effet : il doit
 * survivre aux pauses de la détection (tiroir de validation ouvert), sinon le
 * même article encore devant l'objectif est relu à chaque reprise.
 */
export function useBarcodeDetector({ videoRef, enabled, onCode, intervalMs = 100 }: Options) {
  const [engine, setEngine] = useState<BarcodeDecoder['engine'] | null>(null);
  const [failed, setFailed] = useState(false);
  const decoderRef = useRef<BarcodeDecoder | null>(null);
  const gateRef = useRef(createScanGate(2000));
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let cancelled = false;
    createBarcodeDecoder()
      .then((decoder) => {
        if (cancelled) {
          decoder.dispose();
          return;
        }
        decoderRef.current = decoder;
        setEngine(decoder.engine);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      decoderRef.current?.dispose();
      decoderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !engine) return;
    const gate = gateRef.current;
    let timer: number | null = null;
    let running = true;

    const tick = async () => {
      if (!running) return;
      const video = videoRef.current;
      const decoder = decoderRef.current;
      if (video && decoder && !video.paused) {
        try {
          const codes = await decoder.decode(video);
          const accepted = gate.offer(codes.map(normalizeBarcode).filter((code): code is string => code !== null));
          if (accepted) onCodeRef.current(accepted);
        } catch {
          /* image non décodable à cet instant : on réessaie à la prochaine */
        }
      }
      if (running) timer = window.setTimeout(() => void tick(), intervalMs);
    };
    void tick();

    return () => {
      running = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, engine, intervalMs, videoRef]);

  return { engine, failed };
}
