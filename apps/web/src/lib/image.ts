/**
 * Préparation d'une photo avant envoi au fournisseur de vision : au plus
 * 1024 px de large, JPEG à 0,85 (choix d'implémentation, section 6 des décisions).
 */
export const MAX_PHOTO_WIDTH = 1024;
export const PHOTO_JPEG_QUALITY = 0.85;

export interface Dimensions {
  width: number;
  height: number;
}

/** Dimensions cibles conservant le ratio ; jamais d'agrandissement. */
export function fitWithin(source: Dimensions, maxWidth: number): Dimensions {
  if (source.width <= 0 || source.height <= 0) return { width: 0, height: 0 };
  if (source.width <= maxWidth) return { width: Math.round(source.width), height: Math.round(source.height) };
  const ratio = maxWidth / source.width;
  return { width: maxWidth, height: Math.max(1, Math.round(source.height * ratio)) };
}

type Drawable = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap;

function sourceSize(source: Drawable): Dimensions {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  return { width: source.width, height: source.height };
}

/** Copie une image dans un canvas redimensionné. */
export function drawResized(source: Drawable, maxWidth = MAX_PHOTO_WIDTH): HTMLCanvasElement {
  const target = fitWithin(sourceSize(source), maxWidth);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponible');
  context.drawImage(source, 0, 0, target.width, target.height);
  return canvas;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = PHOTO_JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Encodage JPEG impossible'));
      },
      'image/jpeg',
      quality,
    );
  });
}

/** Capture une image de la vidéo, la réduit et l'encode en JPEG. */
export async function captureJpeg(source: Drawable, maxWidth = MAX_PHOTO_WIDTH, quality = PHOTO_JPEG_QUALITY): Promise<Blob> {
  return canvasToJpeg(drawResized(source, maxWidth), quality);
}
