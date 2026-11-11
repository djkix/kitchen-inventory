import { describe, expect, it } from 'vitest';
import { MediaService } from './media.service.js';
import type { AppConfig } from '../common/config.js';

const media = new MediaService({ mediaDir: '/data/media' } as AppConfig);

describe('MediaService.resolvePublic (audit du 2026-11-11)', () => {
  it('sert un média ordinaire', () => {
    expect(media.resolvePublic('scans/2026/01/abc.jpg')).toBe('/data/media/scans/2026/01/abc.jpg');
    expect(media.resolvePublic('products/2026/01/abc.jpg')).toBe('/data/media/products/2026/01/abc.jpg');
  });

  it('refuse les entrées gardées pour un rejeu, même déguisées', () => {
    expect(media.resolvePublic('differe/2026/01/abc.bin')).toBeNull();
    expect(media.resolvePublic('scans/../differe/2026/01/abc.bin')).toBeNull();
    expect(media.resolvePublic('./differe/2026/01/abc.bin')).toBeNull();
  });

  it('refuse toujours la sortie du dossier', () => {
    expect(media.resolvePublic('../.env')).toBeNull();
  });

  it('laisse `resolve` les atteindre : c’est ainsi qu’on les relit et qu’on les efface', () => {
    expect(media.resolve('differe/2026/01/abc.bin')).toBe('/data/media/differe/2026/01/abc.bin');
  });
});
