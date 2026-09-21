import { describe, expect, it } from 'vitest';
import { drawResized, fitWithin, isAcceptedPhoto, MAX_PHOTO_WIDTH } from './image';

describe('fitWithin', () => {
  it('réduit à 1024 px de large en gardant le ratio', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, MAX_PHOTO_WIDTH)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin({ width: 3024, height: 4032 }, 1024)).toEqual({ width: 1024, height: 1365 });
  });

  it('n’agrandit jamais une petite image', () => {
    expect(fitWithin({ width: 640, height: 480 }, 1024)).toEqual({ width: 640, height: 480 });
  });

  it('renvoie zéro pour une source sans dimensions (vidéo pas encore prête)', () => {
    expect(fitWithin({ width: 0, height: 0 }, 1024)).toEqual({ width: 0, height: 0 });
  });
});

describe('drawResized', () => {
  it('dimensionne le canvas de sortie (dessin simulé, jsdom n’a pas de Canvas 2D)', () => {
    const source = document.createElement('canvas');
    source.width = 2048;
    source.height = 1024;
    const drawImage = () => undefined;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContextMock() {
      return { drawImage } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
    try {
      const result = drawResized(source, 1024);
      expect(result.width).toBe(1024);
      expect(result.height).toBe(512);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
});

describe('isAcceptedPhoto', () => {
  it('accepte les formats photo du téléphone, y compris le HEIC d’iPhone', () => {
    expect(isAcceptedPhoto({ type: 'image/jpeg' })).toBe(true);
    expect(isAcceptedPhoto({ type: 'image/heic' })).toBe(true);
    expect(isAcceptedPhoto({ type: 'image/png' })).toBe(true);
  });

  it('refuse ce qui n’est pas une image', () => {
    expect(isAcceptedPhoto({ type: 'application/pdf' })).toBe(false);
    expect(isAcceptedPhoto({ type: '' })).toBe(false);
  });
});
