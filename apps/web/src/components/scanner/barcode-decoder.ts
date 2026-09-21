import { DETECTOR_FORMATS, ZXING_FORMATS } from '../../lib/scan-debounce';

/**
 * Décodage d'un code-barres depuis une image de la vidéo.
 * `BarcodeDetector` natif quand il existe, sinon `zxing-wasm` sur un canvas
 * (section 13 : dégradation propre si BarcodeDetector est absent).
 */
export interface BarcodeDecoder {
  readonly engine: 'native' | 'zxing';
  decode(video: HTMLVideoElement): Promise<string[]>;
  dispose(): void;
}

export function hasNativeDetector(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

async function createNativeDecoder(): Promise<BarcodeDecoder | null> {
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = DETECTOR_FORMATS.filter((format) => supported.includes(format));
    if (formats.length === 0) return null;
    const detector = new BarcodeDetector({ formats });
    return {
      engine: 'native',
      async decode(video) {
        if (video.readyState < 2) return [];
        const results = await detector.detect(video);
        return results.map((result) => result.rawValue);
      },
      dispose() {
        /* rien à libérer */
      },
    };
  } catch {
    return null;
  }
}

async function createZxingDecoder(): Promise<BarcodeDecoder> {
  const [{ readBarcodes, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    // Le binaire WASM est servi par l'application elle-même, jamais depuis un CDN : l'instance peut être hors Internet.
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  await prepareZXingModule({ overrides: { locateFile: () => wasmUrl }, fireImmediately: true });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D indisponible');
  // Largeur de travail réduite : suffisante pour un EAN, économe en calcul WASM sur un téléphone moyen.
  const WORK_WIDTH = 640;
  return {
    engine: 'zxing',
    async decode(video) {
      if (video.readyState < 2 || video.videoWidth === 0) return [];
      const scale = Math.min(1, WORK_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const results = await readBarcodes(imageData, { formats: [...ZXING_FORMATS], tryHarder: false, maxNumberOfSymbols: 2 });
      return results.filter((result) => result.isValid).map((result) => result.text);
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export async function createBarcodeDecoder(): Promise<BarcodeDecoder> {
  if (hasNativeDetector()) {
    const native = await createNativeDecoder();
    if (native) return native;
  }
  return createZxingDecoder();
}
