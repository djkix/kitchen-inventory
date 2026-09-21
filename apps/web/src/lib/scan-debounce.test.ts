import { describe, expect, it } from 'vitest';
import { createCodeDebouncer, normalizeBarcode } from './scan-debounce';

describe('createCodeDebouncer', () => {
  it('accepte un code une seule fois par fenêtre de 2 s', () => {
    const debouncer = createCodeDebouncer(2000);
    expect(debouncer.accept('3017620422003', 0)).toBe(true);
    expect(debouncer.accept('3017620422003', 500)).toBe(false);
    expect(debouncer.accept('3017620422003', 1999)).toBe(false);
    expect(debouncer.accept('3017620422003', 2000)).toBe(true);
  });

  it('distingue deux codes différents lus coup sur coup', () => {
    const debouncer = createCodeDebouncer(2000);
    expect(debouncer.accept('A', 0)).toBe(true);
    expect(debouncer.accept('B', 10)).toBe(true);
  });

  it('repart de zéro après reset', () => {
    const debouncer = createCodeDebouncer(2000);
    debouncer.accept('A', 0);
    debouncer.reset();
    expect(debouncer.accept('A', 1)).toBe(true);
  });
});

describe('normalizeBarcode', () => {
  it('convertit un UPC-A en EAN-13 et garde EAN-8 / EAN-13', () => {
    expect(normalizeBarcode('012345678905')).toBe('0012345678905');
    expect(normalizeBarcode('3017620422003')).toBe('3017620422003');
    expect(normalizeBarcode(' 12345670 ')).toBe('12345670');
  });

  it('rejette les contenus non numériques ou de longueur inattendue (QR d’URL, etc.)', () => {
    expect(normalizeBarcode('https://exemple.fr')).toBeNull();
    expect(normalizeBarcode('12345')).toBeNull();
  });
});
