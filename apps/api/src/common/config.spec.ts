import { describe, expect, it } from 'vitest';
import { googleCertsOverrideWarning, loadConfig } from './config.js';

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

describe('ADMIN_EMAIL', () => {
  it('est normalisée comme l’adresse du jeton Google', () => {
    expect(loadConfig({ ...BASE, ADMIN_EMAIL: '  Moi@Example.ORG ' }).ADMIN_EMAIL).toBe('moi@example.org');
  });
  it('est facultative, et vide vaut absente', () => {
    expect(loadConfig({ ...BASE }).ADMIN_EMAIL).toBeUndefined();
    expect(loadConfig({ ...BASE, ADMIN_EMAIL: '' }).ADMIN_EMAIL).toBeUndefined();
  });
  it('refuse une valeur qui n’est pas une adresse', () => {
    expect(() => loadConfig({ ...BASE, ADMIN_EMAIL: 'pas-une-adresse' })).toThrow('ADMIN_EMAIL');
  });
});

describe('GOOGLE_CERTS_URL en production (audit du 2026-11-11)', () => {
  const PROD = { ...BASE, NODE_ENV: 'production' };

  it('refuse de démarrer si le remplacement n’est pas revendiqué', () => {
    expect(() => loadConfig({ ...PROD, GOOGLE_CERTS_URL: 'http://stub:3101/certs' })).toThrow('GOOGLE_CERTS_URL');
  });

  it('démarre quand le montage de tests le revendique', () => {
    const config = loadConfig({ ...PROD, GOOGLE_CERTS_URL: 'http://stub:3101/certs', ALLOW_GOOGLE_CERTS_OVERRIDE: 'true' });
    expect(config.GOOGLE_CERTS_URL).toBe('http://stub:3101/certs');
  });

  it('ne gêne ni la production normale ni le développement', () => {
    expect(loadConfig({ ...PROD }).GOOGLE_CERTS_URL).toBeUndefined();
    const dev = loadConfig({ ...BASE, NODE_ENV: 'development', GOOGLE_CERTS_URL: 'http://stub:3101/certs' });
    expect(dev.GOOGLE_CERTS_URL).toBe('http://stub:3101/certs');
  });
});

describe('googleCertsOverrideWarning', () => {
  it('ne dit rien quand la variable est absente (production normale)', () => {
    expect(googleCertsOverrideWarning(loadConfig({ ...BASE }))).toBeNull();
  });

  it('avertit, et nomme la valeur, dès que la variable est posée', () => {
    const warning = googleCertsOverrideWarning(loadConfig({ ...BASE, GOOGLE_CERTS_URL: 'http://stub:3101/certs', ALLOW_GOOGLE_CERTS_OVERRIDE: 'true' }));
    expect(warning).toContain('GOOGLE_CERTS_URL');
    expect(warning).toContain('http://stub:3101/certs');
    expect(warning).toMatch(/ne viennent pas de Google/);
  });
});
