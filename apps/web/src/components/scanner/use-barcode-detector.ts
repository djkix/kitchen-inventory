import { useEffect, useRef, useState, type RefObject } from 'react';
import { createCodeDebouncer, normalizeBarcode } from '../../lib/scan-debounce';
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
 * Boucle de lecture à ~10 images/s avec anti-rebond de 2 s par code.
 * Les lectures non numériques (QR d'URL) sont ignorées.
 */
export function useBarcodeDetector({ videoRef, enabled, onCode, intervalMs = 100 }: Options) {
  const [engine, setEngine] = useState<BarcodeDecoder['engine'] | null>(null);
  const [failed, setFailed] = useState(false);
  const decoderRef = useRef<BarcodeDecoder | null>(null);
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
    const debouncer = createCodeDebouncer(2000);
    let timer: number | null = null;
    let running = true;

    const tick = async () => {
      if (!running) return;
      const video = videoRef.current;
      const decoder = decoderRef.current;
      if (video && decoder && !video.paused) {
        try {
          const codes = await decoder.decode(video);
          for (const raw of codes) {
            const code = normalizeBarcode(raw);
            if (code && debouncer.accept(code)) {
              onCodeRef.current(code);
              break;
            }
          }
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
