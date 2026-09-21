import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const BASE = { DATABASE_URL: 'postgresql://k:k@db:5432/k', SECRET_KEY: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('traite les variables vides transmises par Docker Compose comme absentes', () => {
    const config = loadConfig({ ...BASE, VISION_PROVIDER: 'gemini', VISION_API_KEY: 'AIza', VISION_BASE_URL: '', VISION_MODEL: '', WEB_DIST_DIR: '   ' });
    expect(config.VISION_BASE_URL).toBeUndefined();
    expect(config.VISION_MODEL).toBeUndefined();
    expect(config.VISION_PROVIDER).toBe('gemini');
  });

  it('refuse une URL de fournisseur réellement invalide', () => {
    expect(() => loadConfig({ ...BASE, VISION_BASE_URL: 'pas-une-url' })).toThrow('VISION_BASE_URL');
  });

  it('exige DATABASE_URL et une SECRET_KEY de 32 caractères', () => {
    expect(() => loadConfig({ DATABASE_URL: '', SECRET_KEY: 'court' })).toThrow('Configuration invalide');
  });
});
